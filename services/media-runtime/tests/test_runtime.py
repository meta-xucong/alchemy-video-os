import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest

from main import compose_video, inspect_video
from runtime import (
    COMPOSITION_MAGIC,
    MediaRuntimeError,
    compose_video_bundle,
    decode_composition_bundle,
    extract_handoff_frame,
    validate_operation_id,
)


PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02\x00\x00\x00\x03\x08\x02\x00\x00\x00\x12\x16\xf1M"


class StreamRequest:
    def __init__(self, chunks: list[bytes], mime_type: str) -> None:
        self.headers = {"content-type": mime_type}
        self.chunks = chunks
        self.yielded = 0

    async def stream(self):
        for chunk in self.chunks:
            self.yielded += 1
            yield chunk


def bundle(*segments: bytes) -> bytes:
    return COMPOSITION_MAGIC + bytes([len(segments)]) + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)


class MediaRuntimeTests(unittest.TestCase):
    def test_operation_id_and_bundle_format_reject_paths_and_trailing_data(self) -> None:
        self.assertEqual(validate_operation_id("mop_01J4N8QZ8PCW2N2G6D2XJXJXJX"), "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX")
        with self.assertRaises(MediaRuntimeError):
            validate_operation_id("../../tmp")
        self.assertEqual(decode_composition_bundle(bundle(b"one", b"two")), [b"one", b"two"])
        with self.assertRaises(MediaRuntimeError):
            decode_composition_bundle(bundle(b"one") + b"trailing")

    def test_handoff_uses_only_service_owned_temp_paths_and_validates_png(self) -> None:
        calls: list[list[str]] = []

        def run_tool(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            if "ffprobe" in binary:
                return json.dumps({"streams": [{"codec_type": "video", "width": 160, "height": 90, "duration": "1.0"}]})
            output = args[-1]
            with open(output, "wb") as handle:
                handle.write(PNG)
            return ""

        body = b"mock-mp4"
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe", "MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=run_tool):
            result = extract_handoff_frame(body=body, expected_sha256=hashlib.sha256(body).hexdigest())

        self.assertEqual(result.mime_type, "image/png")
        self.assertEqual((result.width, result.height), (2, 3))
        self.assertEqual(result.sha256, hashlib.sha256(PNG).hexdigest())
        self.assertIn("-0.5", calls[-1])
        self.assertIn("-update", calls[-1])

    def test_handler_stops_oversized_stream_before_later_chunks(self) -> None:
        request = StreamRequest([b"abc", b"de", b"never-read"], "video/mp4")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.MAX_SINGLE_VIDEO_BYTES", 4):
            response = asyncio.run(inspect_video(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=hashlib.sha256(b"abcde").hexdigest(),
            ))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.body), {"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}})
        self.assertEqual(request.yielded, 2)

    def test_compose_handler_rejects_non_bundle_without_reading_media_tools(self) -> None:
        request = StreamRequest([b"not-a-bundle"], "application/vnd.alchemy-media-bundle")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False):
            response = asyncio.run(compose_video(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=None,
            ))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.body), {"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}})

    def test_compose_preserves_audio_and_keeps_duration_when_adding_boundary_fade(self) -> None:
        root = Path(__file__).resolve().parents[3]
        ffmpeg = root / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        ffprobe = root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffmpeg.is_file() or not ffprobe.is_file():
            self.skipTest("local ffmpeg fixtures are unavailable")

        with TemporaryDirectory(prefix="alchemy-runtime-test-") as directory:
            left = Path(directory) / "left.mp4"
            right = Path(directory) / "right.mp4"
            for path, color, frequency in ((left, "red", "440"), (right, "blue", "660")):
                subprocess.run(
                    [
                        str(ffmpeg), "-y",
                        "-f", "lavfi", "-i", f"color=c={color}:s=160x90:r=25:d=1",
                        "-f", "lavfi", "-i", f"sine=frequency={frequency}:sample_rate=48000:duration=1",
                        "-shortest", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", str(path),
                    ],
                    check=True,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            with patch.dict(os.environ, {
                "MEDIA_RUNTIME_FFMPEG_PATH": str(ffmpeg),
                "MEDIA_RUNTIME_FFPROBE_PATH": str(ffprobe),
            }, clear=False):
                composed = compose_video_bundle(body=bundle(left.read_bytes(), right.read_bytes()), expected_sha256=None)

            probe = subprocess.check_output(
                [str(ffprobe), "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", "-i", "pipe:0"],
                input=composed.bytes,
                stderr=subprocess.DEVNULL,
            )
            streams = json.loads(probe).get("streams", [])

        self.assertIn("audio", [stream["codec_type"] for stream in streams])
        self.assertGreaterEqual(composed.inspection.duration_ms, 1900)
        self.assertLessEqual(composed.inspection.duration_ms, 2200)


if __name__ == "__main__":
    unittest.main()
