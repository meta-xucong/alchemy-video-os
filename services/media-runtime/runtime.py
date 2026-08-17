from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import struct
import subprocess
from tempfile import TemporaryDirectory


MAX_SINGLE_VIDEO_BYTES = 50 * 1024 * 1024
MAX_COMPOSITION_INPUT_BYTES = 160 * 1024 * 1024
MAX_COMPOSITION_SEGMENTS = 12
COMPOSITION_MAGIC = b"ALCHMED1"
COMPOSITION_TRANSITION_SECONDS = 0.6
OPERATION_ID_PATTERN = re.compile(r"^mop_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")


class MediaRuntimeError(ValueError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class VideoInspection:
    mime_type: str
    sha256: str
    byte_size: int
    width: int
    height: int
    duration_ms: int


@dataclass(frozen=True)
class ImageArtifact:
    mime_type: str
    sha256: str
    byte_size: int
    width: int
    height: int
    bytes: bytes


@dataclass(frozen=True)
class CompositionArtifact:
    inspection: VideoInspection
    bytes: bytes


def validate_operation_id(value: str | None) -> str:
    if not value or not OPERATION_ID_PATTERN.fullmatch(value):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Media operation identifier is invalid.")
    return value


def configured_binary(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local media tools are not configured.", retryable=True)
    path = Path(value)
    if not path.is_absolute() or not path.is_file():
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local media tools are not configured.", retryable=True)
    return str(path)


def _run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
    try:
        completed = subprocess.run(
            [binary, *args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout_seconds,
            cwd=None,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local media tools are unavailable.", retryable=True) from error
    if completed.returncode != 0:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "The media operation could not complete.")
    return completed.stdout.decode("utf-8", errors="replace")


def _validated_video_bytes(body: bytes, expected_sha256: str | None) -> str:
    if not body or len(body) > MAX_SINGLE_VIDEO_BYTES:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Video input is outside the supported range.")
    actual = sha256(body).hexdigest()
    if expected_sha256 and actual != expected_sha256:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Video input integrity verification failed.")
    return actual


def _inspect_path(path: Path, byte_size: int, digest: str) -> VideoInspection:
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    output = _run(
        ffprobe,
        [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_type,width,height,duration:format=duration",
            "-of", "json",
            str(path),
        ],
        timeout_seconds=15,
    )
    try:
        parsed = json.loads(output)
        stream = parsed.get("streams", [])[0]
        width = int(stream["width"])
        height = int(stream["height"])
        duration_seconds = float(stream.get("duration", parsed.get("format", {}).get("duration")))
    except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
        raise MediaRuntimeError("QC_FAILED", "The video could not be inspected.") from error
    if stream.get("codec_type") != "video" or width <= 0 or height <= 0 or duration_seconds <= 0:
        raise MediaRuntimeError("QC_FAILED", "The video could not be inspected.")
    return VideoInspection(
        mime_type="video/mp4",
        sha256=digest,
        byte_size=byte_size,
        width=width,
        height=height,
        duration_ms=round(duration_seconds * 1000),
    )


def _has_audio_stream(path: Path) -> bool:
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    output = _run(
        ffprobe,
        [
            "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type",
            "-of", "json",
            str(path),
        ],
        timeout_seconds=15,
    )
    try:
        streams = json.loads(output).get("streams", [])
    except json.JSONDecodeError as error:
        raise MediaRuntimeError("QC_FAILED", "The video audio could not be inspected.") from error
    return bool(streams and streams[0].get("codec_type") == "audio")


def inspect_video_bytes(*, body: bytes, expected_sha256: str | None) -> VideoInspection:
    digest = _validated_video_bytes(body, expected_sha256)
    with TemporaryDirectory(prefix="alchemy-c12-media-") as directory:
        source = Path(directory) / "source.mp4"
        source.write_bytes(body)
        return _inspect_path(source, len(body), digest)


def _png_dimensions(body: bytes) -> tuple[int, int]:
    if len(body) < 24 or body[:8] != b"\x89PNG\r\n\x1a\n" or body[12:16] != b"IHDR":
        raise MediaRuntimeError("QC_FAILED", "The handoff frame is not a readable PNG.")
    width, height = struct.unpack(">II", body[16:24])
    if width <= 0 or height <= 0:
        raise MediaRuntimeError("QC_FAILED", "The handoff frame is not a readable PNG.")
    return width, height


def extract_handoff_frame(*, body: bytes, expected_sha256: str | None) -> ImageArtifact:
    digest = _validated_video_bytes(body, expected_sha256)
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    with TemporaryDirectory(prefix="alchemy-c12-media-") as directory:
        source = Path(directory) / "source.mp4"
        output = Path(directory) / "handoff.png"
        source.write_bytes(body)
        _inspect_path(source, len(body), digest)
        _run(
            ffmpeg,
            ["-y", "-sseof", "-0.5", "-i", str(source), "-frames:v", "1", "-update", "1", "-f", "image2", str(output)],
            timeout_seconds=20,
        )
        image = output.read_bytes() if output.is_file() else b""
    width, height = _png_dimensions(image)
    return ImageArtifact(
        mime_type="image/png",
        sha256=sha256(image).hexdigest(),
        byte_size=len(image),
        width=width,
        height=height,
        bytes=image,
    )


def decode_composition_bundle(body: bytes) -> list[bytes]:
    if len(body) > MAX_COMPOSITION_INPUT_BYTES or len(body) < len(COMPOSITION_MAGIC) + 1:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is outside the supported range.")
    if body[: len(COMPOSITION_MAGIC)] != COMPOSITION_MAGIC:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    count = body[len(COMPOSITION_MAGIC)]
    if count < 1 or count > MAX_COMPOSITION_SEGMENTS:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    cursor = len(COMPOSITION_MAGIC) + 1
    segments: list[bytes] = []
    for _ in range(count):
        if cursor + 4 > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
        length = struct.unpack(">I", body[cursor : cursor + 4])[0]
        cursor += 4
        if length == 0 or length > MAX_SINGLE_VIDEO_BYTES or cursor + length > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
        segments.append(body[cursor : cursor + length])
        cursor += length
    if cursor != len(body):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    return segments


def compose_video_bundle(*, body: bytes, expected_sha256: str | None) -> CompositionArtifact:
    if expected_sha256 and sha256(body).hexdigest() != expected_sha256:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input integrity verification failed.")
    segments = decode_composition_bundle(body)
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    with TemporaryDirectory(prefix="alchemy-c12-media-") as directory:
        root = Path(directory)
        paths: list[Path] = []
        inspections: list[VideoInspection] = []
        audio_present: list[bool] = []
        for index, segment in enumerate(segments, start=1):
            _validated_video_bytes(segment, None)
            path = root / f"segment-{index:02d}.mp4"
            path.write_bytes(segment)
            paths.append(path)
            inspections.append(_inspect_path(path, len(segment), sha256(segment).hexdigest()))
            audio_present.append(_has_audio_stream(path))
        output = root / "composed.mp4"
        if len(paths) == 1:
            _run(
                ffmpeg,
                [
                    "-y", "-i", str(paths[0]),
                    "-map", "0:v:0", "-map", "0:a:0?",
                    "-c:v", "libx264", "-c:a", "aac", "-b:a", "160k",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
                ],
                timeout_seconds=90,
            )
        else:
            transition = COMPOSITION_TRANSITION_SECONDS
            filter_parts: list[str] = []
            processed_video_durations: list[float] = []
            for index, inspection in enumerate(inspections):
                duration_seconds = inspection.duration_ms / 1000
                if index < len(inspections) - 1:
                    filter_parts.append(
                        f"[{index}:v:0]setpts=PTS-STARTPTS,"
                        f"tpad=stop_mode=clone:stop_duration={transition:.3f}[v{index}]"
                    )
                    processed_video_durations.append(duration_seconds + transition)
                else:
                    filter_parts.append(f"[{index}:v:0]setpts=PTS-STARTPTS[v{index}]")
                    processed_video_durations.append(duration_seconds)

            current_video = "v0"
            current_video_duration = processed_video_durations[0]
            for index in range(1, len(inspections)):
                output_label = f"vx{index}"
                offset = max(0.0, current_video_duration - transition)
                filter_parts.append(
                    f"[{current_video}][v{index}]xfade=transition=fade:"
                    f"duration={transition:.3f}:offset={offset:.3f}[{output_label}]"
                )
                current_video = output_label
                current_video_duration += processed_video_durations[index] - transition
            filter_parts.append(f"[{current_video}]format=yuv420p[vout]")

            current_audio = ""
            for index, inspection in enumerate(inspections):
                duration_seconds = inspection.duration_ms / 1000
                audio_label = f"a{index}"
                if audio_present[index]:
                    filter_parts.append(f"[{index}:a:0]asetpts=PTS-STARTPTS[{audio_label}]")
                else:
                    filter_parts.append(
                        "anullsrc=channel_layout=stereo:sample_rate=48000,"
                        f"atrim=duration={duration_seconds:.3f},asetpts=PTS-STARTPTS[{audio_label}]"
                    )
                if index == 0:
                    current_audio = audio_label
                    continue
                padded_audio = f"ap{index - 1}"
                output_label = f"ax{index}"
                filter_parts.append(f"[{current_audio}]apad=pad_dur={transition:.3f}[{padded_audio}]")
                filter_parts.append(
                    f"[{padded_audio}][{audio_label}]acrossfade=d={transition:.3f}:c1=tri:c2=tri[{output_label}]"
                )
                current_audio = output_label

            _run(
                ffmpeg,
                [
                    "-y",
                    *[part for path in paths for part in ("-i", str(path))],
                    "-filter_complex", ";".join(filter_parts),
                    "-map", "[vout]", "-map", f"[{current_audio}]",
                    "-c:v", "libx264", "-c:a", "aac", "-b:a", "160k",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
                ],
                timeout_seconds=90,
            )
        composed = output.read_bytes() if output.is_file() else b""
        digest = _validated_video_bytes(composed, None)
        inspection = _inspect_path(output, len(composed), digest)
        if any(audio_present) and not _has_audio_stream(output):
            raise MediaRuntimeError("QC_FAILED", "The final video audio could not be inspected.")
        expected_duration_ms = sum(item.duration_ms for item in inspections)
        if abs(inspection.duration_ms - expected_duration_ms) > 1500:
            raise MediaRuntimeError("QC_FAILED", "The final video duration could not be verified.")
    return CompositionArtifact(inspection=inspection, bytes=composed)
