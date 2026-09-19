import math
import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .segmented_music import OpenMontageSegmentedMusicError, OpenMontageSegmentedMusicMixer


class OpenMontageSegmentedMusicAdapterTests(unittest.TestCase):
    def _inputs(self, root: Path, **overrides: object) -> dict[str, object]:
        video = root / "video.mp4"
        music = root / "music.wav"
        video.write_bytes(b"video-fixture")
        music.write_bytes(b"music-fixture")
        inputs: dict[str, object] = {
            "video_path": str(video),
            "music_path": str(music),
            "music_volume": 0.2,
            "segments": [{"start": 1.0, "end": 2.0}],
            "fade_duration": 0.5,
            "ffmpeg": "ffmpeg-fixture",
            "output_path": str(root / "out.mp4"),
        }
        inputs.update(overrides)
        return inputs

    def test_source_filter_graph_and_output_mapping_are_preserved(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            calls: list[tuple[str, list[str], int]] = []

            def run_command(binary: str, args: list[str], timeout: int) -> str:
                calls.append((binary, args, timeout))
                if binary == "ffprobe-fixture":
                    return "10.0\n"
                Path(args[-1]).write_bytes(b"composed-fixture")
                return ""

            mixer = OpenMontageSegmentedMusicMixer(
                run_command=run_command,
                ffprobe="ffprobe-fixture",
            )
            output = mixer.segmented_music(
                self._inputs(
                    root,
                    segments=[
                        {"start": 3.0, "end": 4.0},
                        {"start": 1.0, "end": 2.0},
                    ],
                )
            )

            self.assertEqual(output, root / "out.mp4")
            self.assertEqual([call[0] for call in calls], ["ffprobe-fixture", "ffmpeg-fixture"])
            self.assertEqual(calls[0][2], 20)
            ffmpeg_args = calls[1][1]
            graph = ffmpeg_args[ffmpeg_args.index("-filter_complex") + 1]
            self.assertLess(graph.index("if(lt(t,1.0)"), graph.index("if(lt(t,3.0)"))
            self.assertIn(
                "if(lt(t,1.0),0,if(lt(t,1.5),0.2*(t-1.0)/0.5,"
                "if(lt(t,1.5),0.2,if(lt(t,2.0),0.2*(2.0-t)/0.5,0))))",
                graph,
            )
            self.assertIn("[speech][music_fmt]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]", graph)
            self.assertEqual(
                ffmpeg_args[ffmpeg_args.index("-map") : ffmpeg_args.index("-c:v")],
                ["-map", "0:v", "-map", "[aout]"],
            )
            self.assertEqual(ffmpeg_args[-1], str(root / "out.mp4"))

    def test_invalid_nonfinite_and_out_of_range_windows_fail_closed(self) -> None:
        cases = [
            ({"segments": []}, "no segments"),
            ({"segments": [{"start": math.nan, "end": 2.0}]}, "nonfinite"),
            ({"segments": [{"start": 1.0, "end": 11.0}]}, "out of range"),
        ]
        for overrides, label in cases:
            with self.subTest(label=label), TemporaryDirectory() as directory:
                root = Path(directory)
                calls: list[str] = []

                def run_command(binary: str, args: list[str], timeout: int) -> str:
                    calls.append(binary)
                    if binary == "ffprobe-fixture":
                        return "10.0\n"
                    raise AssertionError("ffmpeg must not run for invalid input")

                with self.assertRaises(OpenMontageSegmentedMusicError):
                    OpenMontageSegmentedMusicMixer(
                        run_command=run_command,
                        ffprobe="ffprobe-fixture",
                    ).segmented_music(self._inputs(root, **overrides))
                self.assertNotIn("ffmpeg-fixture", calls)

    def test_source_overlapping_windows_remain_additive(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            calls: list[tuple[str, list[str], int]] = []

            def run_command(binary: str, args: list[str], timeout: int) -> str:
                calls.append((binary, args, timeout))
                if binary == "ffprobe-fixture":
                    return "10.0\n"
                Path(args[-1]).write_bytes(b"composed-fixture")
                return ""

            OpenMontageSegmentedMusicMixer(
                run_command=run_command,
                ffprobe="ffprobe-fixture",
            ).segmented_music(
                self._inputs(
                    root,
                    segments=[
                        {"start": 1.0, "end": 3.0},
                        {"start": 2.0, "end": 4.0},
                    ],
                )
            )

            graph = calls[1][1][calls[1][1].index("-filter_complex") + 1]
            self.assertEqual(graph.count("if(lt(t,"), 8)
            self.assertIn(")+(if(lt(t,2.0)", graph)

    def test_invalid_numeric_ranges_and_probe_fail_closed(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for overrides in (
                {"music_volume": -0.1},
                {"music_volume": 1.1},
                {"music_volume": "0.2"},
                {"fade_duration": 0},
                {"fade_duration": math.inf},
                {"segments": [{"start": 1.0, "end": 1.0}]},
            ):
                with self.subTest(overrides=overrides):
                    with self.assertRaises(OpenMontageSegmentedMusicError):
                        OpenMontageSegmentedMusicMixer(
                            run_command=lambda *_args: "10.0\n",
                            ffprobe="ffprobe-fixture",
                        ).segmented_music(self._inputs(root, **overrides))

            with self.assertRaisesRegex(OpenMontageSegmentedMusicError, "probe"):
                OpenMontageSegmentedMusicMixer(
                    run_command=lambda *_args: "nan\n",
                    ffprobe="ffprobe-fixture",
                ).segmented_music(self._inputs(root))

    def test_missing_output_is_an_error_without_fallback(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)

            def run_command(binary: str, _args: list[str], _timeout: int) -> str:
                if binary == "ffprobe-fixture":
                    return "10.0\n"
                return ""

            with self.assertRaisesRegex(OpenMontageSegmentedMusicError, "no output"):
                OpenMontageSegmentedMusicMixer(
                    run_command=run_command,
                    ffprobe="ffprobe-fixture",
                ).segmented_music(self._inputs(root))

    def test_source_operation_produces_verified_local_av_fixture(self) -> None:
        project_root = Path(__file__).resolve().parents[4]
        ffmpeg = project_root / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        ffprobe = project_root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffmpeg.is_file() or not ffprobe.is_file():
            self.skipTest("controlled ffmpeg/ffprobe fixtures are unavailable")

        def run_command(binary: str, args: list[str], timeout: int) -> str:
            completed = subprocess.run(
                [binary, *args],
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return completed.stdout

        with TemporaryDirectory(prefix="alchemy-segmented-music-fixture-") as directory:
            root = Path(directory)
            video = root / "video.mp4"
            music = root / "music.wav"
            output = root / "out.mp4"
            subprocess.run(
                [str(ffmpeg), "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=25:d=4", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                [str(ffmpeg), "-y", "-f", "lavfi", "-i", "sine=frequency=800:duration=4", "-c:a", "pcm_s16le", str(music)],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            OpenMontageSegmentedMusicMixer(run_command=run_command, ffprobe=str(ffprobe)).segmented_music({
                "video_path": str(video),
                "music_path": str(music),
                "music_volume": 0.2,
                "segments": [{"start": 1.0, "end": 2.0}],
                "fade_duration": 0.5,
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

        self.assertEqual([stream["codec_type"] for stream in facts["streams"]], ["video", "audio"])
        self.assertAlmostEqual(float(facts["format"]["duration"]), 4.0, delta=0.2)


if __name__ == "__main__":
    unittest.main()
