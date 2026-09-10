import asyncio
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import sys
from types import SimpleNamespace
from unittest.mock import patch
import unittest
import wave

from main import boundary_frames, burn_captions, compose_video, encode_pixabay_header, health_live, health_ready, inspect_audio, inspect_video, final_review, pixabay_music, synthesize_narration, transcribe_video
import runtime
from adapters.openmontage_audio.pixabay_music import PixabayMusicResult
from runtime import (
    COMPOSITION_MAGIC,
    COMPOSITION_PLAN_MAGIC,
    COMPOSITION_MUSIC_PLAN_MAGIC,
    COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC,
    CompositionAudioTrack,
    CompositionPlan,
    MediaRuntimeError,
    compose_video_bundle,
    decode_composition_bundle,
    decode_composition_bundle_with_plan,
    extract_handoff_frame,
    extract_boundary_frames,
    final_review_video_bytes,
    compare_transcript_to_script,
    check_narration_alignment,
    transcribe_video_bytes,
    synthesize_narration_bytes,
    synthesize_narration_segments_bytes,
    inspect_audio_bytes,
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

    async def json(self):
        return json.loads(b"".join(self.chunks).decode("utf-8"))


def bundle(*segments: bytes) -> bytes:
    return COMPOSITION_MAGIC + bytes([len(segments)]) + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)


def plan_bundle(
    *segments: bytes,
    transition_code: int = 2,
    transition_duration_ms: int = 1_200,
    target_duration_ms: int = 2_000,
    transition_codes: tuple[int, ...] | None = None,
    bridge_durations_ms: tuple[int, ...] | None = None,
) -> bytes:
    codes = transition_codes if transition_codes is not None else (transition_code,) * (len(segments) - 1)
    bridge_values = bridge_durations_ms if bridge_durations_ms is not None else (
        (transition_duration_ms,) * sum(code == 2 for code in codes)
    )
    return (
        COMPOSITION_PLAN_MAGIC
        + bytes([len(segments), len(segments) - 1])
        + bytes(codes)
        + target_duration_ms.to_bytes(4, "big")
        + bytes([len(bridge_values)])
        + b"".join(value.to_bytes(4, "big") for value in bridge_values)
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


def complete_composition_inspection(
    *,
    duration_ms: int,
    width: int = 160,
    height: int = 90,
    has_audio: bool = False,
) -> runtime.VideoInspection:
    """Build a probe-complete fixture for the multi-segment Runtime path."""
    return runtime.VideoInspection(
        mime_type="video/mp4",
        sha256="0" * 64,
        byte_size=3,
        width=width,
        height=height,
        duration_ms=duration_ms,
        has_audio=has_audio,
        audio_channels=2 if has_audio else None,
        audio_sample_rate=48_000 if has_audio else None,
        fps=24.0,
        video_codec="h264",
        pixel_format="yuv420p",
        audio_codec="aac" if has_audio else None,
    )


def ownership_plan_bundle(*segments: bytes, include_narration: bool = True, policy: int = 1, platform_end_ms: int = 2_000) -> bytes:
    tracks = ([
        ("platform-narration", 0, platform_end_ms, 0, 0),
    ] if include_narration else []) + [
        ("segment-1", 0, 1_000, 1, 0),
        ("segment-2", 1_000, 2_000, 2, 1),
    ]
    ownership = bytes([len(tracks)]) + b"".join(
        bytes([len(track_id.encode("utf-8"))]) + track_id.encode("utf-8")
        + bytes([code]) + start.to_bytes(4, "big") + end.to_bytes(4, "big") + bytes([duck])
        for track_id, start, end, code, duck in tracks
    )
    return (
        b"ALCHMED7"
        + bytes([len(segments), len(segments) - 1])
        + bytes([0] * (len(segments) - 1))
        + (2_000).to_bytes(4, "big")
        + bytes([0, policy, 1 if include_narration else 0])
        + (120).to_bytes(2, "big") + bytes([8, 86])
        + int(-15).to_bytes(2, "big", signed=True) + bytes([3, 1])
        + (1_500).to_bytes(2, "big") + (2_500).to_bytes(2, "big") + bytes([1, 0])
        + ownership
        + ((5).to_bytes(4, "big") + b"voice" if include_narration else b"")
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


def ownership_music_plan_bundle(*segments: bytes, include_music: bool = True) -> bytes:
    track_id = b"music"
    ownership = (
        bytes([2])
        + bytes([len(b"platform-narration")]) + b"platform-narration" + bytes([0]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([0])
        + bytes([len(track_id)]) + track_id + bytes([4]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([0])
    )
    return (
        b"ALCHMED7" + bytes([len(segments), len(segments) - 1]) + bytes([0] * (len(segments) - 1))
        + (2_000).to_bytes(4, "big") + bytes([0, 1, (2 if include_music else 0) | 1])
        + (120).to_bytes(2, "big") + bytes([8, 86]) + int(-15).to_bytes(2, "big", signed=True) + bytes([3, 1])
        + (1_500).to_bytes(2, "big") + (2_500).to_bytes(2, "big") + bytes([1, 1])
        + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + ownership
        + (5).to_bytes(4, "big") + b"voice"
        + ((5).to_bytes(4, "big") + b"music" if include_music else b"")
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


def complete_audio_plan_bundle(
    *segments: bytes,
    section_start_ms: int = 0,
    section_end_ms: int = 2_000,
    section_role: int = 0,
    narration_asset_id: str = "ast-narration",
    extra_platform_track: bool = False,
    include_source_track: bool = False,
    source_track_count: int = 2,
    include_music_track: bool = False,
    include_music_payload: bool = False,
    music_windows_ms: tuple[tuple[int, int], ...] = (),
    narration_payload: bytes = b"voice",
    music_payload: bytes = b"music",
) -> bytes:
    def text(value: str, width: int = 1) -> bytes:
        encoded = value.encode("utf-8")
        return len(encoded).to_bytes(width, "big") + encoded

    track = (
        text("platform-narration") + bytes([0]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([0])
        + text("ast-narration") + text("0") + (100).to_bytes(2, "big") + (200).to_bytes(2, "big")
    )
    if extra_platform_track:
        track += (
            text("platform-narration-extra") + bytes([0]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([0])
            + text("ast-narration") + text("0") + (100).to_bytes(2, "big") + (200).to_bytes(2, "big")
        )
    if include_source_track:
        if source_track_count == 1:
            track += (
                text("segment-1") + bytes([2]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([1])
                + text("ast-source-1") + text("-6") + (120).to_bytes(2, "big") + (180).to_bytes(2, "big")
            )
        else:
            track += (
                text("segment-1") + bytes([2]) + (0).to_bytes(4, "big") + (1_000).to_bytes(4, "big") + bytes([1])
                + text("ast-source-1") + text("-6") + (120).to_bytes(2, "big") + (180).to_bytes(2, "big")
                + text("segment-2") + bytes([3]) + (1_000).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([0])
                + text("ast-source-2") + text("-3") + (0).to_bytes(2, "big") + (0).to_bytes(2, "big")
            )
    if include_music_track:
        track += (
            text("music") + bytes([4]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([1])
            + text("ast-music") + text("0") + (100).to_bytes(2, "big") + (200).to_bytes(2, "big")
        )
    include_music = include_music_track or include_music_payload
    plan = (
        bytes([1, 0]) + text(narration_asset_id) + text("ast-timing") + text("第一句。第二句。", 2)
        + bytes([1]) + text("sec_1") + bytes([section_role]) + section_start_ms.to_bytes(4, "big") + section_end_ms.to_bytes(4, "big")
        + bytes([1 + int(extra_platform_track) + int(include_source_track) * source_track_count + int(include_music_track)]) + track
    )
    return (
        b"ALCHMED8" + bytes([len(segments), len(segments) - 1]) + bytes([0] * (len(segments) - 1))
        + (2_000).to_bytes(4, "big") + bytes([0, 1, 1 | (2 if include_music else 0)])
        + (120).to_bytes(2, "big") + bytes([8, 86]) + int(-15).to_bytes(2, "big", signed=True) + bytes([3, 1])
        + (1_500).to_bytes(2, "big") + (2_500).to_bytes(2, "big") + bytes([1, len(music_windows_ms)])
        + b"".join(start_ms.to_bytes(4, "big") + end_ms.to_bytes(4, "big") for start_ms, end_ms in music_windows_ms)
        + plan
        + len(narration_payload).to_bytes(4, "big") + narration_payload
        + (len(music_payload).to_bytes(4, "big") + music_payload if include_music_payload else b"")
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


def complete_section_audio_plan_bundle(*segments: bytes) -> bytes:
    """Build the ALCHMED8 private carrier for measured section speech tracks."""
    def text(value: str, width: int = 1) -> bytes:
        encoded = value.encode("utf-8")
        return len(encoded).to_bytes(width, "big") + encoded

    tracks = b"".join(
        text(track_id)
        + bytes([ownership])
        + start_ms.to_bytes(4, "big")
        + end_ms.to_bytes(4, "big")
        + bytes([0])
        + text(asset_id)
        + text("0")
        + (100).to_bytes(2, "big")
        + (100).to_bytes(2, "big")
        for track_id, asset_id, start_ms, end_ms, ownership in (
            ("narration-ast-1", "ast-1", 0, 2_000, 0),
            ("segment-1", "src-1", 0, 4_000, 6),
            ("narration-ast-2", "ast-2", 2_000, 4_000, 0),
        )
    )
    plan = (
        bytes([1, 0])
        + text("")
        + text("")
        + text("第一段。第二段。", 2)
        + bytes([2])
        + text("sec_1") + bytes([0]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big")
        + text("sec_2") + bytes([0]) + (2_000).to_bytes(4, "big") + (4_000).to_bytes(4, "big")
        + bytes([3])
        + tracks
    )
    return (
        b"ALCHMED8" + bytes([len(segments), len(segments) - 1]) + bytes([0] * (len(segments) - 1))
        + (4_000).to_bytes(4, "big") + bytes([0, 1, 4])
        + (120).to_bytes(2, "big") + bytes([8, 86]) + int(-15).to_bytes(2, "big", signed=True) + bytes([3, 1])
        + (1_500).to_bytes(2, "big") + (2_500).to_bytes(2, "big") + bytes([1, 0])
        + plan
        + bytes([2])
        + text("narration-ast-1") + (4).to_bytes(4, "big") + b"wav1"
        + text("narration-ast-2") + (4).to_bytes(4, "big") + b"wav2"
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


def complete_section_audio_plan_with_music_bundle(
    *segments: bytes,
    music_end_ms: int = 4_000,
    music_duck: int = 1,
    music_windows_ms: tuple[tuple[int, int], ...] = ((0, 4_000),),
) -> bytes:
    """Build the source-shaped ALCHMED8 section plan with one music track."""
    def text(value: str, width: int = 1) -> bytes:
        encoded = value.encode("utf-8")
        return len(encoded).to_bytes(width, "big") + encoded

    tracks = b"".join(
        text(track_id)
        + bytes([ownership])
        + start_ms.to_bytes(4, "big")
        + end_ms.to_bytes(4, "big")
        + bytes([duck])
        + text(asset_id)
        + text(gain_db)
        + fade_in_ms.to_bytes(2, "big")
        + fade_out_ms.to_bytes(2, "big")
        for track_id, asset_id, start_ms, end_ms, ownership, duck, gain_db, fade_in_ms, fade_out_ms in (
            ("narration-ast-1", "ast-1", 0, 2_000, 0, 0, "0", 100, 100),
            ("segment-1", "src-1", 0, 4_000, 6, 0, "0", 0xffff, 0xffff),
            ("music", "ast-music", 0, music_end_ms, 4, music_duck, "-6", 100, 200),
            ("narration-ast-2", "ast-2", 2_000, 4_000, 0, 0, "0", 100, 100),
        )
    )
    plan = (
        bytes([1, 0])
        + text("")
        + text("")
        + text("第一段。第二段。", 2)
        + bytes([2])
        + text("sec_1") + bytes([0]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big")
        + text("sec_2") + bytes([0]) + (2_000).to_bytes(4, "big") + (4_000).to_bytes(4, "big")
        + bytes([4])
        + tracks
    )
    return (
        b"ALCHMED8" + bytes([len(segments), len(segments) - 1]) + bytes([0] * (len(segments) - 1))
        + (4_000).to_bytes(4, "big") + bytes([0, 1, 6])
        + (120).to_bytes(2, "big") + bytes([8, 86]) + int(-15).to_bytes(2, "big", signed=True) + bytes([3, 1])
        + (1_500).to_bytes(2, "big") + (2_500).to_bytes(2, "big") + bytes([1])
        + len(music_windows_ms).to_bytes(1, "big")
        + b"".join(
            start_ms.to_bytes(4, "big") + end_ms.to_bytes(4, "big")
            for start_ms, end_ms in music_windows_ms
        )
        + plan
        + bytes([2])
        + text("narration-ast-1") + (4).to_bytes(4, "big") + b"wav1"
        + text("narration-ast-2") + (4).to_bytes(4, "big") + b"wav2"
        + (5).to_bytes(4, "big") + b"music"
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


def complete_music_only_audio_plan_bundle(*segments: bytes) -> bytes:
    """Build an ALCHMED8 plan whose only authored track is source MUSIC."""
    def text(value: str, width: int = 1) -> bytes:
        encoded = value.encode("utf-8")
        return len(encoded).to_bytes(width, "big") + encoded

    # LEGACY_PRESERVE has no platform narration.  The HOLD section keeps the
    # existing AudioPlan coverage fact explicit while the source full_mix
    # consumes the music track.
    track = (
        text("music") + bytes([4]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big") + bytes([1])
        + text("ast-music") + text("-6") + (100).to_bytes(2, "big") + (200).to_bytes(2, "big")
    )
    plan = (
        bytes([1, 2])
        + text("")
        + text("")
        + text("", 2)
        + bytes([1])
        + text("tail") + bytes([2]) + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big")
        + bytes([1])
        + track
    )
    return (
        b"ALCHMED8" + bytes([len(segments), len(segments) - 1]) + bytes([0] * (len(segments) - 1))
        + (2_000).to_bytes(4, "big") + bytes([0, 0, 2])
        + (120).to_bytes(2, "big") + bytes([8, 86]) + int(-15).to_bytes(2, "big", signed=True) + bytes([3, 1])
        + (1_500).to_bytes(2, "big") + (2_500).to_bytes(2, "big") + bytes([1, 1])
        + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big")
        + plan
        + (5).to_bytes(4, "big") + b"music"
        + b"".join(len(segment).to_bytes(4, "big") + segment for segment in segments)
    )


class MediaRuntimeTests(unittest.TestCase):
    def test_health_live_is_side_effect_free(self) -> None:
        self.assertEqual(asyncio.run(health_live()), {"status": "ok"})

    def test_health_ready_reports_local_runtime_prerequisites(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MEDIA_RUNTIME_TOKEN": "test-token",
                "MEDIA_RUNTIME_FFMPEG_PATH": "/test/ffmpeg",
                "MEDIA_RUNTIME_FFPROBE_PATH": "/test/ffprobe",
            },
            clear=True,
        ), patch("main.configured_binary", side_effect=["/test/ffmpeg", "/test/ffprobe"]):
            self.assertEqual(asyncio.run(health_ready()), {"status": "ready"})

    def test_health_ready_is_retryable_when_token_is_missing(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            response = asyncio.run(health_ready())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body),
            {
                "status": "not_ready",
                "error": {"code": "MEDIA_RUNTIME_UNAVAILABLE", "retryable": True},
            },
        )

    def test_inspect_audio_reports_ffprobe_duration_and_hash(self) -> None:
        body = b"wav-fixture"
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", return_value=json.dumps({"streams": [{"codec_type": "audio", "codec_name": "pcm_s16le", "duration": "1.25"}], "format": {"format_name": "wav", "duration": "1.25"}})):
            result = inspect_audio_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest())
        self.assertEqual(result.mime_type, "audio/wav")
        self.assertEqual(result.byte_size, len(body))
        self.assertEqual(result.duration_ms, 1250)

    def test_inspect_audio_maps_source_ffprobe_formats_and_rejects_unknown(self) -> None:
        body = b"audio-fixture"
        cases = (("mp3", "audio/mpeg"), ("mpeg", "audio/mpeg"), ("wav", "audio/wav"), ("ogg", "audio/ogg"), ("oga", "audio/ogg"))
        for format_name, expected_mime in cases:
            with self.subTest(format_name=format_name), patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", return_value=json.dumps({"streams": [{"codec_type": "audio", "codec_name": "source", "duration": "1.25"}], "format": {"format_name": format_name, "duration": "1.25"}})):
                result = inspect_audio_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest())
            self.assertEqual(result.mime_type, expected_mime)
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", return_value=json.dumps({"streams": [{"codec_type": "audio", "codec_name": "flac", "duration": "1.25"}], "format": {"format_name": "flac", "duration": "1.25"}})):
            with self.assertRaisesRegex(MediaRuntimeError, "could not be inspected"):
                inspect_audio_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest())

    def test_inspect_audio_rejects_nonfinite_stream_or_format_duration(self) -> None:
        body = b"audio-fixture"
        cases = (("NaN", "1.25"), ("1.25", "Infinity"))
        for stream_duration, format_duration in cases:
            with self.subTest(stream_duration=stream_duration, format_duration=format_duration), patch.dict(
                os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False
            ), patch("runtime.Path.is_file", return_value=True), patch(
                "runtime._run",
                return_value=json.dumps({
                    "streams": [{"codec_type": "audio", "codec_name": "source", "duration": stream_duration}],
                    "format": {"format_name": "wav", "duration": format_duration},
                }),
            ):
                with self.assertRaisesRegex(MediaRuntimeError, "could not be inspected"):
                    inspect_audio_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest())

    def test_synthesize_narration_uses_configured_piper_and_returns_verified_wav(self) -> None:
        with TemporaryDirectory(prefix="alchemy-runtime-narration-test-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")
            wav_buffer = BytesIO()
            with wave.open(wav_buffer, "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(16_000)
                writer.writeframes(b"\x00\x00" * 16_000)
            wav_bytes = wav_buffer.getvalue()

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                if "-c" in args:
                    return subprocess.CompletedProcess(args, 0, "", "")
                self.assertIn("--model", args)
                self.assertIn("--length-scale", args)
                self.assertIn("--sentence-silence", args)
                self.assertIn("--output_file", args)
                self.assertNotIn("-i", args)
                self.assertNotIn("-f", args)
                self.assertEqual(kwargs.get("input"), "你好。")
                output = Path(args[args.index("--output_file") + 1])
                output.write_bytes(wav_bytes)
                return subprocess.CompletedProcess(args, 0, "", "")

            with patch.dict(os.environ, {"PIPER_MODEL_PATH": str(model), "PIPER_MODEL_CONFIG_PATH": str(config)}, clear=False), patch("runtime.subprocess.run", side_effect=fake_run):
                audio, duration_ms = synthesize_narration_bytes(text="你好。")
            self.assertEqual(audio, wav_bytes)
            self.assertEqual(duration_ms, 1_000)

    def test_synthesize_narration_sends_complete_canonical_script_once_and_measures_wav(self) -> None:
        canonical_script = "保险 AI 介绍：\n第一句，保障更清晰。\n第二句。"
        with TemporaryDirectory(prefix="alchemy-runtime-canonical-script-test-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")
            wav_buffer = BytesIO()
            with wave.open(wav_buffer, "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(16_000)
                writer.writeframes(b"\x00\x00" * 20_000)
            wav_bytes = wav_buffer.getvalue()
            calls: list[dict[str, object]] = []

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                calls.append({"args": args, **kwargs})
                output = Path(args[args.index("--output_file") + 1])
                output.write_bytes(wav_bytes)
                return subprocess.CompletedProcess(args, 0, "", "")

            with patch("runtime._piper_runtime", return_value=(["piper"], str(model), str(config))), patch("runtime.subprocess.run", side_effect=fake_run):
                audio, duration_ms = synthesize_narration_bytes(text=canonical_script)

        self.assertEqual(audio, wav_bytes)
        self.assertEqual(duration_ms, 1_250)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["input"], canonical_script)
        command = calls[0]["args"]
        self.assertEqual(command[:2], ["piper", "--model"])
        self.assertEqual(command[command.index("--model") + 1], str(model))
        self.assertEqual(command[command.index("--speaker") + 1], "0")
        self.assertEqual(command[command.index("--length-scale") + 1], "1.0")
        self.assertEqual(command[command.index("--sentence-silence") + 1], "0.3")
        self.assertEqual(command[command.index("--output_file") + 1].split("\\")[-1], "narration.wav")

    def test_synthesize_narration_rejects_nonzero_piper_exit(self) -> None:
        with TemporaryDirectory(prefix="alchemy-runtime-piper-exit-test-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")

            def failed_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(args, 17, "", "piper failed")

            with patch("runtime._piper_runtime", return_value=(["piper"], str(model), str(config))), patch("runtime.subprocess.run", side_effect=failed_run):
                with self.assertRaises(MediaRuntimeError) as raised:
                    synthesize_narration_bytes(text="非零退出。")

        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")
        self.assertTrue(raised.exception.retryable)

    def test_synthesize_narration_rejects_missing_piper_output(self) -> None:
        with TemporaryDirectory(prefix="alchemy-runtime-piper-missing-output-test-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")

            def missing_output(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(args, 0, "", "")

            with patch("runtime._piper_runtime", return_value=(["piper"], str(model), str(config))), patch("runtime.subprocess.run", side_effect=missing_output):
                with self.assertRaises(MediaRuntimeError) as raised:
                    synthesize_narration_bytes(text="缺失输出。")

        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")
        self.assertTrue(raised.exception.retryable)

    def test_synthesize_narration_rejects_invalid_piper_wav(self) -> None:
        with TemporaryDirectory(prefix="alchemy-runtime-piper-invalid-wav-test-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")

            def invalid_wav(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                output = Path(args[args.index("--output_file") + 1])
                output.write_bytes(b"not-a-wav")
                return subprocess.CompletedProcess(args, 0, "", "")

            with patch("runtime._piper_runtime", return_value=(["piper"], str(model), str(config))), patch("runtime.subprocess.run", side_effect=invalid_wav):
                with self.assertRaises(MediaRuntimeError) as raised:
                    synthesize_narration_bytes(text="非法 WAV。")

        self.assertEqual(raised.exception.code, "MEDIA_RENDER_FAILED")
        self.assertFalse(raised.exception.retryable)

    def test_synthesize_narration_fails_closed_without_model(self) -> None:
        with patch.dict(os.environ, {"PIPER_MODEL_PATH": "C:\\missing\\voice.onnx", "PIPER_MODEL_CONFIG_PATH": "C:\\missing\\voice.onnx.json"}, clear=False):
            with self.assertRaises(MediaRuntimeError) as raised:
                synthesize_narration_bytes(text="你好。")
        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")
        self.assertTrue(raised.exception.retryable)

    def test_piper_runtime_ignores_path_piper_when_interpreter_is_bound(self) -> None:
        with TemporaryDirectory(prefix="alchemy-runtime-piper-selector-test-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")

            def fake_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                if "-c" in args:
                    return subprocess.CompletedProcess(args, 0, "", "")
                raise AssertionError("the selector should not invoke the PATH Piper when an interpreter is bound")

            with patch.dict(
                os.environ,
                {
                    "PIPER_PYTHON_PATH": runtime.sys.executable,
                    "PIPER_MODEL_PATH": str(model),
                    "PIPER_MODEL_CONFIG_PATH": str(config),
                },
                clear=False,
            ), patch("runtime.shutil.which", return_value="C:\\polluted-path\\piper.exe"), patch("runtime.subprocess.run", side_effect=fake_run):
                command, _, _ = runtime._piper_runtime()
            self.assertEqual(command[:2], [str(Path(runtime.sys.executable).resolve()), "-m"])
            self.assertEqual(command[2], "piper")

    def test_piper_runtime_rejects_path_only_executable_when_bound_interpreter_has_no_module(self) -> None:
        with TemporaryDirectory(prefix="alchemy-runtime-piper-path-rejection-") as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            config = root / "voice.onnx.json"
            model.write_bytes(b"model")
            config.write_bytes(b"{}")

            def missing_module(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                if "-c" in args:
                    return subprocess.CompletedProcess(args, 1, "", "No module named piper")
                raise AssertionError("Piper must not be launched when capability probing fails")

            with patch.dict(
                os.environ,
                {
                    "PIPER_PYTHON_PATH": runtime.sys.executable,
                    "PIPER_MODEL_PATH": str(model),
                    "PIPER_MODEL_CONFIG_PATH": str(config),
                },
                clear=False,
            ), patch("runtime.shutil.which", return_value="C:\\polluted-path\\piper.exe"), patch("runtime.subprocess.run", side_effect=missing_module):
                with self.assertRaises(MediaRuntimeError) as raised:
                    runtime._piper_runtime()
            self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")

    def test_synthesize_narration_segments_preserves_absolute_offsets(self) -> None:
        calls: list[dict[str, object]] = []

        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append({"args": args, "timeout_seconds": timeout_seconds})
            output = Path(args[-1])
            output.write_bytes(b"placed-wav")
            return ""

        with patch("runtime.synthesize_narration_bytes", return_value=(b"full-wav", 2_000)) as synthesize, patch.dict(
            os.environ,
            {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"},
            clear=False,
        ), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=fake_run):
            audio, duration_ms = synthesize_narration_segments_bytes(
                    segments=[{"text": "第一段", "start_ms": 0}],
                    target_duration_ms=10_000,
            )

        self.assertEqual(audio, b"full-wav")
        self.assertEqual(duration_ms, 2_000)
        synthesize.assert_called_once_with(text="第一段", sentence_silence=0.3)
        self.assertEqual(calls, [])

        with patch("runtime.synthesize_narration_bytes", return_value=(b"full-wav", 2_000)), patch.dict(
            os.environ,
            {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"},
            clear=False,
        ), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=fake_run):
            placed, placed_duration_ms = synthesize_narration_segments_bytes(
                segments=[{"text": "从绝对起点", "start_ms": 250}],
                target_duration_ms=10_000,
            )
        self.assertEqual(placed, b"placed-wav")
        self.assertEqual(placed_duration_ms, 2_250)
        graph = calls[-1]["args"][calls[-1]["args"].index("-filter_complex") + 1]
        self.assertIn("adelay=250|250", graph)
        self.assertNotIn("apad=whole_dur", graph)
        self.assertNotIn("atrim=duration", graph)

    def test_synthesize_narration_segments_applies_approved_pronunciation_and_pause_metadata(self) -> None:
        calls: list[dict[str, object]] = []

        def fake_synthesize(*, text: str, sentence_silence: float = 0.3) -> tuple[bytes, int]:
            calls.append({"text": text, "sentence_silence": sentence_silence})
            return b"segment-wav", 1_000

        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"mix-wav")
            return ""

        with patch("runtime.synthesize_narration_bytes", side_effect=fake_synthesize), patch.dict(
            os.environ,
            {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"},
            clear=False,
        ), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=fake_run):
            _audio, duration_ms = synthesize_narration_segments_bytes(
                segments=[{
                    "text": "AI方案。",
                    "start_ms": 250,
                    "pronunciation_guides": [{"source": "AI", "spoken": "人工智能", "reason": "approved"}],
                    "pause_before_ms": 250,
                    "pause_after_ms": 600,
                    "pace": "NATURAL",
                    "energy": "NEUTRAL",
                }],
                target_duration_ms=2_000,
            )

        self.assertEqual(duration_ms, 1_250)
        self.assertEqual(calls, [{"text": "人工智能方案。", "sentence_silence": 0.6}])

    def test_synthesize_narration_segments_does_not_drop_ssml_break_duration(self) -> None:
        with patch("runtime.synthesize_narration_bytes", return_value=(b"segment-wav", 1_000)):
            with self.assertRaisesRegex(MediaRuntimeError, "SSML break") as raised:
                synthesize_narration_segments_bytes(
                    segments=[{"text": "第一句<break time=\"0.6s\"/>第二句", "start_ms": 0}],
                    target_duration_ms=2_000,
                )
        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")

    def test_synthesize_narration_segments_preserves_explicit_zero_pause(self) -> None:
        calls: list[dict[str, object]] = []

        def fake_synthesize(**kwargs: object) -> tuple[bytes, int]:
            calls.append(kwargs)
            return b"segment-wav", 1_000

        with patch("runtime.synthesize_narration_bytes", side_effect=fake_synthesize):
            synthesize_narration_segments_bytes(
                segments=[{"text": "连续口播。", "start_ms": 0, "pause_after_ms": 0}],
                target_duration_ms=2_000,
            )
        self.assertEqual(calls, [{"text": "连续口播。", "sentence_silence": 0.0}])

    def test_synthesize_narration_segments_rejects_unmapped_energy_delivery(self) -> None:
        with patch("runtime.synthesize_narration_bytes", return_value=(b"segment-wav", 1_000)):
            with self.assertRaises(MediaRuntimeError) as raised:
                synthesize_narration_segments_bytes(
                    segments=[{"text": "强调句", "start_ms": 0, "energy": "EMPHATIC"}],
                    target_duration_ms=2_000,
                )
        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")

    def test_synthesize_narration_segments_blocks_unmapped_symbolic_pace_before_piper(self) -> None:
        for pace, expected_code in (
            ("SLOW", "MEDIA_RUNTIME_UNAVAILABLE"),
            ("FAST", "MEDIA_RUNTIME_UNAVAILABLE"),
            ("BRISK", "MEDIA_RENDER_FAILED"),
        ):
            with patch("runtime.synthesize_narration_bytes") as synthesize:
                with self.assertRaises(MediaRuntimeError) as raised:
                    synthesize_narration_segments_bytes(
                        segments=[{"text": "节奏", "start_ms": 0, "pace": pace}],
                        target_duration_ms=2_000,
                    )
            self.assertEqual(raised.exception.code, expected_code)
            synthesize.assert_not_called()

    def test_synthesize_narration_segments_uses_canonical_provider_text(self) -> None:
        with patch("runtime.synthesize_narration_bytes", return_value=(b"segment-wav", 1_000)) as synthesize:
            synthesize_narration_segments_bytes(
                segments=[{
                    "text": "旧显示文本",
                    "provider_text": "规范发音文本",
                    "start_ms": 0,
                }],
                target_duration_ms=2_000,
            )
        synthesize.assert_called_once_with(text="规范发音文本", sentence_silence=0.3)

    def test_narration_segments_reject_overlap_and_out_of_order_cues(self) -> None:
        with patch("runtime.synthesize_narration_bytes", return_value=(b"segment-wav", 2_000)):
            with self.assertRaises(MediaRuntimeError):
                synthesize_narration_segments_bytes(
                    segments=[{"text": "第一段", "start_ms": 1_000}, {"text": "第二段", "start_ms": 0}],
                    target_duration_ms=10_000,
                )
            with self.assertRaises(MediaRuntimeError):
                synthesize_narration_segments_bytes(
                    segments=[{"text": "尾句", "start_ms": 9_000}],
                    target_duration_ms=10_000,
                )
            with self.assertRaises(MediaRuntimeError):
                synthesize_narration_segments_bytes(
                    segments=[{"text": "第一段", "start_ms": 0}, {"text": "第二段", "start_ms": 3_001}],
                    target_duration_ms=10_000,
                )

    def test_multi_cue_narration_is_blocked_before_piper_until_full_mix_is_wired(self) -> None:
        with patch("runtime.synthesize_narration_bytes") as synthesize:
            with self.assertRaisesRegex(MediaRuntimeError, "OpenMontage full_mix") as raised:
                synthesize_narration_segments_bytes(
                    segments=[{"text": "第一段", "start_ms": 0}, {"text": "第二段", "start_ms": 1_000}],
                    target_duration_ms=10_000,
                )
        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")
        synthesize.assert_not_called()

    def test_music_plan_bundle_decodes_a_bounded_music_asset(self) -> None:
        body = (
            COMPOSITION_MUSIC_PLAN_MAGIC
            + bytes([1, 0])
            + (2_000).to_bytes(4, "big")
            + bytes([0, 1])
            + (3).to_bytes(4, "big") + b"wav"
            + (3).to_bytes(4, "big") + b"vid"
        )
        segments, plan = decode_composition_bundle_with_plan(body)
        self.assertEqual(segments, [b"vid"])
        self.assertIsNotNone(plan)
        # ALCHMED4 carries music only and has no policy byte; it must retain
        # legacy source audio rather than being misread as narration takeover.
        self.assertEqual(plan.audio_policy, "LEGACY_PRESERVE")
        self.assertEqual(plan.music_bytes, b"wav")

    def test_advanced_audio_bundle_decodes_mix_settings_and_music_windows(self) -> None:
        body = (
            b"ALCHMED6"
            + bytes([1, 0])
            + (2_000).to_bytes(4, "big")
            + bytes([0, 1, 2])
            + (80).to_bytes(2, "big")
            + bytes([18, 86])
            + int(-15).to_bytes(2, "big", signed=True)
            + bytes([3, 1])
            + (1_500).to_bytes(2, "big")
            + (2_500).to_bytes(2, "big")
            + bytes([1, 1])
            + (0).to_bytes(4, "big") + (2_000).to_bytes(4, "big")
            + (3).to_bytes(4, "big") + b"wav"
            + (3).to_bytes(4, "big") + b"vid"
        )
        segments, plan = decode_composition_bundle_with_plan(body)
        self.assertEqual(segments, [b"vid"])
        self.assertIsNotNone(plan)
        self.assertEqual(plan.music_volume, 0.08)
        self.assertEqual(plan.ducking_reduction_db, 18)
        self.assertEqual(plan.music_segments_ms, ((0, 2000),))

    def test_music_mixer_forks_speech_for_sidechain_and_output(self) -> None:
        calls: list[list[str]] = []
        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            return ""
        with patch("runtime._run", side_effect=fake_run):
            runtime._mix_music_track(
                ffmpeg="ffmpeg",
                source=Path("video.mp4"),
                music=Path("music.wav"),
                output=Path("out.mp4"),
                duration_seconds=30.0,
            )
        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("[speech]asplit=2[speech_key][speech_out]", graph)
        self.assertIn("[music][speech_key]sidechaincompress", graph)
        self.assertIn("ratio=9:", graph)
        self.assertIn("level_sc=1", graph)
        self.assertIn("[speech_out][ducked_duration]amix", graph)
        self.assertIn("duration=longest", graph)
        self.assertNotIn("dropout_transition=0", graph)

    def test_ducking_reduction_uses_openmontage_db_to_linear_conversion(self) -> None:
        self.assertAlmostEqual(runtime._openmontage_ducking_volume(18), 10 ** (-18 / 20), places=7)
        with self.assertRaises(MediaRuntimeError):
            runtime._openmontage_ducking_volume(31)

    def test_music_mixer_omits_zero_duration_fades(self) -> None:
        calls: list[list[str]] = []

        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            return ""

        with patch("runtime._run", side_effect=fake_run):
            runtime._mix_music_track(
                ffmpeg="ffmpeg",
                source=Path("video.mp4"),
                music=Path("music.wav"),
                output=Path("out.mp4"),
                duration_seconds=5.0,
                fade_in_ms=0,
                fade_out_ms=0,
            )
        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertNotIn("afade", graph)

    def test_music_mixer_consumes_audio_plan_gain_and_fades(self) -> None:
        calls: list[list[str]] = []

        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            return ""

        with patch("runtime._run", side_effect=fake_run):
            runtime._mix_music_track(
                ffmpeg="ffmpeg",
                source=Path("video.mp4"),
                music=Path("music.wav"),
                output=Path("out.mp4"),
                duration_seconds=5.0,
                music_gain_db="-6",
                fade_in_ms=100,
                fade_out_ms=200,
            )
        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("volume=-6dB", graph)
        self.assertIn("afade=t=in", graph)
        self.assertIn("afade=t=out", graph)

    def test_music_mixer_supports_absolute_windows_and_openmontage_voice_enhancement(self) -> None:
        calls: list[list[str]] = []
        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            return ""
        with patch("runtime._run", side_effect=fake_run):
            runtime._mix_music_track(
                ffmpeg="ffmpeg",
                source=Path("video.mp4"),
                music=Path("music.wav"),
                output=Path("out.mp4"),
                duration_seconds=30.0,
                music_volume=0.08,
                ducking_reduction_db=18,
                target_lufs=-14,
                true_peak_db=-1.5,
                music_eq_cut_db=3,
                music_segments_ms=((0, 12000), (18000, 30000)),
            )
        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("highpass=f=80", graph)
        self.assertIn("equalizer=f=3000", graph)
        self.assertIn("between(t,0.000,12.000)", graph)
        self.assertIn("loudnorm=I=-14.0:TP=-1.5", graph)
        self.assertIn("-ar", calls[0])
        self.assertIn("48000", calls[0])

    def test_continuous_source_tracks_apply_gain_and_fades_before_concat(self) -> None:
        calls: list[list[str]] = []
        mix_inputs: dict[str, object] = {}
        inspection = complete_composition_inspection(duration_ms=1_000, has_audio=True)

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=True), \
             patch("runtime.inspect_audio_bytes", return_value=runtime.AudioInspection("audio/wav", "1" * 64, 4, 2_000)) as inspect_audio, \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix), \
             patch("runtime._mix_narration_track") as legacy_narration, \
             patch("runtime._mix_music_track") as legacy_music:
            compose_video_bundle(
                body=complete_audio_plan_bundle(b"one", b"two", include_source_track=True),
                expected_sha256=None,
            )

        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("[0:a:0]aresample=48000,volume=-6dB,afade=t=in:st=0:d=0.120,afade=t=out:st=0.820:d=0.180,asetpts=PTS-STARTPTS[a0]", graph)
        self.assertIn("[1:a:0]aresample=48000,volume=-3dB,asetpts=PTS-STARTPTS[a1]", graph)
        self.assertIn("[a0][a1]concat=n=2:v=0:a=1", graph)
        legacy_narration.assert_not_called()
        legacy_music.assert_not_called()
        inspect_audio.assert_called_once()
        self.assertEqual([track["role"] for track in mix_inputs["tracks"]], ["speech", "sfx"])

    def test_compose_consumes_independent_speech_tracks_with_source_full_mix(self) -> None:
        calls: list[list[str]] = []
        mix_inputs: dict[str, object] = {}
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        audio_inspection = runtime.AudioInspection(
            mime_type="audio/wav",
            sha256="1" * 64,
            byte_size=4,
            duration_ms=2_000,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=audio_inspection), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix), \
             patch("runtime._mix_narration_track") as legacy_mix:
            artifact = compose_video_bundle(
                body=complete_section_audio_plan_bundle(b"vid"),
                expected_sha256=None,
            )

        self.assertEqual(artifact.bytes, b"composed")
        legacy_mix.assert_not_called()
        speech_tracks = [track for track in mix_inputs["tracks"] if track["role"] == "speech"]
        self.assertEqual([track["start_seconds"] for track in speech_tracks], [0.0, 2.0])
        self.assertEqual([track["fade_in_seconds"] for track in speech_tracks], [0.1, 0.1])
        self.assertEqual([track["fade_out_seconds"] for track in speech_tracks], [0.1, 0.1])
        self.assertEqual(mix_inputs["target_duration"], 4.0)
        self.assertEqual(mix_inputs["ducking"], {"enabled": True, "music_volume_during_speech": 10 ** (-8 / 20)})
        self.assertIn("narration-ast-1", [track_id for track_id, _bytes in runtime.decode_composition_bundle_with_plan(complete_section_audio_plan_bundle(b"vid"))[1].narration_tracks])
        self.assertTrue(any("composed-full-mix.mp4" in argument for argument in calls[-1]))

    def test_compose_consumes_complete_full_track_audio_plan_with_source_full_mix(self) -> None:
        calls: list[list[str]] = []
        mix_inputs: dict[str, object] = {}
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=2_000,
            has_audio=False,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=runtime.AudioInspection("audio/wav", "1" * 64, 4, 1_000)) as inspect_audio, \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix), \
             patch("runtime._mix_narration_track") as legacy_narration, \
             patch("runtime._mix_music_track") as legacy_music:
            artifact = compose_video_bundle(
                body=complete_audio_plan_bundle(
                    b"vid",
                    include_source_track=True,
                    source_track_count=1,
                    include_music_track=True,
                    include_music_payload=True,
                    music_windows_ms=((0, 2_000),),
                ),
                expected_sha256=None,
            )

        self.assertEqual(artifact.bytes, b"composed")
        legacy_narration.assert_not_called()
        legacy_music.assert_not_called()
        inspect_audio.assert_called_once()
        speech_tracks = [track for track in mix_inputs["tracks"] if track["role"] == "speech"]
        music_tracks = [track for track in mix_inputs["tracks"] if track["role"] == "music"]
        self.assertEqual(len(speech_tracks), 1)
        self.assertEqual(speech_tracks[0]["start_seconds"], 0.0)
        self.assertEqual(speech_tracks[0]["volume"], 1.0)
        self.assertEqual(speech_tracks[0]["fade_in_seconds"], 0.1)
        self.assertEqual(speech_tracks[0]["fade_out_seconds"], 0.2)
        self.assertEqual(len(music_tracks), 1)
        self.assertEqual(music_tracks[0]["start_seconds"], 0.0)
        self.assertAlmostEqual(music_tracks[0]["volume"], 0.12, places=8)
        self.assertEqual(mix_inputs["target_duration"], 2.0)
        self.assertTrue(any("composed-full-mix.mp4" in argument for argument in calls[-1]))

    def test_compose_rejects_short_complete_full_track_without_declared_tail(self) -> None:
        inspection = runtime.VideoInspection(
            mime_type="video/mp4", sha256="0" * 64, byte_size=3,
            width=160, height=90, duration_ms=2_000, has_audio=False,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=runtime.AudioInspection("audio/wav", "1" * 64, 5, 1_000)) as inspect_audio, \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix") as full_mix:
            with self.assertRaisesRegex(MediaRuntimeError, "shorter than the visual plan") as raised:
                compose_video_bundle(
                    body=complete_audio_plan_bundle(
                        b"vid", include_source_track=True, source_track_count=1,
                    ),
                    expected_sha256=None,
                )

        self.assertEqual(raised.exception.code, "QC_FAILED")
        inspect_audio.assert_called_once()
        full_mix.assert_not_called()

    def test_compose_rejects_overlong_complete_full_track_before_source_full_mix(self) -> None:
        inspection = runtime.VideoInspection(
            mime_type="video/mp4", sha256="0" * 64, byte_size=3,
            width=160, height=90, duration_ms=2_000, has_audio=False,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=runtime.AudioInspection("audio/wav", "1" * 64, 5, 2_500)) as inspect_audio, \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix") as full_mix:
            with self.assertRaisesRegex(MediaRuntimeError, "exceeds the visual plan") as raised:
                compose_video_bundle(
                    body=complete_audio_plan_bundle(
                        b"vid", include_source_track=True, source_track_count=1,
                    ),
                    expected_sha256=None,
                )

        self.assertEqual(raised.exception.code, "QC_FAILED")
        inspect_audio.assert_called_once()
        full_mix.assert_not_called()

    def test_compose_consumes_music_only_audio_plan_with_source_full_mix(self) -> None:
        calls: list[list[str]] = []
        mix_inputs: dict[str, object] = {}
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=2_000,
            has_audio=False,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix) as full_mix, \
             patch("runtime._mix_narration_track") as legacy_narration, \
             patch("runtime._mix_music_track") as legacy_music:
            artifact = compose_video_bundle(
                body=complete_music_only_audio_plan_bundle(b"vid"),
                expected_sha256=None,
            )

        self.assertEqual(artifact.bytes, b"composed")
        full_mix.assert_called_once()
        legacy_narration.assert_not_called()
        legacy_music.assert_not_called()
        self.assertEqual(
            [(track["role"], track["start_seconds"], track["volume"])
             for track in mix_inputs["tracks"]],
            [("music", 0.0, 0.12 * (10 ** (-6 / 20)))],
        )
        self.assertEqual(mix_inputs["target_duration"], 2.0)
        self.assertTrue(any("composed-full-mix.mp4" in argument for argument in calls[-1]))

    def test_compose_rejects_overlong_independent_speech_before_source_full_mix(self) -> None:
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        measured = iter((runtime.AudioInspection("audio/wav", "1" * 64, 4, 2_000), runtime.AudioInspection("audio/wav", "2" * 64, 4, 3_000)))

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", side_effect=lambda **_kwargs: next(measured)), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix") as full_mix:
            with self.assertRaisesRegex(MediaRuntimeError, "exceeds the visual plan") as raised:
                compose_video_bundle(body=complete_section_audio_plan_bundle(b"vid"), expected_sha256=None)

        self.assertEqual(raised.exception.code, "QC_FAILED")
        full_mix.assert_not_called()

    def test_compose_rejects_short_independent_speech_without_declared_tail(self) -> None:
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        measured = iter((
            runtime.AudioInspection("audio/wav", "1" * 64, 4, 1_000),
            runtime.AudioInspection("audio/wav", "2" * 64, 4, 1_000),
        ))

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", side_effect=lambda **_kwargs: next(measured)), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix") as full_mix:
            with self.assertRaisesRegex(MediaRuntimeError, "shorter than the visual plan") as raised:
                compose_video_bundle(body=complete_section_audio_plan_bundle(b"vid"), expected_sha256=None)

        self.assertEqual(raised.exception.code, "QC_FAILED")
        full_mix.assert_not_called()

    def test_compose_allows_short_independent_speech_with_full_target_music(self) -> None:
        calls: list[list[str]] = []
        mix_inputs: dict[str, object] = {}
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        measured = iter((
            runtime.AudioInspection("audio/wav", "1" * 64, 4, 1_000),
            runtime.AudioInspection("audio/wav", "2" * 64, 4, 1_000),
        ))

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", side_effect=lambda **_kwargs: next(measured)), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix) as full_mix:
            artifact = compose_video_bundle(
                body=complete_section_audio_plan_with_music_bundle(b"vid"),
                expected_sha256=None,
            )

        self.assertEqual(artifact.bytes, b"composed")
        full_mix.assert_called_once()
        speech_tracks = [track for track in mix_inputs["tracks"] if track["role"] == "speech"]
        self.assertEqual([track["start_seconds"] for track in speech_tracks], [0.0, 2.0])
        self.assertEqual(mix_inputs["target_duration"], 4.0)
        self.assertEqual(
            [(track["role"], track["start_seconds"]) for track in mix_inputs["tracks"]],
            [("speech", 0.0), ("speech", 2.0), ("music", 0.0)],
        )

    def test_compose_maps_audio_plan_music_gain_into_source_full_mix_volume(self) -> None:
        calls: list[list[str]] = []
        mix_inputs: dict[str, object] = {}
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        audio_inspection = runtime.AudioInspection(
            mime_type="audio/wav",
            sha256="1" * 64,
            byte_size=4,
            duration_ms=2_000,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=audio_inspection), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix):
            compose_video_bundle(
                body=complete_section_audio_plan_with_music_bundle(b"vid"),
                expected_sha256=None,
            )

        music_tracks = [track for track in mix_inputs["tracks"] if track["role"] == "music"]
        self.assertEqual(len(music_tracks), 1)
        self.assertAlmostEqual(music_tracks[0]["volume"], 0.12 * (10 ** (-6 / 20)), places=8)
        self.assertEqual(music_tracks[0]["start_seconds"], 0.0)
        self.assertEqual(music_tracks[0]["fade_in_seconds"], 0.1)
        self.assertEqual(music_tracks[0]["fade_out_seconds"], 0.2)
        self.assertEqual(mix_inputs["target_duration"], 4.0)

    def test_compose_maps_music_track_duck_flag_to_source_full_mix(self) -> None:
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        audio_inspection = runtime.AudioInspection(
            mime_type="audio/wav",
            sha256="1" * 64,
            byte_size=4,
            duration_ms=2_000,
        )
        mix_inputs: dict[str, object] = {}

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"composed")
            return ""

        def fake_full_mix(inputs: dict[str, object]) -> None:
            mix_inputs.update(inputs)
            Path(str(inputs["output_path"])).write_bytes(b"mixed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=audio_inspection), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix", side_effect=fake_full_mix):
            compose_video_bundle(
                body=complete_section_audio_plan_with_music_bundle(b"vid", music_duck=0),
                expected_sha256=None,
            )

        self.assertEqual(mix_inputs["ducking"], {"enabled": False, "music_volume_during_speech": 10 ** (-8 / 20)})

    def test_compose_rejects_music_windows_not_expressible_by_source_full_mix(self) -> None:
        inspection = runtime.VideoInspection(
            mime_type="video/mp4",
            sha256="0" * 64,
            byte_size=3,
            width=160,
            height=90,
            duration_ms=4_000,
            has_audio=False,
        )
        audio_inspection = runtime.AudioInspection(
            mime_type="audio/wav",
            sha256="1" * 64,
            byte_size=4,
            duration_ms=2_000,
        )

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime.inspect_audio_bytes", return_value=audio_inspection), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime.OpenMontageAudioMixer.full_mix") as full_mix:
            with self.assertRaisesRegex(MediaRuntimeError, "cannot consume partial or multiple MUSIC windows"):
                compose_video_bundle(
                    body=complete_section_audio_plan_with_music_bundle(
                        b"vid",
                        music_end_ms=2_000,
                        music_windows_ms=((0, 2_000), (2_000, 4_000)),
                    ),
                    expected_sha256=None,
                )
        full_mix.assert_not_called()

    def test_narration_alignment_uses_openmontage_tolerance_and_rejects_gaps(self) -> None:
        checked = check_narration_alignment(
            narration_cues=[
                {"cue_id": "c1", "start_seconds": 0.0, "end_seconds": 2.0},
                {"cue_id": "c2", "start_seconds": 2.1, "end_seconds": 4.0},
            ],
            visual_landmarks=[{"time_seconds": 0.2}, {"time_seconds": 2.4}],
            duration_seconds=4.0,
        )
        self.assertEqual(checked["status"], "NEEDS_ATTENTION")
        self.assertTrue(any("gap" in issue for issue in checked["issues"]))

    def test_narration_alignment_passes_when_each_cue_has_a_visible_landmark(self) -> None:
        checked = check_narration_alignment(
            narration_cues=[{"cue_id": "c1", "start_seconds": 0.0, "end_seconds": 2.0}],
            visual_landmarks=[{"time_seconds": 1.5}],
            duration_seconds=2.0,
        )
        self.assertEqual(checked["status"], "CHECKED")

    def test_transcriber_reports_unavailable_without_optional_source_dependency(self) -> None:
        body = b"mock-video"
        with patch("runtime._validated_video_bytes"), patch("runtime.transcriber_capability", return_value={"status": "UNAVAILABLE", "issues": ["missing"]}):
            result = transcribe_video_bytes(body=body, expected_sha256=None)
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["issues"], ["missing"])

    def test_transcriber_capability_rejects_interpreter_that_is_not_present(self) -> None:
        missing = str(Path(runtime.sys.executable).with_name("missing-media-transcriber.exe"))
        with patch.dict(os.environ, {"MEDIA_TRANSCRIBER_PYTHON_PATH": missing}, clear=False):
            capability = runtime.transcriber_capability()
        self.assertEqual(capability["status"], "UNAVAILABLE")
        self.assertIn("interpreter is unavailable", capability["issues"][0])

    def test_transcriber_capability_probes_the_same_interpreter_and_hf_cache(self) -> None:
        with patch.dict(
            os.environ,
            {"MEDIA_TRANSCRIBER_PYTHON_PATH": runtime.sys.executable, "HF_HOME": "controlled-hf-cache"},
            clear=False,
        ), patch(
            "runtime.subprocess.run",
            return_value=subprocess.CompletedProcess([runtime.sys.executable, "-c", "import faster_whisper"], 0, "", ""),
        ) as probe:
            capability = runtime.transcriber_capability()
        self.assertEqual(capability["status"], "AVAILABLE")
        self.assertEqual(capability["runtime_python"], str(Path(runtime.sys.executable).resolve()))
        self.assertEqual(capability["hf_home"], "controlled-hf-cache")
        self.assertEqual(probe.call_args.args[0][0], str(Path(runtime.sys.executable).resolve()))
        self.assertEqual(probe.call_args.args[0][1:], ["-c", "import faster_whisper"])

    def test_transcriber_preserves_source_word_timestamp_flags_and_rounding(self) -> None:
        calls: dict[str, object] = {}

        class FakeWord:
            word = " hello "
            start = 0.1236
            end = 0.9876
            probability = 0.8766

        class FakeSegment:
            start = 0.1236
            end = 0.9876
            text = " hello "
            words = [FakeWord()]

        class FakeInfo:
            language = "en"
            duration = 1.2346

        class FakeWhisperModel:
            def __init__(self, model_size: str, *, device: str, compute_type: str) -> None:
                calls["model"] = (model_size, device, compute_type)

            def transcribe(self, _path: str, **kwargs: object):
                calls["transcribe"] = kwargs
                return iter([FakeSegment()]), FakeInfo()

        with patch.dict(
            os.environ,
            {"MEDIA_TRANSCRIBER_MODEL": "tiny"},
            clear=False,
        ), patch.dict(
            sys.modules,
            {"faster_whisper": SimpleNamespace(WhisperModel=FakeWhisperModel)},
        ), patch("runtime._validated_video_bytes"), patch(
            "runtime.transcriber_capability",
            return_value={"status": "AVAILABLE", "issues": []},
        ):
            result = transcribe_video_bytes(body=b"fixture-video", expected_sha256=None)

        self.assertEqual(calls["model"], ("tiny", "cpu", "int8"))
        self.assertEqual(calls["transcribe"], {"word_timestamps": True, "vad_filter": True})
        self.assertEqual(result["status"], "CHECKED")
        self.assertEqual(result["language"], "en")
        self.assertEqual(result["duration_seconds"], 1.235)
        self.assertEqual(result["word_timestamps"], [{"word": "hello", "start": 0.124, "end": 0.988, "probability": 0.877}])
        self.assertEqual(result["segments"], [{
            "start": 0.124,
            "end": 0.988,
            "text": "hello",
            "words": [{"word": "hello", "start": 0.124, "end": 0.988, "probability": 0.877}],
        }])

    def test_subtitle_srt_reuses_source_8_word_42_char_grouping_and_ms_rounding(self) -> None:
        nine_words = [{
            "word": "one",
            "start": index * 0.1,
            "end": index * 0.1 + 0.05,
        } for index in range(9)]
        srt = runtime._subtitle_srt_from_transcript({"status": "CHECKED", "word_timestamps": nine_words})
        blocks = [block for block in srt.strip().split("\n\n") if block]
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0].splitlines()[2], "one one one one one one one one")
        self.assertEqual(blocks[1].splitlines()[2], "one")

        eight_long_words = [{
            "word": "aaaaa",
            "start": index * 0.1,
            "end": index * 0.1 + 0.05,
        } for index in range(8)]
        char_limited = runtime._subtitle_srt_from_transcript({"status": "CHECKED", "word_timestamps": eight_long_words})
        char_blocks = [block for block in char_limited.strip().split("\n\n") if block]
        self.assertEqual([block.splitlines()[2] for block in char_blocks], ["aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa aaaaa", "aaaaa"])

        rounded = runtime._subtitle_srt_from_transcript({
            "status": "CHECKED",
            "word_timestamps": [{"word": "carry", "start": 0.0, "end": 0.9999}],
        })
        self.assertIn("00:00:00,000 --> 00:00:01,000", rounded)

    def test_subtitle_srt_accepts_source_rounded_zero_duration_word(self) -> None:
        srt = runtime._subtitle_srt_from_transcript({
            "status": "CHECKED",
            "word_timestamps": [
                {"word": "前", "start": 4.4, "end": 4.6},
                {"word": "內", "start": 4.6, "end": 4.6},
                {"word": "後", "start": 4.6, "end": 4.8},
            ],
        })
        self.assertIn("前 內 後", srt)

    def test_transcript_comparison_matches_source_openmontage_threshold(self) -> None:
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "Hello"}, {"word": "world"}]}
        result = compare_transcript_to_script(transcript=transcript, script_text="Hello world")
        self.assertEqual(result["status"], "CHECKED")
        self.assertTrue(result["transcript_matches_script"])
        self.assertEqual(result["word_accuracy"], 1.0)
        self.assertEqual(result["issues"], [])

    def test_transcript_comparison_tolerates_cjk_asr_homophones(self) -> None:
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "受夠城市霧媽尾氣就來毛山溫泉陶里春風"}]}
        result = compare_transcript_to_script(
            transcript=transcript,
            script_text="受够城市雾霾尾气就来茅山温泉桃李春风",
        )
        self.assertEqual(result["status"], "CHECKED")
        self.assertTrue(result["transcript_matches_script"])
        self.assertEqual(result["word_accuracy"], 1.0)

    def test_transcript_comparison_collapses_spelled_acronyms(self) -> None:
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "拥有一支"}, {"word": "A"}, {"word": "I"}, {"word": "营销团队"}]}
        result = compare_transcript_to_script(transcript=transcript, script_text="拥有一支 AI 营销团队")
        self.assertTrue(result["transcript_matches_script"])
        self.assertEqual(result["issues"], [])

    def test_transcript_comparison_ignores_asr_homophone_for_chinese_script_acronym(self) -> None:
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "拥有一支艾艾营销团队"}]}
        result = compare_transcript_to_script(transcript=transcript, script_text="拥有一支 AI 营销团队")
        self.assertTrue(result["transcript_matches_script"])
        self.assertEqual(result["issues"], [])

    def test_transcript_comparison_accepts_spoken_chinese_numbers_for_numeric_copy(self) -> None:
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "晚上十点四十一分一条消息被秒回内容日产四十七条让每一位代理人都有一支艾艾营销团队"}]}
        result = compare_transcript_to_script(
            transcript=transcript,
            script_text="晚上10点41分，一条消息被秒回。内容日产47条，让每一位代理人都有一支 AI 营销团队。",
        )
        self.assertTrue(result["transcript_matches_script"])
        self.assertEqual(result["issues"], [])

    def test_transcript_comparison_flags_inserted_cjk_filler(self) -> None:
        result = compare_transcript_to_script(
            transcript={
                "status": "CHECKED",
                "word_timestamps": [
                    {"word": word, "start": index * 0.1, "end": index * 0.1 + 0.05}
                    for index, word in enumerate("富含高浓度负氧离子啊推窗尽揽草木清香")
                ],
            },
            script_text="富含高浓度负氧离子推窗尽揽草木清香",
        )
        self.assertFalse(result["transcript_matches_script"])
        self.assertTrue(any("inserted spoken characters" in issue for issue in result["issues"]))

    def test_transcript_comparison_flags_missing_cjk_script_content(self) -> None:
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "受夠城市"}]}
        result = compare_transcript_to_script(
            transcript=transcript,
            script_text="受够城市雾霾尾气就来茅山温泉桃李春风",
        )
        self.assertEqual(result["status"], "CHECKED")
        self.assertFalse(result["transcript_matches_script"])
        self.assertIn("Low transcript-to-script coverage", result["issues"][0])

    def test_transcript_comparison_skips_visual_only_story_without_warning(self) -> None:
        result = compare_transcript_to_script(
            transcript={"status": "CHECKED", "word_timestamps": [{"word": "ambient"}]},
            script_text=None,
        )
        self.assertEqual(result["status"], "NOT_EXPECTED")
        self.assertIsNone(result["transcript_matches_script"])
        self.assertEqual(result["issues"], [])

    def test_final_review_records_technical_pass_and_unavailable_semantic_checks(self) -> None:
        body = b"mock-final"
        technical = {
            "valid_container": True,
            "duration_seconds": 15.0,
            "resolution": "848x480",
            "fps": 24.0,
            "has_audio": True,
            "codec": "h264",
            "file_size_bytes": len(body),
            "issues": [],
            "audio_channels": 2,
            "audio_sample_rate": 48000,
        }
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe", "MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), \
             patch("runtime.Path.is_file", return_value=True), \
             patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(4, False, [])), \
             patch("runtime._audio_review", return_value=(False, [])), \
             patch("runtime.visual_semantic_review", return_value={"status": "UNAVAILABLE", "issues": ["missing"]}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "UNAVAILABLE", "issues": ["missing"]}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest()).payload
        self.assertEqual(review["status"], "NEEDS_ATTENTION")
        self.assertEqual(review["visual_spotcheck"]["frames_sampled"], 4)
        self.assertEqual(review["semantic_evaluation"]["status"], "UNAVAILABLE")
        self.assertEqual(review["transcript_comparison"]["status"], "NOT_EXPECTED")
        self.assertEqual(review["recommended_action"], "PRESENT_WITH_REVIEW")

    def test_audio_review_marks_source_aligned_long_silence_for_review(self) -> None:
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
             patch("runtime.Path.is_file", return_value=True), \
             patch("runtime._run_capture", return_value=(0, "silence_start: 22.8\\nsilence_end: 30.1 | silence_duration: 7.3\\n")):
            unexpected, issues = runtime._audio_review(
                Path("tail.mp4"),
                30.1,
                {"has_audio": True},
            )
        self.assertFalse(unexpected)
        self.assertTrue(any("静音" in issue for issue in issues))

    def test_audio_review_blocks_near_total_silence(self) -> None:
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
             patch("runtime.Path.is_file", return_value=True), \
             patch("runtime._run_capture", return_value=(0, "silence_start: 0.0\\nsilence_end: 29.2 | silence_duration: 29.2\\n")):
            unexpected, issues = runtime._audio_review(
                Path("silent.mp4"),
                30.0,
                {"has_audio": True},
            )
        self.assertTrue(unexpected)
        self.assertTrue(any("大段异常静音" in issue for issue in issues))

    def test_audio_review_blocks_authoritative_narration_gap_over_one_second(self) -> None:
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
             patch("runtime.Path.is_file", return_value=True), \
             patch("runtime._run_capture", return_value=(0, "silence_start: 12.0\\nsilence_end: 13.2 | silence_duration: 1.2\\n")):
            unexpected, issues = runtime._audio_review(
                Path("narrated-gap.mp4"),
                30.0,
                {"has_audio": True},
                authoritative_narration=True,
            )
        self.assertTrue(unexpected)
        self.assertTrue(any("大段异常静音" in issue for issue in issues))

    def test_final_review_keeps_marked_planned_hold_as_reviewable(self) -> None:
        body = b"mock-final"
        technical = {"valid_container": True, "duration_seconds": 30.0, "resolution": "848x480", "fps": 24.0,
                     "has_audio": True, "codec": "h264", "file_size_bytes": len(body), "issues": [],
                     "audio_channels": 2, "audio_sample_rate": 48000}
        with patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(1, False, [])), \
             patch("runtime._audio_review", return_value=(False, ["存在约 7.0 秒长静音段"])), \
             patch("runtime._audio_loudness_metrics", return_value={}), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "NOT_EXPECTED", "issues": []}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest()).payload
        self.assertEqual(review["recommended_action"], "PRESENT_WITH_REVIEW")

    def test_final_review_accepts_source_visual_evaluator_result(self) -> None:
        body = b"mock-final"
        technical = {
            "valid_container": True, "duration_seconds": 15.0, "resolution": "848x480", "fps": 24.0,
            "has_audio": True, "codec": "h264", "file_size_bytes": len(body), "issues": [],
            "audio_channels": 2, "audio_sample_rate": 48000,
        }
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe", "MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), \
             patch("runtime.Path.is_file", return_value=True), \
             patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(4, False, [])), \
             patch("runtime._audio_review", return_value=(False, [])), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "CHECKED", "word_timestamps": [], "issues": []}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest()).payload
        self.assertEqual(review["semantic_evaluation"]["status"], "CHECKED")

    def test_final_review_blocks_long_tail_silence(self) -> None:
        body = b"mock-final"
        technical = {"valid_container": True, "duration_seconds": 15.0, "resolution": "848x480", "fps": 24.0,
                     "has_audio": True, "codec": "h264", "file_size_bytes": len(body), "issues": [],
                     "audio_channels": 2, "audio_sample_rate": 48000}
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
             patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(1, False, [])), \
             patch("runtime._audio_review", return_value=(True, ["音频存在大段异常静音。"])), \
             patch("runtime._audio_loudness_metrics", return_value={}), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "UNAVAILABLE", "issues": []}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest()).payload
        self.assertEqual(review["recommended_action"], "BLOCK")

    def test_final_review_blocks_missing_audio_track(self) -> None:
        body = b"mock-final"
        technical = {"valid_container": True, "duration_seconds": 5.0, "resolution": "848x480", "fps": 24.0,
                     "has_audio": False, "codec": "h264", "file_size_bytes": len(body), "issues": []}
        with patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(1, False, [])), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "NOT_EXPECTED", "issues": []}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest()).payload
        self.assertEqual(review["recommended_action"], "BLOCK")

    def test_final_review_blocks_required_captions_without_caption_artifact(self) -> None:
        body = b"mock-final"
        technical = {
            "valid_container": True, "duration_seconds": 5.0, "resolution": "848x480", "fps": 24.0,
            "has_audio": True, "codec": "h264", "file_size_bytes": len(body), "issues": [],
            "audio_channels": 2, "audio_sample_rate": 48000,
        }
        with patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(1, False, [])), \
             patch("runtime._audio_review", return_value=(False, [])), \
             patch("runtime._audio_loudness_metrics", return_value={}), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "NOT_EXPECTED", "issues": []}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest(), caption_policy="REQUIRED").payload
        self.assertEqual(review["subtitle_check"]["status"], "UNAVAILABLE")
        self.assertTrue(review["subtitle_check"]["subtitles_expected"])
        self.assertEqual(review["recommended_action"], "BLOCK")

    def test_final_review_accepts_required_captions_when_burn_marker_is_verified(self) -> None:
        body = b"captioned-final"
        technical = {
            "valid_container": True, "duration_seconds": 5.0, "resolution": "848x480", "fps": 24.0,
            "has_audio": True, "codec": "h264", "file_size_bytes": len(body), "issues": [],
            "audio_channels": 2, "audio_sample_rate": 48000, "captions_present": True,
        }
        with patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(4, False, [])), \
             patch("runtime._audio_review", return_value=(False, [])), \
             patch("runtime._audio_loudness_metrics", return_value={}), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value={"status": "NOT_EXPECTED", "issues": []}):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest(), caption_policy="REQUIRED").payload
        self.assertEqual(review["subtitle_check"]["status"], "CHECKED")
        self.assertTrue(review["subtitle_check"]["subtitles_present"])
        self.assertNotEqual(review["recommended_action"], "BLOCK")

    def test_caption_burn_uses_checked_word_timestamps_and_marks_artifact(self) -> None:
        body = b"mock-final"
        output_bytes = b"captioned-mp4"
        inspected = runtime.VideoInspection("video/mp4", hashlib.sha256(output_bytes).hexdigest(), len(output_bytes), 160, 90, 1_000, True, 2, 48_000)
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "你好", "start": 0.0, "end": 0.4}]}
        calls: list[list[str]] = []

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(output_bytes)
            return ""

        with patch("runtime._validated_video_bytes", return_value=hashlib.sha256(body).hexdigest()), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime._inspect_path", return_value=inspected):
            artifact = runtime.burn_captions_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest(), transcript=transcript)

        self.assertEqual(artifact.bytes, output_bytes)
        self.assertEqual(artifact.inspection.sha256, hashlib.sha256(output_bytes).hexdigest())
        self.assertIn("subtitles=", calls[0][calls[0].index("-vf") + 1])
        self.assertRegex(
            calls[0][calls[0].index("-vf") + 1],
            r"force_style='FontName=Arial,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=40'",
        )
        self.assertEqual(calls[0][calls[0].index("-c:a") + 1], "copy")
        self.assertIn("alchemy_captions=burned_srt", calls[0])

    def test_caption_burn_real_bundled_mp4_preserves_audio_and_marker(self) -> None:
        repository_root = Path(__file__).resolve().parents[3]
        ffmpeg_path = Path(os.environ.get(
            "N04_BUNDLED_FFMPEG_PATH",
            repository_root / "node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg.exe",
        ))
        ffprobe_path = Path(os.environ.get(
            "N04_BUNDLED_FFPROBE_PATH",
            repository_root / "node_modules/.pnpm/ffprobe-static@3.1.0/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe",
        ))
        self.assertTrue(ffmpeg_path.is_file(), f"bundled ffmpeg is unavailable: {ffmpeg_path}")
        self.assertTrue(ffprobe_path.is_file(), f"bundled ffprobe is unavailable: {ffprobe_path}")

        with TemporaryDirectory(prefix="alchemy-n04-real-caption-") as directory:
            root = Path(directory)
            source = root / "source.mp4"
            completed = subprocess.run(
                [
                    str(ffmpeg_path), "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=black:s=160x90:r=24",
                    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
                    "-t", "1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "64k", str(source),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            body = source.read_bytes()
            digest = hashlib.sha256(body).hexdigest()
            env = {
                "MEDIA_RUNTIME_FFMPEG_PATH": str(ffmpeg_path),
                "MEDIA_RUNTIME_FFPROBE_PATH": str(ffprobe_path),
            }
            with patch.dict(os.environ, env, clear=False):
                artifact = runtime.burn_captions_video_bytes(
                    body=body,
                    expected_sha256=digest,
                    transcript={
                        "status": "CHECKED",
                        "duration_seconds": 1.0,
                        "word_timestamps": [{"word": "fixture", "start": 0.1, "end": 0.8}],
                    },
                )
            output = root / "captioned.mp4"
            output.write_bytes(artifact.bytes)
            probed = subprocess.run(
                [
                    str(ffprobe_path), "-v", "error",
                    "-show_entries", "stream=codec_type,codec_name:format=duration:format_tags=alchemy_captions",
                    "-of", "json", str(output),
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            parsed = json.loads(probed.stdout)
            streams = parsed.get("streams", [])
            measured_duration_ms = round(float(parsed.get("format", {}).get("duration", 0)) * 1_000)
            tags = parsed.get("format", {}).get("tags", {})
            self.assertTrue(artifact.inspection.has_audio)
            self.assertEqual(artifact.inspection.duration_ms, measured_duration_ms)
            self.assertEqual(artifact.inspection.sha256, hashlib.sha256(artifact.bytes).hexdigest())
            self.assertEqual(artifact.inspection.byte_size, len(artifact.bytes))
            self.assertTrue(any(stream.get("codec_type") == "audio" for stream in streams))
            self.assertEqual(tags.get("alchemy_captions"), "burned_srt")

    def test_caption_burn_requires_checked_source_timing_before_ffmpeg(self) -> None:
        body = b"mock-final"
        with patch("runtime._validated_video_bytes", return_value=hashlib.sha256(body).hexdigest()), patch("runtime._run") as run:
            with self.assertRaises(MediaRuntimeError) as raised:
                runtime.burn_captions_video_bytes(
                    body=body,
                    expected_sha256=hashlib.sha256(body).hexdigest(),
                    transcript={"status": "CHECKED", "segments": []},
                )
        self.assertEqual(raised.exception.code, "MEDIA_RUNTIME_UNAVAILABLE")
        run.assert_not_called()

    def test_caption_burn_handler_returns_marked_video_headers(self) -> None:
        body = b"mock-final"
        output = b"captioned"
        digest = hashlib.sha256(output).hexdigest()
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "你好", "start": 0.0, "end": 0.4}]}
        request = StreamRequest([json.dumps({
            "video_base64": base64.b64encode(body).decode("ascii"),
            "transcript": transcript,
        }).encode("utf-8")], "application/json")
        artifact = runtime.CompositionArtifact(
            inspection=runtime.VideoInspection("video/mp4", digest, len(output), 160, 90, 1_000, True),
            bytes=output,
        )
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.burn_captions_video_bytes", return_value=artifact) as burn:
            response = asyncio.run(burn_captions(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=hashlib.sha256(body).hexdigest(),
            ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-media-captions-present"], "true")
        self.assertEqual(response.body, output)
        self.assertEqual(burn.call_args.kwargs["transcript"]["word_timestamps"][0]["word"], "你好")

    def test_caption_handler_rejects_raw_mp4_and_malformed_json(self) -> None:
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False):
            raw = asyncio.run(burn_captions(
                request=StreamRequest([b"not-json"], "video/mp4"),
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJ",
                x_media_expected_sha256=hashlib.sha256(b"not-json").hexdigest(),
            ))
            malformed = asyncio.run(burn_captions(
                request=StreamRequest([b"{\"video_base64\":\"***\"}"], "application/json"),
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJ",
                x_media_expected_sha256=hashlib.sha256(b"bad").hexdigest(),
            ))
        self.assertEqual(raw.status_code, 400)
        self.assertEqual(malformed.status_code, 400)

    def test_caption_handler_rejects_oversized_video_base64(self) -> None:
        body = b"x" * (runtime.MAX_SINGLE_VIDEO_BYTES + 1)
        payload = json.dumps({"video_base64": base64.b64encode(body).decode("ascii")}).encode("utf-8")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False):
            response = asyncio.run(burn_captions(
                request=StreamRequest([payload], "application/json"),
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJ",
                x_media_expected_sha256=hashlib.sha256(body).hexdigest(),
            ))
        self.assertEqual(response.status_code, 400)

    def test_pixabay_handler_uses_source_adapter_and_returns_private_metadata_headers(self) -> None:
        output = b"ID3\x04\x00\x00fixture"

        class FakePixabayMusic:
            def execute(self, inputs: dict[str, object]) -> PixabayMusicResult:
                output_path = Path(str(inputs["output_path"]))
                output_path.write_bytes(output)
                return PixabayMusicResult(
                    track={"title": "企业主题", "artist": "source-artist", "duration": 42.5, "rating": 4.75, "download_count": 321, "pixabay_id": 77},
                    output_path=output_path,
                    results_found=3,
                    results_after_filter=1,
                )

        request = StreamRequest([json.dumps({"query": "corporate background", "min_duration": 30, "max_duration": 60}).encode("utf-8")], "application/json")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.PixabayMusic", FakePixabayMusic):
            response = asyncio.run(pixabay_music(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.body, output)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.headers["x-media-sha256"], hashlib.sha256(output).hexdigest())
        self.assertEqual(response.headers["x-media-byte-size"], str(len(output)))
        self.assertEqual(base64.urlsafe_b64decode(response.headers["x-pixabay-track-title-base64"]), "企业主题".encode("utf-8"))
        self.assertEqual(response.headers["x-pixabay-rating"], "4.75")
        self.assertEqual(response.headers["x-pixabay-download-count"], "321")
        self.assertEqual(response.headers["x-pixabay-results-found"], "3")
        self.assertEqual(response.headers["x-pixabay-results-after-filter"], "1")

    def test_pixabay_handler_rejects_invalid_request_without_running_source(self) -> None:
        request = StreamRequest([json.dumps({"query": ""}).encode("utf-8")], "application/json")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.PixabayMusic") as tool:
            response = asyncio.run(pixabay_music(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 400)
        tool.return_value.execute.assert_not_called()

    def test_pixabay_handler_rejects_nonfinite_duration_without_running_source(self) -> None:
        for raw_payload in (
            b'{"query":"ambient","min_duration":NaN}',
            b'{"query":"ambient","max_duration":Infinity}',
            b'{"query":"ambient","max_duration":-Infinity}',
        ):
            request = StreamRequest([raw_payload], "application/json")
            with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.PixabayMusic") as tool:
                response = asyncio.run(pixabay_music(
                    request=request,
                    authorization="Bearer runtime-test-token",
                    x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                ))
            self.assertEqual(response.status_code, 400)
            tool.return_value.execute.assert_not_called()

    def test_pixabay_handler_bounds_chunked_json_without_content_length(self) -> None:
        request = StreamRequest([b'{"query"', b':"ambient"}', b'never-read'], "application/json")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), \
             patch("main.MAX_PIXABAY_REQUEST_BYTES", 10), patch("main.PixabayMusic") as tool:
            response = asyncio.run(pixabay_music(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(request.yielded, 2)
        tool.return_value.execute.assert_not_called()

    def test_mix_narration_reads_duration_from_ffprobe_stdout(self) -> None:
        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("4.0\n", "")) as probe, \
             patch("runtime._run") as run:
            runtime._mix_narration_track(ffmpeg="ffmpeg", source=Path("source.mp4"), narration=Path("voice.wav"), output=Path("out.mp4"), duration_seconds=5.0, allow_tail_fill=True, music_segments_ms=((0, 5_000),))
        probe.assert_called_once()
        run.assert_called_once()

    def test_mix_narration_consumes_platform_gain_and_fade_fields(self) -> None:
        calls: list[list[str]] = []

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            return ""

        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("5.0\n", "")), \
             patch("runtime._run", side_effect=fake_run):
            runtime._mix_narration_track(
                ffmpeg="ffmpeg",
                source=Path("source.mp4"),
                narration=Path("voice.wav"),
                output=Path("out.mp4"),
                duration_seconds=5.0,
                narration_gain_db="-3",
                narration_fade_in_ms=100,
                narration_fade_out_ms=200,
            )
        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("volume=-3dB", graph)
        self.assertIn("afade=t=in", graph)
        self.assertIn("afade=t=out", graph)

    def test_mix_narration_ducks_declared_source_ambience_under_platform_voice(self) -> None:
        calls: list[list[str]] = []

        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            return ""

        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("5.0\n", "")), \
             patch("runtime._run", side_effect=fake_run):
            runtime._mix_narration_track(
                ffmpeg="ffmpeg",
                source=Path("source.mp4"),
                narration=Path("voice.wav"),
                output=Path("out.mp4"),
                duration_seconds=5.0,
                preserve_source_audio=True,
                source_audio_ducked=True,
            )
        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("sidechaincompress", graph)
        self.assertIn("ratio=9:", graph)
        self.assertIn("level_sc=1", graph)
        self.assertIn("[source_audio][narration_key]", graph)

    def test_mix_narration_blocks_short_track_without_declared_tail_or_music(self) -> None:
        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("4.0\n", "")), \
             patch("runtime._run") as run:
            with self.assertRaises(MediaRuntimeError) as raised:
                runtime._mix_narration_track(
                    ffmpeg="ffmpeg",
                    source=Path("source.mp4"),
                    narration=Path("voice.wav"),
                    output=Path("out.mp4"),
                    duration_seconds=5.0,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_mix_narration_blocks_music_window_that_does_not_cover_short_tail(self) -> None:
        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("4.0\n", "")), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "music windows"):
                runtime._mix_narration_track(
                    ffmpeg="ffmpeg",
                    source=Path("source.mp4"),
                    narration=Path("voice.wav"),
                    output=Path("out.mp4"),
                    duration_seconds=5.0,
                    allow_tail_fill=True,
                    music_segments_ms=((0, 4_500),),
                )
        run.assert_not_called()

    def test_mix_narration_allows_short_track_only_with_declared_visual_tail(self) -> None:
        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("4.0\n", "")), \
             patch("runtime._run") as run:
            runtime._mix_narration_track(
                ffmpeg="ffmpeg",
                source=Path("source.mp4"),
                narration=Path("voice.wav"),
                output=Path("out.mp4"),
                duration_seconds=5.0,
                allow_tail_fill=True,
                visual_tail_windows_ms=((4_000, 5_000),),
            )
        run.assert_called_once()

    def test_mix_narration_blocks_any_overrun_without_a_declared_visual_tail(self) -> None:
        with patch("runtime.configured_binary", return_value="ffprobe"), \
             patch("runtime._run_capture", return_value=("5.5\n", "")), \
             patch("runtime._run") as run:
            with self.assertRaises(MediaRuntimeError) as raised:
                runtime._mix_narration_track(
                    ffmpeg="ffmpeg",
                    source=Path("source.mp4"),
                    narration=Path("voice.wav"),
                    output=Path("out.mp4"),
                    duration_seconds=5.0,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_final_review_uses_automatically_bound_script_context(self) -> None:
        body = b"mock-final"
        technical = {
            "valid_container": True, "duration_seconds": 15.0, "resolution": "848x480", "fps": 24.0,
            "has_audio": True, "codec": "h264", "file_size_bytes": len(body), "issues": [],
            "audio_channels": 2, "audio_sample_rate": 48000,
        }
        transcript = {"status": "CHECKED", "word_timestamps": [{"word": "你好", "start": 0, "end": 1}], "issues": []}
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe", "MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), \
             patch("runtime.Path.is_file", return_value=True), \
             patch("runtime._probe_final_review_technical", return_value=technical), \
             patch("runtime._sample_review_frames", return_value=(4, False, [])), \
             patch("runtime._audio_review", return_value=(False, [])), \
             patch("runtime.visual_semantic_review", return_value={"status": "CHECKED", "issues": []}), \
             patch("runtime.transcribe_video_bytes", return_value=transcript):
            review = final_review_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest(), script_text="你好").payload
        self.assertEqual(review["transcript_comparison"]["status"], "CHECKED")
        self.assertTrue(review["transcript_comparison"]["transcript_matches_script"])

    def test_final_review_handler_returns_structured_payload(self) -> None:
        request = StreamRequest([b"mock-final"], "video/mp4")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.final_review_video_bytes") as review:
            review.return_value = type("Review", (), {"payload": {"status": "NEEDS_ATTENTION"}})()
            response = asyncio.run(final_review(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=None,
                x_media_caption_policy="REQUIRED",
            ))
        self.assertEqual(response, {"status": "NEEDS_ATTENTION"})
        assert review.call_args is not None
        self.assertEqual(review.call_args.kwargs["caption_policy"], "REQUIRED")

    def test_final_review_rejects_oversized_script_context_without_truncating(self) -> None:
        request = StreamRequest([b"mock-final"], "video/mp4")
        encoded = base64.urlsafe_b64encode(("长脚本" * 2_700).encode("utf-8")).decode("ascii")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.final_review_video_bytes") as review:
            response = asyncio.run(final_review(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=None,
                x_media_script_text_base64=encoded,
            ))
        self.assertEqual(response.status_code, 400)
        review.assert_not_called()

    def test_transcribe_handler_returns_source_aligned_unavailable_payload(self) -> None:
        request = StreamRequest([b"mock-video"], "video/mp4")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.transcribe_video_bytes", return_value={"status": "UNAVAILABLE", "issues": ["missing"]}):
            response = asyncio.run(transcribe_video(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=None,
            ))
        self.assertEqual(response["status"], "UNAVAILABLE")

    def test_review_frame_sampling_surfaces_blackdetect_output(self) -> None:
        with TemporaryDirectory(prefix="alchemy-final-review-black-test-") as directory:
            path = Path(directory) / "sample.mp4"
            path.write_bytes(b"fixture")
            calls: list[list[str]] = []
            capture_calls: list[list[str]] = []

            def run(_binary: str, args: list[str], **_kwargs: object) -> str:
                calls.append(args)
                if args[-1].endswith("sample-00.png") or args[-1].endswith("sample-01.png") or args[-1].endswith("sample-02.png") or args[-1].endswith("sample-03.png"):
                    Path(args[-1]).write_bytes(PNG)
                return ""

            with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
                 patch("runtime.Path.is_file", return_value=True), \
                 patch("runtime._run", side_effect=run), \
                 patch("runtime._run_capture", side_effect=lambda _binary, args, **_kwargs: (capture_calls.append(args) or (0, "black_start:0 black_duration:1.2"))):
                sampled, black, issues = __import__("runtime")._sample_review_frames(path, 4.0)

        self.assertEqual(sampled, 4)
        self.assertTrue(black)
        self.assertEqual(issues, ["黑帧检测发现连续黑帧。"])
        self.assertIn("-v", capture_calls[0])
        self.assertIn("info", capture_calls[0])
        self.assertTrue(any("pix_th=0.1" in value for value in capture_calls[0]))

    def test_review_frame_sampling_allows_a_short_fade_through_black_transition(self) -> None:
        with TemporaryDirectory(prefix="alchemy-final-review-short-black-test-") as directory:
            path = Path(directory) / "sample.mp4"
            path.write_bytes(b"fixture")
            with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
                 patch("runtime.Path.is_file", return_value=True), \
                 patch("runtime._run", side_effect=lambda _binary, args, **_kwargs: (Path(args[-1]).write_bytes(PNG) if args[-1].endswith(".png") else "") or ""), \
                 patch("runtime._run_capture", return_value=(0, "black_start:0 black_duration:0.7")):
                sampled, black, issues = __import__("runtime")._sample_review_frames(path, 4.0)

        self.assertEqual(sampled, 4)
        self.assertFalse(black)
        self.assertEqual(issues, ["检测到短暂淡黑转场（不超过 1 秒），按允许的转场处理。"])

    def test_review_frame_sampling_allows_a_terminal_fade_through_black_up_to_two_seconds(self) -> None:
        with TemporaryDirectory(prefix="alchemy-final-review-terminal-black-test-") as directory:
            path = Path(directory) / "sample.mp4"
            path.write_bytes(b"fixture")
            with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
                 patch("runtime.Path.is_file", return_value=True), \
                 patch("runtime._run", side_effect=lambda _binary, args, **_kwargs: (Path(args[-1]).write_bytes(PNG) if args[-1].endswith(".png") else "") or ""), \
                 patch("runtime._run_capture", return_value=(0, "black_start:2.5 black_end:4.0 black_duration:1.5")):
                sampled, black, issues = __import__("runtime")._sample_review_frames(path, 4.0)

        self.assertEqual(sampled, 4)
        self.assertFalse(black)
        self.assertEqual(issues, ["检测到片尾淡黑转场（不超过 2 秒），按允许的片尾处理。"])

    def test_review_frame_sampling_keeps_visible_graphic_card_out_of_black_screen_failure(self) -> None:
        with TemporaryDirectory(prefix="alchemy-final-review-graphic-card-test-") as directory:
            path = Path(directory) / "sample.mp4"
            path.write_bytes(b"fixture")
            def capture(_binary: str, args: list[str], **_kwargs: object) -> tuple[str, str]:
                if any("blackdetect" in value for value in args):
                    return "", "black_start:1.0 black_end:2.2 black_duration:1.2"
                return "", ""
            with patch.dict(os.environ, {"MEDIA_RUNTIME_FFMPEG_PATH": "C:\\tools\\ffmpeg.exe"}, clear=False), \
                 patch("runtime.Path.is_file", return_value=True), \
                 patch("runtime._run", side_effect=lambda _binary, args, **_kwargs: (Path(args[-1]).write_bytes(PNG) if args[-1].endswith(".png") else "") or ""), \
                 patch("runtime._run_capture", side_effect=capture):
                sampled, black, issues = __import__("runtime")._sample_review_frames(path, 4.0)

        self.assertEqual(sampled, 4)
        self.assertFalse(black)
        self.assertEqual(issues, ["检测到深色品牌或文字卡，但画面仍有可见内容。"])

    def test_operation_id_and_bundle_format_reject_paths_and_trailing_data(self) -> None:
        self.assertEqual(validate_operation_id("mop_01J4N8QZ8PCW2N2G6D2XJXJXJX"), "mop_01J4N8QZ8PCW2N2G6D2XJXJXJX")
        with self.assertRaises(MediaRuntimeError):
            validate_operation_id("../../tmp")
        self.assertEqual(decode_composition_bundle(bundle(b"one", b"two")), [b"one", b"two"])
        with self.assertRaises(MediaRuntimeError):
            decode_composition_bundle(bundle(b"one") + b"trailing")

    def test_inspection_exposes_source_aligned_audio_metadata(self) -> None:
        body = b"mock-mp4"
        responses = iter([
            json.dumps({"streams": [{"codec_type": "video", "width": 848, "height": 480, "duration": "2.0", "codec_name": "h264", "pix_fmt": "yuv420p", "r_frame_rate": "24/1"}], "format": {"duration": "2.0"}}),
            json.dumps({"streams": [{"codec_type": "audio", "codec_name": "aac", "channels": 2, "sample_rate": "48000"}]}),
        ])
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=lambda *args, **kwargs: next(responses)):
            inspection = __import__("runtime").inspect_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest())
        self.assertTrue(inspection.has_audio)
        self.assertEqual(inspection.audio_channels, 2)
        self.assertEqual(inspection.audio_sample_rate, 48000)
        self.assertEqual(inspection.fps, 24.0)
        self.assertEqual(inspection.video_codec, "h264")
        self.assertEqual(inspection.pixel_format, "yuv420p")
        self.assertEqual(inspection.audio_codec, "aac")

    def test_inspection_rejects_present_audio_without_compatibility_metadata(self) -> None:
        body = b"mock-mp4"
        responses = iter([
            json.dumps({"streams": [{"codec_type": "video", "width": 848, "height": 480, "duration": "2.0"}], "format": {"duration": "2.0"}}),
            json.dumps({"streams": [{"codec_type": "audio", "channels": 2, "sample_rate": "48000"}]}),
        ])
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=lambda *args, **kwargs: next(responses)):
            with self.assertRaisesRegex(MediaRuntimeError, "video audio could not be inspected") as raised:
                __import__("runtime").inspect_video_bytes(body=body, expected_sha256=hashlib.sha256(body).hexdigest())
        self.assertEqual(raised.exception.code, "QC_FAILED")

    def test_inspection_only_requires_compatibility_facts_for_composition(self) -> None:
        video_probe = json.dumps({
            "streams": [{"codec_type": "video", "width": 848, "height": 480, "duration": "2.0"}],
            "format": {"duration": "2.0"},
        })
        audio_probe = json.dumps({"streams": []})
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=[video_probe, audio_probe]):
            inspection = runtime._inspect_path(Path("fixture.mp4"), 8, "0" * 64)
        self.assertEqual((inspection.width, inspection.height, inspection.duration_ms), (848, 480, 2_000))
        self.assertIsNone(inspection.fps)
        with patch.dict(os.environ, {"MEDIA_RUNTIME_FFPROBE_PATH": "C:\\tools\\ffprobe.exe"}, clear=False), patch("runtime.Path.is_file", return_value=True), patch("runtime._run", side_effect=[video_probe, audio_probe]):
            with self.assertRaisesRegex(MediaRuntimeError, "video could not be inspected") as raised:
                runtime._inspect_path(Path("fixture.mp4"), 8, "0" * 64, require_compatibility_facts=True)
        self.assertEqual(raised.exception.code, "QC_FAILED")

    def test_composition_plan_bundle_round_trips_bounded_transition_metadata(self) -> None:
        body = (
            COMPOSITION_PLAN_MAGIC
            + bytes([2, 1, 2])
            + (30_000).to_bytes(4, "big")
            + bytes([1])
            + (2_000).to_bytes(4, "big")
            + (3).to_bytes(4, "big") + b"one"
            + (3).to_bytes(4, "big") + b"two"
        )
        segments, plan = decode_composition_bundle_with_plan(body)
        self.assertEqual(segments, [b"one", b"two"])
        self.assertIsNotNone(plan)
        self.assertEqual(plan.transitions, ("BRIDGE",))
        self.assertEqual(plan.target_duration_ms, 30_000)
        invalid = bytearray(body)
        invalid[10] = 9
        with self.assertRaises(MediaRuntimeError):
            decode_composition_bundle_with_plan(bytes(invalid))

    def test_continuous_audio_plan_bundle_marks_provider_dialogue_as_replaceable(self) -> None:
        body = (
            b"ALCHMED3"
            + bytes([2, 1, 0])
            + (30_000).to_bytes(4, "big")
            + bytes([0, 1])
            + (3).to_bytes(4, "big") + b"one"
            + (3).to_bytes(4, "big") + b"two"
        )
        segments, plan = decode_composition_bundle_with_plan(body)
        self.assertEqual(segments, [b"one", b"two"])
        self.assertIsNotNone(plan)
        self.assertEqual(plan.audio_policy, "CONTINUOUS_NARRATION")

    def test_narration_audio_plan_carries_authoritative_track(self) -> None:
        body = (
            b"ALCHMED5"
            + bytes([1, 0])
            + (20_000).to_bytes(4, "big")
            + bytes([0, 1, 1])
            + (5).to_bytes(4, "big") + b"voice"
            + (3).to_bytes(4, "big") + b"vid"
        )
        segments, plan = decode_composition_bundle_with_plan(body)
        self.assertEqual(segments, [b"vid"])
        self.assertIsNotNone(plan)
        self.assertEqual(plan.narration_bytes, b"voice")

    def test_ownership_audio_plan_round_trips_platform_and_source_windows(self) -> None:
        segments, plan = decode_composition_bundle_with_plan(ownership_plan_bundle(b"one", b"two"))
        self.assertEqual(segments, [b"one", b"two"])
        self.assertIsNotNone(plan)
        self.assertEqual(plan.audio_policy, "CONTINUOUS_NARRATION")
        self.assertEqual(plan.narration_bytes, b"voice")
        self.assertEqual([(track.track_id, track.ownership, track.start_ms, track.end_ms) for track in plan.audio_tracks or ()], [
            ("platform-narration", "PLATFORM_NARRATION", 0, 2_000),
            ("segment-1", "PROVIDER_DIALOGUE", 0, 1_000),
            ("segment-2", "PROVIDER_AMBIENCE", 1_000, 2_000),
        ])

    def test_ownership_audio_plan_rejects_partial_platform_coverage(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(ownership_plan_bundle(b"one", b"two", platform_end_ms=1_500))
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("covering the full target", str(raised.exception))

    def test_ownership_audio_plan_requires_payload_for_declared_music_track(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(ownership_music_plan_bundle(b"vid", include_music=False))
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("MUSIC ownership track requires", str(raised.exception))
        _segments, plan = decode_composition_bundle_with_plan(ownership_music_plan_bundle(b"vid", include_music=True))
        self.assertIsNotNone(plan)
        self.assertEqual(plan.music_bytes, b"music")

    def test_complete_audio_plan_bundle_round_trips_identity_gain_fades_and_transcript(self) -> None:
        segments, plan = decode_composition_bundle_with_plan(complete_audio_plan_bundle(b"vid"))
        self.assertEqual(segments, [b"vid"])
        self.assertIsNotNone(plan)
        self.assertIsNotNone(plan.audio_plan)
        self.assertEqual(plan.audio_plan.version, 1)
        self.assertEqual(plan.audio_plan.stitch_policy, "CONTINUOUS_NARRATION")
        self.assertEqual(plan.audio_plan.narration_sections, (("sec_1", 0, 2_000, "PRIMARY"),))
        self.assertEqual(plan.audio_plan.narration_asset_id, "ast-narration")
        self.assertEqual(plan.audio_plan.transcript_timing_asset_id, "ast-timing")
        self.assertEqual(plan.audio_plan.transcript_script, "第一句。第二句。")
        track = plan.audio_plan.tracks[0]
        self.assertEqual(track.asset_id, "ast-narration")
        self.assertEqual(track.gain_db, "0")
        self.assertEqual(track.fade_in_ms, 100)
        self.assertEqual(track.fade_out_ms, 200)

    def test_complete_audio_plan_rejects_multiple_platform_tracks_for_one_payload(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(
                complete_audio_plan_bundle(b"vid", extra_platform_track=True)
            )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("one platform track covering the full target", str(raised.exception))

    def test_complete_audio_plan_round_trips_independent_absolute_speech_tracks(self) -> None:
        segments, plan = decode_composition_bundle_with_plan(complete_section_audio_plan_bundle(b"vid"))

        self.assertEqual(segments, [b"vid"])
        self.assertIsNotNone(plan)
        self.assertEqual(plan.audio_policy, "CONTINUOUS_NARRATION")
        self.assertEqual(plan.narration_bytes, None)
        self.assertEqual(plan.narration_tracks, (("narration-ast-1", b"wav1"), ("narration-ast-2", b"wav2")))
        self.assertIsNotNone(plan.audio_plan)
        self.assertEqual(
            [(track.track_id, track.asset_id, track.start_ms, track.end_ms) for track in plan.audio_plan.tracks],
            [("narration-ast-1", "ast-1", 0, 2_000), ("segment-1", "src-1", 0, 4_000), ("narration-ast-2", "ast-2", 2_000, 4_000)],
        )

    def test_complete_audio_plan_rejects_independent_speech_payload_identity_mismatch(self) -> None:
        body = bytearray(complete_section_audio_plan_bundle(b"vid"))
        marker = body.find(b"narration-ast-2")
        self.assertGreater(marker, 0)
        payload_marker = body.rfind(b"narration-ast-2")
        self.assertGreater(payload_marker, marker)
        body[payload_marker + len(b"narration-ast-2") - 1] = ord("x")
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(bytes(body))
        self.assertEqual(raised.exception.code, "MEDIA_RENDER_FAILED")

    def test_complete_audio_plan_rejects_unsafe_gain_metadata(self) -> None:
        body = bytearray(complete_audio_plan_bundle(b"vid"))
        marker = body.find(b"-3dB")
        self.assertEqual(marker, -1)
        # The complete fixture's gain field is the one-byte string "0";
        # replacing it with an expression must fail the Runtime parser.
        gain_marker = body.find(b"ast-narration\x010")
        self.assertGreaterEqual(gain_marker, 0)
        body[gain_marker + len(b"ast-narration\x01") : gain_marker + len(b"ast-narration\x01") + 1] = b"|"
        with self.assertRaises(MediaRuntimeError):
            decode_composition_bundle_with_plan(bytes(body))

    def test_complete_audio_plan_rejects_truncated_track_count(self) -> None:
        body = complete_audio_plan_bundle(b"vid")
        marker = body.find(b"\x01\x12platform-narration")
        self.assertGreater(marker, 0)
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(body[:marker])
        self.assertEqual(raised.exception.code, "MEDIA_RENDER_FAILED")

    def test_complete_audio_plan_rejects_unsupported_segment_stitch_code(self) -> None:
        body = bytearray(complete_audio_plan_bundle(b"vid"))
        # ALCHMED8 plan metadata starts after the fixed advanced header; the
        # second byte is the stitch policy.  Code 1 has no payload in this
        # wire version and must fail closed rather than be parsed as a mode.
        body[32] = 1
        with self.assertRaises(MediaRuntimeError):
            decode_composition_bundle_with_plan(bytes(body))

    def test_complete_audio_plan_rejects_undeclared_narration_gap(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(complete_audio_plan_bundle(b"vid", section_start_ms=1_501))
        self.assertEqual(raised.exception.code, "QC_FAILED")

    def test_complete_audio_plan_rejects_undeclared_trailing_gap(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(complete_audio_plan_bundle(b"vid", section_end_ms=1_500))
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("cover the composition target", str(raised.exception))

    def test_complete_audio_plan_rejects_unconsumed_full_track_section_window_without_asset_id(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(
                complete_audio_plan_bundle(
                    b"vid",
                    section_role=1,
                    narration_asset_id="",
                )
            )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("Full narration section windows are not consumed", str(raised.exception))

    def test_complete_audio_plan_rejects_music_payload_without_ownership_track(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(
                complete_audio_plan_bundle(
                    b"vid",
                    include_music_payload=True,
                    music_windows_ms=((0, 2_000),),
                )
            )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("mapped AudioPlan MUSIC track", str(raised.exception))

    def test_complete_audio_plan_rejects_partial_music_window_before_legacy_mix(self) -> None:
        with self.assertRaises(MediaRuntimeError) as raised:
            decode_composition_bundle_with_plan(
                complete_audio_plan_bundle(
                    b"vid",
                    include_music_track=True,
                    include_music_payload=True,
                    music_windows_ms=((0, 1_000),),
                )
            )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        self.assertIn("partial or multiple MUSIC windows", str(raised.exception))

    def test_legacy_ownership_bundle_keeps_legacy_audio_policy(self) -> None:
        _segments, plan = decode_composition_bundle_with_plan(ownership_plan_bundle(b"vid", include_narration=False, policy=0))
        self.assertIsNotNone(plan)
        self.assertEqual(plan.audio_policy, "LEGACY_PRESERVE")
        self.assertIsNone(plan.narration_bytes)

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

    def test_boundary_frame_extraction_returns_first_and_last_without_paths(self) -> None:
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
            result = extract_boundary_frames(body=body, expected_sha256=hashlib.sha256(body).hexdigest())

        self.assertEqual(result.first.sha256, hashlib.sha256(PNG).hexdigest())
        self.assertEqual(result.last.sha256, hashlib.sha256(PNG).hexdigest())
        self.assertIn("-i", calls[-2])
        self.assertIn("-sseof", calls[-1])

    def test_boundary_handler_returns_bounded_base64_frames(self) -> None:
        request = StreamRequest([b"mock-mp4"], "video/mp4")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.extract_boundary_frames") as extract:
            from runtime import BoundaryFrames, ImageArtifact
            extract.return_value = BoundaryFrames(
                first=ImageArtifact("image/png", hashlib.sha256(PNG).hexdigest(), len(PNG), 2, 3, PNG),
                last=ImageArtifact("image/png", hashlib.sha256(PNG).hexdigest(), len(PNG), 2, 3, PNG),
            )
            response = asyncio.run(boundary_frames(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=None,
            ))
        self.assertEqual(response["first"]["byte_size"], len(PNG))
        self.assertEqual(base64.b64decode(response["last"]["bytes_base64"]), PNG)

    def test_audio_inspect_handler_returns_duration_facts(self) -> None:
        body = b"wav-fixture"
        request = StreamRequest([body], "audio/wav")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.inspect_audio_bytes") as inspect:
            from runtime import AudioInspection
            inspect.return_value = AudioInspection("audio/wav", hashlib.sha256(body).hexdigest(), len(body), 1250)
            response = asyncio.run(inspect_audio(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=hashlib.sha256(body).hexdigest(),
            ))
        self.assertEqual(response["mime_type"], "audio/wav")
        self.assertEqual(response["duration_ms"], 1250)

    def test_narration_handler_rejects_text_and_segments_together(self) -> None:
        request = StreamRequest([json.dumps({
            "text": "全文",
            "segments": [{"text": "分段", "start_ms": 0}],
            "target_duration_ms": 1_000,
        }).encode("utf-8")], "application/json")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False):
            response = asyncio.run(synthesize_narration(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.body), {"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}})

    def test_narration_handler_preserves_segment_delivery_metadata(self) -> None:
        request = StreamRequest([json.dumps({
            "segments": [{
                "text": "AI方案。",
                "provider_text": "人工智能方案。",
                "start_ms": 0,
                "pronunciation_guides": [{"source": "AI", "spoken": "人工智能", "reason": "approved"}],
                "pause_before_ms": 0,
                "pause_after_ms": 600,
                "pace": "NATURAL",
                "energy": "NEUTRAL",
            }],
            "target_duration_ms": 1_000,
        }).encode("utf-8")], "application/json")
        captured: dict[str, object] = {}
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.synthesize_narration_segments_bytes", side_effect=lambda **kwargs: (captured.update(kwargs) or (b"wav", 1_000))):
            response = asyncio.run(synthesize_narration(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.headers["x-media-duration-ms"], "1000")
        self.assertEqual(captured["segments"][0]["provider_text"], "人工智能方案。")  # type: ignore[index]
        self.assertEqual(captured["segments"][0]["pronunciation_guides"][0]["spoken"], "人工智能")  # type: ignore[index]

    def test_narration_handler_explicit_doubao_preserves_source_fields(self) -> None:
        request = StreamRequest([json.dumps({
            "text": "保险AI介绍。",
            "preferred_provider": "doubao",
            "voice_id": "zh_female_vv_uranus_bigtts",
            "resource_id": "seed-tts-2.0",
            "format": "mp3",
            "sample_rate": 24_000,
            "speech_rate": 0,
            "enable_timestamp": True,
            "disable_markdown_filter": False,
            "return_usage": True,
            "poll_interval_seconds": 0.5,
            "timeout_seconds": 30,
        }).encode("utf-8")], "application/json")
        with patch.dict(os.environ, {
            "MEDIA_RUNTIME_TOKEN": "runtime-test-token",
            "DOUBAO_SPEECH_API_KEY": "fixture-only",
        }, clear=False), patch("main.synthesize_doubao_narration_bytes", return_value=(b"mp3", "audio/mpeg", 1_250)) as synthesize:
            response = asyncio.run(synthesize_narration(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.body, b"mp3")
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.headers["x-media-duration-ms"], "1250")
        synthesize.assert_called_once_with(
            text="保险AI介绍。",
            source_inputs={
                "preferred_provider": "doubao",
                "voice_id": "zh_female_vv_uranus_bigtts",
                "resource_id": "seed-tts-2.0",
                "format": "mp3",
                "sample_rate": 24_000,
                "speech_rate": 0,
                "enable_timestamp": True,
                "disable_markdown_filter": False,
                "return_usage": True,
                "poll_interval_seconds": 0.5,
                "timeout_seconds": 30,
            },
        )

    def test_narration_handler_preserves_authored_line_boundaries_for_doubao(self) -> None:
        request = StreamRequest([json.dumps({
            "text": "第一句。\n\n第二句，继续说明。",
            "preferred_provider": "doubao",
        }).encode("utf-8")], "application/json")
        with patch.dict(os.environ, {
            "MEDIA_RUNTIME_TOKEN": "runtime-test-token",
            "DOUBAO_SPEECH_API_KEY": "fixture-only",
        }, clear=False), patch("main.synthesize_doubao_narration_bytes", return_value=(b"mp3", "audio/mpeg", 1_250)) as synthesize:
            response = asyncio.run(synthesize_narration(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(synthesize.call_args.kwargs["text"], "第一句。\n\n第二句，继续说明。")

    def test_narration_handler_auto_provider_fails_closed_without_source_registry(self) -> None:
        request = StreamRequest([json.dumps({
            "text": "保险AI介绍。",
            "preferred_provider": "auto",
        }).encode("utf-8")], "application/json")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), patch("main.synthesize_doubao_narration_bytes") as synthesize:
            response = asyncio.run(synthesize_narration(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.body), {"error": {"code": "MEDIA_RUNTIME_UNAVAILABLE", "retryable": True}})
        synthesize.assert_not_called()

    def test_narration_handler_bounds_chunked_json_without_content_length(self) -> None:
        request = StreamRequest([b'{"tex', b't":"ok"}', b'never-read'], "application/json")
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), \
             patch("main.MAX_NARRATION_REQUEST_BYTES", 8), patch("main.synthesize_narration_bytes") as synthesize:
            response = asyncio.run(synthesize_narration(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
            ))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(request.yielded, 2)
        synthesize.assert_not_called()

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

    def test_compose_handler_allows_alchmed8_bundle_to_reach_runtime(self) -> None:
        request = StreamRequest([complete_audio_plan_bundle(b"vid")], "application/vnd.alchemy-media-bundle")
        artifact = runtime.CompositionArtifact(
            inspection=runtime.VideoInspection(
                mime_type="video/mp4",
                sha256="0" * 64,
                byte_size=3,
                width=160,
                height=90,
                duration_ms=2_000,
                has_audio=True,
            ),
            bytes=b"mp4",
        )
        with patch.dict(os.environ, {"MEDIA_RUNTIME_TOKEN": "runtime-test-token"}, clear=False), \
             patch("main.compose_video_bundle", return_value=artifact) as compose:
            response = asyncio.run(compose_video(
                request=request,
                authorization="Bearer runtime-test-token",
                x_media_operation_id="mop_01J4N8QZ8PCW2N2G6D2XJXJXJX",
                x_media_expected_sha256=None,
            ))
        self.assertEqual(response.status_code, 200)
        compose.assert_called_once()

    def test_compose_uses_source_crossfade_graph_and_effective_duration(self) -> None:
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
            source_run = runtime._run
            ffmpeg_calls: list[list[str]] = []

            def record_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
                ffmpeg_calls.append(args)
                return source_run(binary, args, timeout_seconds=timeout_seconds)

            with patch.dict(os.environ, {
                "MEDIA_RUNTIME_FFMPEG_PATH": str(ffmpeg),
                "MEDIA_RUNTIME_FFPROBE_PATH": str(ffprobe),
            }, clear=False), patch("runtime._run", side_effect=record_run):
                composed = compose_video_bundle(
                    body=plan_bundle(
                        left.read_bytes(),
                        right.read_bytes(),
                        transition_code=1,
                        target_duration_ms=1_500,
                    ),
                    expected_sha256=None,
                )

            probe = subprocess.check_output(
                [str(ffprobe), "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", "-i", "pipe:0"],
                input=composed.bytes,
                stderr=subprocess.DEVNULL,
            )
            streams = json.loads(probe).get("streams", [])

        self.assertIn("audio", [stream["codec_type"] for stream in streams])
        self.assertGreaterEqual(composed.inspection.duration_ms, 1400)
        self.assertLessEqual(composed.inspection.duration_ms, 1700)
        graph = next(args[args.index("-filter_complex") + 1] for args in ffmpeg_calls if "-filter_complex" in args)
        self.assertIn("xfade=transition=fade:duration=0.500:offset=0.500", graph)
        self.assertIn("acrossfade=d=0.500", graph)
        self.assertNotIn("tpad=", graph)
        self.assertNotIn("c1=", graph)
        self.assertNotIn("c2=", graph)

    def test_compose_normalizes_heterogeneous_cut_to_first_clip_canvas(self) -> None:
        root = Path(__file__).resolve().parents[3]
        ffmpeg = root / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        ffprobe = root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffmpeg.is_file() or not ffprobe.is_file():
            self.skipTest("local ffmpeg fixtures are unavailable")

        with TemporaryDirectory(prefix="alchemy-runtime-heterogeneous-cut-") as directory:
            fixture_root = Path(directory)
            left = fixture_root / "left.mp4"
            right = fixture_root / "right.mp4"
            for path, color, size in ((left, "red", "848x480"), (right, "blue", "752x416")):
                completed = subprocess.run(
                    [
                        str(ffmpeg), "-y", "-f", "lavfi", "-i", f"color=c={color}:s={size}:r=24:d=1",
                        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path),
                    ],
                    check=False,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)

            source_run = runtime._run
            ffmpeg_calls: list[list[str]] = []
            normalized_outputs: list[str] = []

            def record_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
                if binary == str(ffmpeg):
                    ffmpeg_calls.append(args)
                    if "normalized-segment-" in str(args[-1]):
                        normalized_outputs.append(str(args[-1]))
                return source_run(binary, args, timeout_seconds=timeout_seconds)

            with patch.dict(os.environ, {
                "MEDIA_RUNTIME_FFMPEG_PATH": str(ffmpeg),
                "MEDIA_RUNTIME_FFPROBE_PATH": str(ffprobe),
            }, clear=False), patch("runtime._run", side_effect=record_run):
                composed = compose_video_bundle(
                    body=plan_bundle(
                        left.read_bytes(), right.read_bytes(),
                        transition_code=0,
                        target_duration_ms=2_000,
                    ),
                    expected_sha256=None,
                )

            output = fixture_root / "composed.mp4"
            output.write_bytes(composed.bytes)
            probe = subprocess.check_output(
                [
                    str(ffprobe), "-v", "error",
                    "-show_entries", "stream=width,height,codec_name,pix_fmt:format=duration",
                    "-of", "json", str(output),
                ],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            facts = json.loads(probe)
            video = next(stream for stream in facts["streams"] if stream.get("codec_name"))

        self.assertEqual((video["width"], video["height"]), (848, 480))
        self.assertEqual(composed.inspection.width, 848)
        self.assertEqual(composed.inspection.height, 480)
        normalization_calls = [call for call in ffmpeg_calls if "normalized-segment-" in str(call[-1])]
        self.assertEqual(len(normalization_calls), 2)
        self.assertTrue(all("scale=848:480:force_original_aspect_ratio=decrease" in call[call.index("-vf") + 1] for call in normalization_calls))
        self.assertTrue(all("pad=848:480:(ow-iw)/2:(oh-ih)/2" in call[call.index("-vf") + 1] for call in normalization_calls))

    def test_compose_normalizes_heterogeneous_xfade_with_mixed_audio(self) -> None:
        root = Path(__file__).resolve().parents[3]
        ffmpeg = root / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        ffprobe = root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffmpeg.is_file() or not ffprobe.is_file():
            self.skipTest("local ffmpeg fixtures are unavailable")

        with TemporaryDirectory(prefix="alchemy-runtime-heterogeneous-xfade-") as directory:
            fixture_root = Path(directory)
            left = fixture_root / "left.mp4"
            right = fixture_root / "right.mp4"
            completed = subprocess.run(
                [
                    str(ffmpeg), "-y", "-f", "lavfi", "-i", "color=c=red:s=848x480:r=24:d=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
                    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", str(left),
                ],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            completed = subprocess.run(
                [
                    str(ffmpeg), "-y", "-f", "lavfi", "-i", "color=c=blue:s=752x416:r=24:d=1",
                    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(right),
                ],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)

            source_run = runtime._run
            ffmpeg_calls: list[list[str]] = []
            normalized_outputs: list[str] = []

            def record_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
                if binary == str(ffmpeg):
                    ffmpeg_calls.append(args)
                    if "normalized-segment-" in str(args[-1]):
                        normalized_outputs.append(str(args[-1]))
                return source_run(binary, args, timeout_seconds=timeout_seconds)

            with patch.dict(os.environ, {
                "MEDIA_RUNTIME_FFMPEG_PATH": str(ffmpeg),
                "MEDIA_RUNTIME_FFPROBE_PATH": str(ffprobe),
            }, clear=False), patch("runtime._run", side_effect=record_run):
                composed = compose_video_bundle(
                    body=plan_bundle(
                        left.read_bytes(), right.read_bytes(),
                        transition_code=1,
                        target_duration_ms=1_500,
                    ),
                    expected_sha256=None,
                )

            output = fixture_root / "composed.mp4"
            output.write_bytes(composed.bytes)
            probe = subprocess.check_output(
                [
                    str(ffprobe), "-v", "error",
                    "-show_entries", "stream=codec_type,width,height,codec_name,sample_rate,channels:format=duration",
                    "-of", "json", str(output),
                ],
                text=True,
                stderr=subprocess.DEVNULL,
            )
            facts = json.loads(probe)

        streams = facts["streams"]
        video = next(stream for stream in streams if stream.get("codec_type") == "video")
        audio = next(stream for stream in streams if stream.get("codec_type") == "audio")
        self.assertEqual((video["width"], video["height"]), (848, 480))
        self.assertEqual(audio["codec_name"], "aac")
        self.assertEqual((audio["sample_rate"], audio["channels"]), ("48000", 2))
        self.assertAlmostEqual(float(facts["format"]["duration"]), 1.5, delta=0.15)
        graph = next(call[call.index("-filter_complex") + 1] for call in ffmpeg_calls if "-filter_complex" in call)
        self.assertIn("xfade=transition=fade:duration=0.500:offset=0.500", graph)
        self.assertIn("anullsrc=channel_layout=stereo:sample_rate=48000", graph)
        composition_call = next(call for call in ffmpeg_calls if "-filter_complex" in call)
        self.assertEqual(len(normalized_outputs), 2)
        self.assertTrue(all(path in composition_call for path in normalized_outputs))
        self.assertTrue(all(not Path(path).exists() for path in normalized_outputs))

    def test_compose_rejects_heterogeneous_input_when_probe_facts_are_incomplete(self) -> None:
        incomplete = runtime.VideoInspection("video/mp4", "0" * 64, 3, 848, 480, 1_000, False)
        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", side_effect=[incomplete, runtime.VideoInspection("video/mp4", "0" * 64, 3, 752, 416, 1_000, False)]), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "media facts are incomplete") as raised:
                compose_video_bundle(
                    body=plan_bundle(b"one", b"two", transition_code=0, target_duration_ms=2_000),
                    expected_sha256=None,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_compose_rejects_same_canvas_when_probe_facts_are_incomplete(self) -> None:
        incomplete = runtime.VideoInspection("video/mp4", "0" * 64, 3, 848, 480, 1_000, False)
        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", side_effect=[incomplete, incomplete]), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "media facts are incomplete") as raised:
                compose_video_bundle(
                    body=plan_bundle(b"one", b"two", transition_code=0, target_duration_ms=2_000),
                    expected_sha256=None,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_compose_fails_closed_when_normalization_does_not_produce_output(self) -> None:
        first = runtime.VideoInspection(
            "video/mp4", "0" * 64, 3, 848, 480, 1_000, False,
            fps=24.0, video_codec="h264", pixel_format="yuv420p",
        )
        second = runtime.VideoInspection(
            "video/mp4", "0" * 64, 3, 752, 416, 1_000, False,
            fps=24.0, video_codec="h264", pixel_format="yuv420p",
        )
        normalized_outputs: list[str] = []

        def fail_normalization(**kwargs: object) -> None:
            output = Path(str(kwargs["output"]))
            output.write_bytes(b"partial-normalized-output")
            normalized_outputs.append(str(output))
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "normalization failed")

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", side_effect=[first, second]), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._normalize_composition_clip", side_effect=fail_normalization), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "normalization failed") as raised:
                compose_video_bundle(
                    body=plan_bundle(b"one", b"two", transition_code=0, target_duration_ms=2_000),
                    expected_sha256=None,
                )
        self.assertEqual(raised.exception.code, "MEDIA_RENDER_FAILED")
        run.assert_not_called()
        self.assertEqual(len(normalized_outputs), 1)
        self.assertTrue(all(not Path(path).exists() for path in normalized_outputs))

    def test_compose_maps_pass_to_source_cut_without_overlap(self) -> None:
        calls: list[list[str]] = []
        source_inspection = complete_composition_inspection(duration_ms=1_000)
        output_inspection = complete_composition_inspection(duration_ms=2_000)

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", side_effect=[source_inspection, source_inspection, output_inspection]), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run", side_effect=fake_run):
            compose_video_bundle(
                body=plan_bundle(b"one", b"two", transition_code=0, target_duration_ms=2_000),
                expected_sha256=None,
            )

        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("concat=n=2:v=1:a=0", graph)
        self.assertIn("concat=n=2:v=0:a=1", graph)
        self.assertNotIn("xfade=", graph)
        self.assertNotIn("tpad=", graph)

    def test_compose_maps_bridge_to_source_fadeblack_and_acrossfade(self) -> None:
        calls: list[list[str]] = []
        source_inspection = complete_composition_inspection(duration_ms=2_000, has_audio=True)
        output_inspection = complete_composition_inspection(duration_ms=2_800, has_audio=True)

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", side_effect=[source_inspection, source_inspection, output_inspection]), \
             patch("runtime._has_audio_stream", return_value=True), \
             patch("runtime._run", side_effect=fake_run):
            compose_video_bundle(
                body=plan_bundle(
                    b"one",
                    b"two",
                    transition_code=2,
                    transition_duration_ms=1_200,
                    target_duration_ms=2_800,
                ),
                expected_sha256=None,
            )

        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("xfade=transition=fadeblack:duration=1.200:offset=0.800", graph)
        self.assertIn("acrossfade=d=1.200", graph)
        self.assertNotIn("tpad=", graph)
        self.assertNotIn("c1=", graph)
        self.assertNotIn("c2=", graph)

    def test_compose_rejects_mixed_source_transition_plan_before_ffmpeg(self) -> None:
        source_inspection = runtime.VideoInspection("video/mp4", "0" * 64, 3, 160, 90, 1_000, False)
        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=source_inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "Mixed transition plans") as raised:
                compose_video_bundle(
                    body=plan_bundle(
                        b"one",
                        b"two",
                        b"three",
                        transition_codes=(0, 1),
                        target_duration_ms=3_000,
                    ),
                    expected_sha256=None,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_compose_uses_source_cumulative_offset_rounding_without_tpad(self) -> None:
        calls: list[list[str]] = []
        source_inspection = complete_composition_inspection(duration_ms=2_345)
        middle_inspection = complete_composition_inspection(duration_ms=3_210)
        last_inspection = complete_composition_inspection(duration_ms=1_111)
        output_inspection = complete_composition_inspection(duration_ms=5_666)

        def fake_run(_binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append(args)
            Path(args[-1]).write_bytes(b"composed")
            return ""

        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", side_effect=[source_inspection, middle_inspection, last_inspection, output_inspection]), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run", side_effect=fake_run):
            compose_video_bundle(
                body=plan_bundle(
                    b"one",
                    b"two",
                    b"three",
                    transition_codes=(1, 1),
                    target_duration_ms=5_666,
                ),
                expected_sha256=None,
            )

        graph = calls[0][calls[0].index("-filter_complex") + 1]
        self.assertIn("xfade=transition=fade:duration=0.500:offset=1.845", graph)
        self.assertIn("xfade=transition=fade:duration=0.500:offset=4.555", graph)
        self.assertNotIn("tpad=", graph)

    def test_compose_rejects_different_bridge_durations_before_ffmpeg(self) -> None:
        source_inspection = runtime.VideoInspection("video/mp4", "0" * 64, 3, 160, 90, 2_000, False)
        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=source_inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "Per-boundary bridge durations") as raised:
                compose_video_bundle(
                    body=plan_bundle(
                        b"one",
                        b"two",
                        b"three",
                        transition_codes=(2, 2),
                        bridge_durations_ms=(1_000, 1_200),
                        target_duration_ms=4_800,
                    ),
                    expected_sha256=None,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_compose_rejects_source_effective_duration_mismatch_before_ffmpeg(self) -> None:
        source_inspection = complete_composition_inspection(duration_ms=1_000)
        with patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=source_inspection), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "target duration does not match") as raised:
                compose_video_bundle(
                    body=plan_bundle(
                        b"one",
                        b"two",
                        transition_code=1,
                        target_duration_ms=2_000,
                    ),
                    expected_sha256=None,
                )
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_compose_rejects_continuous_narration_crossfade_before_ffmpeg(self) -> None:
        inspections = runtime.VideoInspection("video/mp4", "0" * 64, 3, 160, 90, 1_000, False)
        plan = CompositionPlan(
            transitions=("BLEND",),
            target_duration_ms=1_500,
            bridge_durations_ms=(),
            audio_policy="CONTINUOUS_NARRATION",
            narration_bytes=b"voice",
            audio_tracks=(
                CompositionAudioTrack("segment-1", "PROVIDER_DIALOGUE", 0, 1_000),
                CompositionAudioTrack("segment-2", "PROVIDER_DIALOGUE", 1_000, 2_000),
            ),
        )
        with patch("runtime.decode_composition_bundle_with_plan", return_value=([b"one", b"two"], plan)), \
             patch("runtime._validated_video_bytes", return_value="0" * 64), \
             patch("runtime.configured_binary", return_value="ffmpeg"), \
             patch("runtime._inspect_path", return_value=inspections), \
             patch("runtime._has_audio_stream", return_value=False), \
             patch("runtime._run") as run:
            with self.assertRaisesRegex(MediaRuntimeError, "Continuous narration audio transitions") as raised:
                compose_video_bundle(body=b"fixture", expected_sha256=None)
        self.assertEqual(raised.exception.code, "QC_FAILED")
        run.assert_not_called()

    def test_compose_complete_audio_plan_full_mix_produces_verified_av_fixture(self) -> None:
        root = Path(__file__).resolve().parents[3]
        ffmpeg = root / "node_modules" / ".pnpm" / "ffmpeg-static@5.3.0" / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        ffprobe = root / "node_modules" / ".pnpm" / "ffprobe-static@3.1.0" / "node_modules" / "ffprobe-static" / "bin" / "win32" / "x64" / "ffprobe.exe"
        if not ffmpeg.is_file() or not ffprobe.is_file():
            self.skipTest("local ffmpeg fixtures are unavailable")

        with TemporaryDirectory(prefix="alchemy-runtime-full-mix-test-") as directory:
            fixture_root = Path(directory)
            video = fixture_root / "source.mp4"
            narration = fixture_root / "narration.wav"
            music = fixture_root / "music.wav"
            subprocess.run(
                [
                    str(ffmpeg), "-y", "-f", "lavfi", "-i", "color=c=darkgreen:s=160x90:r=25:d=2",
                    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video),
                ],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for path, frequency, duration in ((narration, "440", "1.2"), (music, "220", "2.0")):
                subprocess.run(
                    [
                        str(ffmpeg), "-y", "-f", "lavfi", "-i", f"sine=frequency={frequency}:sample_rate=48000:duration={duration}",
                        "-c:a", "pcm_s16le", str(path),
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
                composed = compose_video_bundle(
                    body=complete_audio_plan_bundle(
                        video.read_bytes(),
                        include_source_track=True,
                        source_track_count=1,
                        include_music_track=True,
                        include_music_payload=True,
                        music_windows_ms=((0, 2_000),),
                        narration_payload=narration.read_bytes(),
                        music_payload=music.read_bytes(),
                    ),
                    expected_sha256=None,
                )

            probe = subprocess.check_output(
                [str(ffprobe), "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", "-i", "pipe:0"],
                input=composed.bytes,
                stderr=subprocess.DEVNULL,
            )
            facts = json.loads(probe)

        self.assertEqual([stream["codec_type"] for stream in facts["streams"]], ["video", "audio"])
        self.assertAlmostEqual(float(facts["format"]["duration"]), 2.0, delta=0.15)
        self.assertEqual(composed.inspection.mime_type, "video/mp4")
        self.assertEqual(composed.inspection.duration_ms, 2_000)

    def test_segment_music_video_bytes_uses_independent_source_operation(self) -> None:
        video_body = b"video-fixture"
        music_body = b"music-fixture"
        inspection = runtime.VideoInspection(
            mime_type="video/mp4", sha256="c" * 64, byte_size=14,
            width=160, height=90, duration_ms=4_000, has_audio=True,
            audio_channels=2, audio_sample_rate=44_100,
        )
        calls: list[tuple[str, list[str], int]] = []

        def fake_run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
            calls.append((binary, args, timeout_seconds))
            if "-filter_complex" in args:
                Path(args[-1]).write_bytes(b"composed-fixture")
                return ""
            return "4.0\n"

        with patch("runtime.configured_binary", return_value="media-tool"), \
             patch("runtime._run", side_effect=fake_run), \
             patch("runtime._inspect_path", return_value=inspection):
            artifact = runtime.segment_music_video_bytes(
                video_body=video_body,
                music_body=music_body,
                video_expected_sha256=hashlib.sha256(video_body).hexdigest(),
                music_expected_sha256=hashlib.sha256(music_body).hexdigest(),
                music_mime_type="audio/wav",
                music_segments_ms=((2_000, 3_000), (0, 1_000)),
            )

        self.assertEqual(artifact.inspection, inspection)
        ffmpeg_call = next(call for call in calls if "-filter_complex" in call[1])
        graph = ffmpeg_call[1][ffmpeg_call[1].index("-filter_complex") + 1]
        self.assertLess(graph.index("if(lt(t,0.0)"), graph.index("if(lt(t,2.0)"))
        self.assertIn("normalize=0", graph)
        self.assertEqual(ffmpeg_call[2], 90)

    def test_segment_music_video_bytes_rejects_unverified_boundary_inputs(self) -> None:
        with self.assertRaisesRegex(MediaRuntimeError, "MIME is invalid"):
            runtime.segment_music_video_bytes(
                video_body=b"video",
                music_body=b"music",
                video_expected_sha256=None,
                music_expected_sha256=None,
                music_mime_type="text/plain",
                music_segments_ms=((0, 1_000),),
            )
        with self.assertRaisesRegex(MediaRuntimeError, "windows are invalid"):
            runtime.segment_music_video_bytes(
                video_body=b"video",
                music_body=b"music",
                video_expected_sha256=None,
                music_expected_sha256=None,
                music_mime_type="audio/wav",
                music_segments_ms=((1_000, 1_000),),
            )
        with self.assertRaisesRegex(MediaRuntimeError, "windows overlap"):
            runtime.segment_music_video_bytes(
                video_body=b"video",
                music_body=b"music",
                video_expected_sha256=None,
                music_expected_sha256=None,
                music_mime_type="audio/wav",
                music_segments_ms=((0, 2_000), (1_000, 3_000)),
            )

    def test_hyperframes_audio_runtime_helper_preserves_scope_and_timing(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            voice = root / "voice.wav"
            music = root / "music.wav"
            voice.write_bytes(b"voice")
            music.write_bytes(b"music")

            def probe(path: Path) -> float:
                return 2.0 if path == voice else 4.0

            def asset(path: Path, asset_id: str, duration_ms: int, role: str | None = None) -> dict[str, object]:
                body = path.read_bytes()
                return {
                    "id": asset_id, "path": str(path), "workspace_id": "ws_1", "project_id": "prj_1",
                    "mime_type": "audio/wav", "sha256": hashlib.sha256(body).hexdigest(),
                    "byte_size": len(body), "duration_ms": duration_ms,
                    **({"audio_role": role} if role else {}),
                }

            with patch("runtime._probe_audio_path_duration", side_effect=probe):
                result = runtime.resolve_hyperframes_audio_refs(
                    audio={"narration": {"segments": [{"asset_id": "voice", "start_seconds": 0, "end_seconds": 2}]}, "music": {"asset_id": "music"}},
                    assets=[asset(voice, "voice", 2_000), asset(music, "music", 4_000, "MUSIC")],
                    workspace=root,
                    total_duration_seconds=4,
                    workspace_id="ws_1",
                    project_id="prj_1",
                )

        self.assertIn('data-start="0" data-duration="2"', result.html)
        self.assertIn('data-track-index="3"', result.html)
        self.assertEqual(result.refs["narration"][0]["src"], str(voice))

if __name__ == "__main__":
    unittest.main()
