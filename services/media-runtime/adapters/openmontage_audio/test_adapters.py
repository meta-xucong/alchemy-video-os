import os
import json
import subprocess
from tempfile import TemporaryDirectory
import unittest
from pathlib import Path
from unittest.mock import patch

from .piper import PIPER_PACE_LENGTH_SCALES, PiperConfig, build_piper_command, length_scale_for_pace
from .pixabay_music import PixabayMusic, PixabayMusicResult
from .selector import select_provider
from .full_mix import OpenMontageAudioMixer

class OpenMontageAudioAdapterTests(unittest.TestCase):
    def test_piper_command_preserves_upstream_parameters(self):
        command = build_piper_command(PiperConfig(Path("model.onnx"), Path("config.json")), Path("out.wav"))
        self.assertEqual(command, ["--model", "model.onnx", "--speaker", "0", "--length-scale", "1.0", "--sentence-silence", "0.3", "--output_file", "out.wav"])
        self.assertNotIn("-i", command)
        self.assertNotIn("-f", command)

    def test_selector_requires_an_explicit_local_piper_fallback(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "source-discovered"):
                select_provider()
            self.assertEqual(select_provider("piper"), "piper")
            self.assertEqual(select_provider("piper_tts"), "piper")

    def test_selector_requires_credentials_for_explicit_cloud_provider(self):
        with patch.dict(os.environ, {
            "DOUBAO_SPEECH_API_KEY": "fixture-only",
            "OPENAI_API_KEY": "fixture-only",
            "GOOGLE_API_KEY": "fixture-only",
        }, clear=True):
            with self.assertRaisesRegex(RuntimeError, "source-discovered"):
                select_provider("auto")
            self.assertEqual(select_provider("doubao"), "doubao")
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                select_provider("doubao")

    def test_pace_mapping_exposes_only_the_upstream_default(self):
        self.assertEqual(length_scale_for_pace("NATURAL"), 1.0)
        self.assertEqual(PIPER_PACE_LENGTH_SCALES, {"NATURAL": 1.0})
        with self.assertRaises(ValueError):
            length_scale_for_pace("SLOW")
        with self.assertRaises(ValueError):
            length_scale_for_pace("FAST")
        with self.assertRaises(ValueError):
            length_scale_for_pace("UNKNOWN")

    def test_pixabay_execute_preserves_source_filter_fallback_and_first_match(self):
        tool = PixabayMusic()
        first = {"title": "first", "audio_url": "https://cdn.pixabay.com/audio/first.mp3", "duration": 4, "artist": "one"}
        second = {"title": "second", "audio_url": "https://cdn.pixabay.com/audio/second.mp3", "duration": 9, "artist": "two"}
        with patch.object(tool, "_search", return_value=[first, second]), patch.object(tool, "_download", return_value=Path("selected.mp3")) as download:
            result = tool.execute({"query": "ambient", "min_duration": 30, "max_duration": 60})
        self.assertIsInstance(result, PixabayMusicResult)
        self.assertIs(result.track, first)
        download.assert_called_once_with(first, {"query": "ambient", "min_duration": 30, "max_duration": 60})
        self.assertEqual(result.results_found, 2)
        self.assertEqual(result.results_after_filter, 2)

    def test_pixabay_bootstrap_parser_preserves_source_track_mapping(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self):
                return b'{"page":{"results":[{"name":"Theme","duration":42,"user":{"username":"artist"},"id":7,"sources":{"src":"https://cdn.pixabay.com/audio/theme.mp3"}}]}}'

        class Opener:
            def open(self, *_args, **_kwargs): return Response()

        tracks = PixabayMusic()._parse_bootstrap(
            '<script>window.__BOOTSTRAP_URL__ = "/api/bootstrap"</script>',
            "https://pixabay.com/music/search/theme/",
            Opener(),
        )
        self.assertEqual(tracks[0]["title"], "Theme")
        self.assertEqual(tracks[0]["artist"], "artist")
        self.assertEqual(tracks[0]["pixabay_id"], 7)

    def test_pixabay_download_rejects_non_pixabay_cdn_urls(self):
        with self.assertRaisesRegex(RuntimeError, "unsupported audio URL"):
            PixabayMusic()._download(
                {"title": "hostile", "audio_url": "https://example.com/audio.mp3"},
                {"output_path": "hostile.mp3"},
            )

    def test_pixabay_download_rejects_non_audio_mime(self):
        class Response:
            class Headers:
                def get_content_type(self): return "text/html"
            headers = Headers()
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b"<html>blocked</html>"

        with TemporaryDirectory() as directory, patch("urllib.request.urlopen", return_value=Response()):
            with self.assertRaisesRegex(RuntimeError, "unsupported audio MIME"):
                PixabayMusic()._download(
                    {"title": "blocked", "audio_url": "https://cdn.pixabay.com/audio/blocked.mp3"},
                    {"output_path": str(Path(directory) / "blocked.mp3")},
                )

    def test_full_mix_preserves_source_track_filters_and_absolute_speech_starts(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            speech = root / "speech.wav"
            music = root / "music.mp3"
            sfx = root / "sfx.wav"
            output = root / "mixed.wav"
            speech.write_bytes(b"speech")
            music.write_bytes(b"music")
            sfx.write_bytes(b"sfx")
            calls = []

            def run_command(binary, args, timeout):
                calls.append((binary, args, timeout))
                if binary == "ffprobe":
                    return "2.000\n"
                return ""

            mixer = OpenMontageAudioMixer(run_command=run_command, ffprobe="ffprobe")
            result = mixer.full_mix({
                "tracks": [
                    {"path": str(speech), "role": "speech", "start_seconds": 1.5, "volume": 0.8, "fade_in_seconds": 0.1, "fade_out_seconds": 0.2},
                    {"path": str(music), "role": "music", "volume": 0.3},
                    {"path": str(sfx), "role": "sfx", "start_seconds": 0.25},
                ],
                "ducking": {"enabled": True, "music_volume_during_speech": 0.15, "attack_ms": 200, "release_ms": 500},
                "normalize": True,
                "loudnorm_target": -14,
                "target_duration": 4.0,
                "ffmpeg": "ffmpeg",
                "output_path": str(output),
            })

        self.assertEqual(result, output)
        ffmpeg_call = next(call for call in calls if call[0] == "ffmpeg")
        command = ffmpeg_call[1]
        graph = command[command.index("-filter_complex") + 1]
        speech_graph = graph[graph.index("[0:a]") : graph.index("[a0]") + len("[a0]")]
        self.assertLess(speech_graph.index("afade=t=in"), speech_graph.index("adelay=1500|1500"))
        self.assertIn("volume=0.8", speech_graph)
        self.assertIn("afade=t=out:st=1.8:d=0.2", speech_graph)
        self.assertIn("sidechaincompress=threshold=0.02:ratio=9:attack=0.2:release=0.5:level_sc=1:mix=0.9", graph)
        self.assertIn("[pressfx][a2]amix=inputs=2:duration=longest[premix]", graph)
        self.assertIn("apad=whole_dur=4.0,atrim=duration=4.0", graph)
        self.assertIn("loudnorm=I=-14.0:LRA=11:TP=-1.5", graph)

    def test_full_mix_rejects_source_preconditions_without_fallback(self):
        mixer = OpenMontageAudioMixer(run_command=lambda *_args: "", ffprobe="ffprobe")
        with self.assertRaisesRegex(ValueError, "No tracks provided"):
            mixer.full_mix({"tracks": [], "ffmpeg": "ffmpeg", "output_path": "out.wav"})

        with TemporaryDirectory() as directory:
            output = Path(directory) / "out.wav"
            with self.assertRaisesRegex(ValueError, "Track not found"):
                mixer.full_mix({
                    "tracks": [{"path": str(Path(directory) / "missing.wav"), "role": "speech"}],
                    "ffmpeg": "ffmpeg",
                    "output_path": str(output),
                })

        with TemporaryDirectory() as directory:
            speech = Path(directory) / "speech.wav"
            speech.write_bytes(b"speech")
            with self.assertRaisesRegex(ValueError, "target_duration must be greater than zero"):
                mixer.full_mix({
                    "tracks": [{"path": str(speech), "role": "speech"}],
                    "target_duration": 0,
                    "ffmpeg": "ffmpeg",
                    "output_path": str(Path(directory) / "out.wav"),
                })

        with TemporaryDirectory() as directory:
            speech = Path(directory) / "speech.wav"
            speech.write_bytes(b"speech")
            with self.assertRaisesRegex(ValueError, "No valid tracks"):
                mixer.full_mix({
                    "tracks": [{"path": str(speech), "role": "unknown"}],
                    "ffmpeg": "ffmpeg",
                    "output_path": str(Path(directory) / "out.wav"),
                })

    def test_full_mix_produces_source_equivalent_media_fixture_when_ffmpeg_is_available(self):
        project_root = Path(__file__).resolve().parents[4]
        ffmpeg = project_root / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        ffprobe = project_root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffmpeg.is_file() or not ffprobe.is_file():
            self.skipTest("controlled ffmpeg/ffprobe fixtures are unavailable")

        def run_command(binary, args, timeout):
            completed = subprocess.run([binary, *args], check=True, capture_output=True, text=True, timeout=timeout)
            return completed.stdout

        with TemporaryDirectory() as directory:
            root = Path(directory)
            speech_one = root / "speech-one.wav"
            speech_two = root / "speech-two.wav"
            music = root / "music.wav"
            output = root / "mixed.wav"
            for path, frequency, duration in ((speech_one, 440, 0.8), (speech_two, 660, 0.8), (music, 220, 3.0)):
                subprocess.run(
                    [str(ffmpeg), "-y", "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration={duration}", "-c:a", "pcm_s16le", str(path)],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )

            OpenMontageAudioMixer(run_command=run_command, ffprobe=str(ffprobe)).full_mix({
                "tracks": [
                    {"path": str(speech_one), "role": "speech", "start_seconds": 0.0},
                    {"path": str(speech_two), "role": "speech", "start_seconds": 1.0},
                    {"path": str(music), "role": "music", "start_seconds": 0.0, "volume": 0.3},
                ],
                "ducking": {"enabled": True, "music_volume_during_speech": 0.15},
                "normalize": True,
                "target_duration": 3.0,
                "ffmpeg": str(ffmpeg),
                "output_path": str(output),
            })

            probe = subprocess.run(
                [str(ffprobe), "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(output)],
                check=True,
                capture_output=True,
                text=True,
            )
            facts = json.loads(probe.stdout)

        self.assertAlmostEqual(float(facts["format"]["duration"]), 3.0, delta=0.1)
        self.assertEqual([stream["codec_type"] for stream in facts["streams"]], ["audio"])

if __name__ == "__main__":
    unittest.main()
