import hashlib
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
import wave

from .hyperframes_audio import OpenMontageHyperFramesAudio, OpenMontageHyperFramesAudioError


class OpenMontageHyperFramesAudioTests(unittest.TestCase):
    @staticmethod
    def _asset(
        path: Path,
        *,
        asset_id: str,
        duration_ms: int,
        workspace_id: str = "ws_1",
        project_id: str = "prj_1",
        audio_role: str | None = None,
        mime_type: str = "audio/wav",
    ) -> dict[str, object]:
        body = path.read_bytes()
        return {
            "id": asset_id,
            "path": str(path),
            "workspace_id": workspace_id,
            "project_id": project_id,
            "mime_type": mime_type,
            "sha256": hashlib.sha256(body).hexdigest(),
            "byte_size": len(body),
            "duration_ms": duration_ms,
            **({"audio_role": audio_role} if audio_role is not None else {}),
        }

    def test_resolve_preserves_source_timed_audio_contract(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            voice_one = root / "voice-one.wav"
            voice_two = root / "voice-two.wav"
            music = root / "music.wav"
            voice_one.write_bytes(b"voice-one")
            voice_two.write_bytes(b"voice-two")
            music.write_bytes(b"music")
            durations = {voice_one: 2.0, voice_two: 2.0, music: 4.0}
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda path: durations[path])
            result = resolver.resolve(
                {
                    "narration": {"segments": [
                        {"asset_id": "nar-1", "start_seconds": 0, "end_seconds": 2},
                        {"asset_id": "nar-2", "start_seconds": 2, "end_seconds": 4},
                    ]},
                    "music": {"asset_id": "music-1", "volume": 0},
                },
                [
                    self._asset(voice_one, asset_id="nar-1", duration_ms=2_000),
                    self._asset(voice_two, asset_id="nar-2", duration_ms=2_000),
                    self._asset(music, asset_id="music-1", duration_ms=4_000, audio_role="MUSIC"),
                ],
                root,
                total_duration=4,
                workspace_id="ws_1",
                project_id="prj_1",
            )

        self.assertEqual(result.refs["narration"][0]["start_seconds"], 0.0)
        self.assertEqual(result.refs["narration"][1]["end_seconds"], 4.0)
        self.assertEqual(result.refs["music"]["volume"], 0.15)
        self.assertIn('data-composition-id="root"', result.html)
        self.assertIn('data-start="0"', result.html)
        self.assertIn('data-duration="4"', result.html)
        self.assertIn('id="nar-0" data-start="0" data-duration="2"', result.html)
        self.assertIn('id="nar-1" data-start="2" data-duration="2"', result.html)
        self.assertIn('id="music" data-start="0" data-duration="4" data-track-index="3"', result.html)
        self.assertIn('src="voice-one.wav"', result.html)

    def test_source_optional_end_uses_composition_duration(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            voice = root / "voice.wav"
            voice.write_bytes(b"voice")
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 3.0)
            result = resolver.resolve(
                {"narration": {"segments": [{"asset_id": "nar", "start_seconds": 1}]}},
                [self._asset(voice, asset_id="nar", duration_ms=3_000)],
                root,
                total_duration=4,
                workspace_id="ws_1",
                project_id="prj_1",
            )
        self.assertIsNone(result.refs["narration"][0]["end_seconds"])
        self.assertIn('id="nar-0" data-start="1" data-duration="3"', result.html)

    def test_source_explicit_zero_end_uses_composition_duration(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            voice = root / "voice.wav"
            voice.write_bytes(b"voice")
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 3.0)
            result = resolver.resolve(
                {"narration": {"segments": [{"asset_id": "nar", "start_seconds": 1, "end_seconds": 0}]}},
                [self._asset(voice, asset_id="nar", duration_ms=3_000)],
                root,
                total_duration=4,
            )

        self.assertIsNone(result.refs["narration"][0]["end_seconds"])
        self.assertIn('id="nar-0" data-start="1" data-duration="3"', result.html)

    def test_missing_or_outside_assets_fail_closed(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            voice = root / "voice.wav"
            voice.write_bytes(b"voice")
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 1.0)
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "asset is missing"):
                resolver.resolve(
                    {"narration": {"segments": [{"asset_id": "missing", "start_seconds": 0, "end_seconds": 1}]}},
                    [], root, total_duration=1,
                )
            outside = root.parent / "outside.wav"
            outside.write_bytes(b"outside")
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "outside the workspace"):
                resolver.resolve(
                    {"narration": {"segments": [{"asset_id": "outside", "start_seconds": 0, "end_seconds": 1}]}},
                    [self._asset(outside, asset_id="outside", duration_ms=1_000)], root, total_duration=1,
                )

    def test_scope_role_mime_hash_and_probe_facts_fail_closed(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            voice = root / "voice.wav"
            voice.write_bytes(b"voice")
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 1.0)
            sample = self._asset(voice, asset_id="sample", duration_ms=1_000, audio_role="NARRATION_SAMPLE")
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "non-formal"):
                resolver.resolve({"narration": {"segments": [{"asset_id": "sample", "start_seconds": 0, "end_seconds": 1}]}}, [sample], root, total_duration=1, workspace_id="ws_1", project_id="prj_1")
            music = self._asset(voice, asset_id="music", duration_ms=1_000, audio_role="USER_SOURCE_AUDIO")
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "server-owned MUSIC"):
                resolver.resolve({"music": {"asset_id": "music"}}, [music], root, total_duration=1, workspace_id="ws_1", project_id="prj_1")
            wrong_scope = self._asset(voice, asset_id="wrong", duration_ms=1_000, workspace_id="ws_other")
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "workspace is invalid"):
                resolver.resolve({"narration": {"segments": [{"asset_id": "wrong", "start_seconds": 0, "end_seconds": 1}]}}, [wrong_scope], root, total_duration=1, workspace_id="ws_1", project_id="prj_1")
            bad_hash = self._asset(voice, asset_id="bad-hash", duration_ms=1_000)
            bad_hash["sha256"] = "0" * 64
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "SHA-256 does not match"):
                resolver.resolve({"narration": {"segments": [{"asset_id": "bad-hash", "start_seconds": 0, "end_seconds": 1}]}}, [bad_hash], root, total_duration=1)
            bad_probe = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 2.0)
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "ffprobe duration"):
                bad_probe.resolve({"narration": {"segments": [{"asset_id": "voice", "start_seconds": 0, "end_seconds": 1}]}}, [self._asset(voice, asset_id="voice", duration_ms=1_000)], root, total_duration=1)

    def test_invalid_nonfinite_and_short_windows_fail_closed(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.wav"
            second = root / "second.wav"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            assets = [self._asset(first, asset_id="first", duration_ms=2_000), self._asset(second, asset_id="second", duration_ms=2_000)]
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 2.0)
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "start_seconds is invalid"):
                resolver.resolve({"narration": {"segments": [{"asset_id": "first", "start_seconds": float("nan"), "end_seconds": 1}]}}, assets, root, total_duration=2)
            short_resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 1.0)
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "shorter than its window"):
                short_resolver.resolve({"narration": {"segments": [{"asset_id": "first", "start_seconds": 0, "end_seconds": 2}]}}, [self._asset(first, asset_id="first", duration_ms=1_000)], root, total_duration=2)
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "music metadata is invalid"):
                short_resolver.resolve({"music": {"asset_id": "music"}}, [self._asset(first, asset_id="music", duration_ms=1_000, audio_role="MUSIC")], root, total_duration=2)
            with self.assertRaisesRegex(OpenMontageHyperFramesAudioError, "music metadata is invalid"):
                resolver.resolve({"music": {"asset_id": "music", "volume": 1.1}}, [self._asset(first, asset_id="music", duration_ms=2_000, audio_role="MUSIC")], root, total_duration=2)

    def test_source_overlapping_narration_refs_are_preserved(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.wav"
            second = root / "second.wav"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            resolver = OpenMontageHyperFramesAudio(probe_duration=lambda _path: 2.0)
            result = resolver.resolve(
                {"narration": {"segments": [
                    {"asset_id": "first", "start_seconds": 0, "end_seconds": 1.5},
                    {"asset_id": "second", "start_seconds": 1, "end_seconds": 2},
                ]}},
                [self._asset(first, asset_id="first", duration_ms=2_000), self._asset(second, asset_id="second", duration_ms=2_000)],
                root,
                total_duration=2,
            )

        self.assertEqual([ref["start_seconds"] for ref in result.refs["narration"]], [0.0, 1.0])
        self.assertIn('id="nar-0" data-start="0" data-duration="1.5"', result.html)
        self.assertIn('id="nar-1" data-start="1" data-duration="1"', result.html)

    def test_source_timing_uses_controlled_ffprobe_fixture(self) -> None:
        project_root = Path(__file__).resolve().parents[4]
        ffprobe = project_root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffprobe.is_file():
            self.skipTest("controlled ffprobe fixture is unavailable")
        with TemporaryDirectory(prefix="alchemy-hyperframes-audio-fixture-") as directory:
            root = Path(directory)
            voice = root / "voice.wav"
            with wave.open(str(voice), "wb") as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(8_000)
                stream.writeframes(b"\x00\x00" * 8_000)

            def probe(path: Path) -> float:
                completed = subprocess.run(
                    [str(ffprobe), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type,duration:format=duration", "-of", "json", str(path)],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                parsed = json.loads(completed.stdout)
                stream_duration = float(parsed["streams"][0]["duration"])
                format_duration = float(parsed["format"]["duration"])
                return max(stream_duration, format_duration)

            result = OpenMontageHyperFramesAudio(probe_duration=probe).resolve(
                {"narration": {"segments": [{"asset_id": "voice", "start_seconds": 0, "end_seconds": 1}]}},
                [self._asset(voice, asset_id="voice", duration_ms=1_000)],
                root,
                total_duration=1,
                workspace_id="ws_1",
                project_id="prj_1",
            )

        self.assertIn('data-duration="1"', result.html)


if __name__ == "__main__":
    unittest.main()
