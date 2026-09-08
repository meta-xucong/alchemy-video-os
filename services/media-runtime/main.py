from __future__ import annotations

import hashlib
import base64
import binascii
import json
import math
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse, Response

from runtime import (
    COMPOSITION_MAGIC,
    COMPOSITION_PLAN_MAGIC,
    COMPOSITION_AUDIO_PLAN_MAGIC,
    COMPOSITION_MUSIC_PLAN_MAGIC,
    COMPOSITION_NARRATION_PLAN_MAGIC,
    COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC,
    COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC,
    COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC,
    MAX_COMPOSITION_INPUT_BYTES,
    MAX_SINGLE_VIDEO_BYTES,
    _AUDIO_MIME_TYPES,
    MediaRuntimeError,
    compose_video_bundle,
    extract_boundary_frames,
    extract_handoff_frame,
    inspect_video_bytes,
    inspect_audio_bytes,
    final_review_video_bytes,
    burn_captions_video_bytes,
    synthesize_narration_bytes,
    synthesize_doubao_narration_bytes,
    synthesize_narration_segments_bytes,
    transcribe_video_bytes,
    validate_operation_id,
)
from adapters.openmontage_audio.pixabay_music import PixabayMusic
from adapters.openmontage_audio.selector import select_provider


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_SCRIPT_CONTEXT_CHARS = 8_000
# Captions carry a video plus an optional checked timing snapshot. Keep the
# loopback body bounded while allowing a realistic word-timestamp payload;
# do not move that payload into a custom HTTP header (common proxies cap those
# at 8–16 KiB).
MAX_CAPTION_REQUEST_BYTES = (MAX_SINGLE_VIDEO_BYTES * 4 // 3) + 2_000_000
MAX_PIXABAY_REQUEST_BYTES = 16_000
MAX_PIXABAY_AUDIO_BYTES = 50 * 1024 * 1024
MAX_NARRATION_REQUEST_BYTES = 16_000


def runtime_token() -> str:
    value = os.environ.get("MEDIA_RUNTIME_TOKEN")
    if not value:
        raise RuntimeError("MEDIA_RUNTIME_TOKEN is required for the media runtime.")
    return value


async def read_bounded_request(request: Request, *, maximum: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > maximum:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Media input is outside the supported range.")
        chunks.append(chunk)
    return b"".join(chunks)


def parse_narration_payload(payload: object) -> tuple[str | None, list[dict[str, object]] | None, int | None]:
    """Strict loopback equivalent of MediaRuntimeNarrationRequestSchema.

    The Python runtime is intentionally independent of the TypeScript client:
    hand-written requests must not make ``text`` silently win over segment
    delivery metadata or smuggle unknown fields across the boundary.
    """
    if not isinstance(payload, dict):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration request is invalid.")
    allowed = {
        "text", "segments", "target_duration_ms",
        # OpenMontage TTSSelector/Doubao source fields. These remain private
        # loopback inputs and are rejected unless a provider is explicit.
        "preferred_provider", "voice_id", "resource_id", "format", "sample_rate",
        "speech_rate", "enable_timestamp", "disable_markdown_filter", "return_usage",
        "poll_interval_seconds", "timeout_seconds",
    }
    if set(payload) - allowed:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration request contains unknown fields.")
    text = payload.get("text")
    segments = payload.get("segments")
    target_duration_ms = payload.get("target_duration_ms")
    if text is not None and (not isinstance(text, str) or not text.strip() or len(text.strip()) > 5_000):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration text is invalid.")
    if text is not None and segments is not None:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration text and segments are mutually exclusive.")
    if target_duration_ms is not None and (type(target_duration_ms) is not int or target_duration_ms <= 0 or target_duration_ms > 600_000):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration target duration is invalid.")
    if segments is not None:
        if not isinstance(segments, list) or not segments or len(segments) > 12 or target_duration_ms is None:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segments and target duration are invalid.")
        normalized: list[dict[str, object]] = []
        segment_keys = {"text", "provider_text", "start_ms", "pronunciation_guides", "pause_before_ms", "pause_after_ms", "pace", "energy"}
        for segment in segments:
            if not isinstance(segment, dict) or set(segment) - segment_keys:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segment is invalid.")
            segment_text = segment.get("text")
            provider_text = segment.get("provider_text")
            start_ms = segment.get("start_ms")
            if not isinstance(segment_text, str) or not segment_text.strip() or len(segment_text.strip()) > 2_000:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segment text is invalid.")
            if provider_text is not None and (not isinstance(provider_text, str) or not provider_text.strip() or len(provider_text.strip()) > 2_000):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration provider text is invalid.")
            if type(start_ms) is not int or start_ms < 0 or start_ms > 600_000:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segment start is invalid.")
            guides = segment.get("pronunciation_guides")
            if guides is not None:
                if not isinstance(guides, list) or len(guides) > 100:
                    raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pronunciation guides are invalid.")
                for guide in guides:
                    if not isinstance(guide, dict) or set(guide) != {"source", "spoken", "reason"} or any(not isinstance(guide.get(key), str) or not guide[key].strip() for key in ("source", "spoken", "reason")):
                        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pronunciation guide is invalid.")
            for key in ("pause_before_ms", "pause_after_ms"):
                value = segment.get(key)
                if value is not None and (type(value) is not int or value < 0 or value > 10_000):
                    raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pause metadata is invalid.")
            if segment.get("pace") is not None and segment.get("pace") not in {"SLOW", "NATURAL", "FAST"}:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pace metadata is invalid.")
            if segment.get("energy") is not None and segment.get("energy") not in {"CALM", "NEUTRAL", "EMPHATIC"}:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration energy metadata is invalid.")
            normalized.append(dict(segment))
        return None, normalized, target_duration_ms
    if text is None:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration text or segments are required.")
    return text.strip(), None, target_duration_ms


def parse_narration_provider_inputs(payload: object) -> dict[str, object]:
    """Validate and retain only source Doubao fields for an explicit route."""
    if not isinstance(payload, dict):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration request is invalid.")
    provider = payload.get("preferred_provider")
    if provider is not None and (not isinstance(provider, str) or not provider.strip() or len(provider.strip()) > 80):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration provider selection is invalid.")
    result: dict[str, object] = {}
    if provider is not None:
        result["preferred_provider"] = provider.strip()
    for key, maximum in (("voice_id", 160), ("resource_id", 160)):
        value = payload.get(key)
        if value is not None:
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", f"Narration {key} is invalid.")
            result[key] = value.strip()
    fmt = payload.get("format")
    if fmt is not None:
        if not isinstance(fmt, str) or fmt not in {"mp3", "ogg_opus", "pcm"}:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration format is invalid.")
        result["format"] = fmt
    sample_rate = payload.get("sample_rate")
    if sample_rate is not None:
        if type(sample_rate) is not int or sample_rate not in {8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000}:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration sample rate is invalid.")
        result["sample_rate"] = sample_rate
    speech_rate = payload.get("speech_rate")
    if speech_rate is not None:
        if type(speech_rate) is not int or speech_rate < -50 or speech_rate > 100:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration speech rate is invalid.")
        result["speech_rate"] = speech_rate
    for key in ("enable_timestamp", "disable_markdown_filter", "return_usage"):
        value = payload.get(key)
        if value is not None:
            if type(value) is not bool:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", f"Narration {key} is invalid.")
            result[key] = value
    poll_interval = payload.get("poll_interval_seconds")
    if poll_interval is not None:
        if isinstance(poll_interval, bool) or not isinstance(poll_interval, (int, float)) or not math.isfinite(float(poll_interval)) or poll_interval < 0.5:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration poll interval is invalid.")
        result["poll_interval_seconds"] = poll_interval
    timeout_seconds = payload.get("timeout_seconds")
    if timeout_seconds is not None:
        if type(timeout_seconds) is not int or timeout_seconds < 30:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration timeout is invalid.")
        result["timeout_seconds"] = timeout_seconds
    return result


def parse_pixabay_payload(payload: object) -> dict[str, object]:
    """Strict loopback boundary for the source tool's three search inputs."""
    if not isinstance(payload, dict) or set(payload) - {"query", "min_duration", "max_duration"}:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music request is invalid.")
    query = payload.get("query")
    if not isinstance(query, str) or not query.strip() or len(query.strip()) > 200:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music query is invalid.")
    normalized: dict[str, object] = {"query": query.strip()}
    for key, minimum, maximum in (("min_duration", 1, None), ("max_duration", None, 600)):
        value = payload.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music duration is invalid.")
        if isinstance(value, float) and not math.isfinite(value):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music duration is invalid.")
        if minimum is not None and value < minimum:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music duration is invalid.")
        if maximum is not None and value > maximum:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music duration is invalid.")
        normalized[key] = value
    return normalized


def encode_pixabay_header(value: object) -> str:
    return base64.urlsafe_b64encode(str(value).encode("utf-8")).decode("ascii")


def source_pixabay_filename(title: object) -> str:
    safe_title = "".join(character if character.isalnum() or character in "._- " else "_" for character in str(title))
    return f"pixabay_music_{safe_title[:60]}.mp3"


def forbidden_response(error: MediaRuntimeError) -> JSONResponse:
    status = 503 if error.retryable else 400
    return JSONResponse({"error": {"code": error.code, "retryable": error.retryable}}, status_code=status)


async def authorize(authorization: str | None, operation_id: str | None) -> str | JSONResponse:
    if authorization != f"Bearer {runtime_token()}":
        return JSONResponse({"error": {"code": "AUTH_FORBIDDEN", "retryable": False}}, status_code=403)
    try:
        return validate_operation_id(operation_id)
    except MediaRuntimeError as error:
        return forbidden_response(error)


def inspection_payload(value) -> dict[str, object]:
    payload: dict[str, object] = {
        "mime_type": value.mime_type,
        "sha256": value.sha256,
        "byte_size": value.byte_size,
        "width": value.width,
        "height": value.height,
        "duration_ms": value.duration_ms,
    }
    if value.has_audio:
        payload["has_audio"] = True
        if value.audio_channels is not None:
            payload["audio_channels"] = value.audio_channels
        if value.audio_sample_rate is not None:
            payload["audio_sample_rate"] = value.audio_sample_rate
    else:
        payload["has_audio"] = False
    return payload


@app.post("/internal/v1/media/pixabay-music")
async def pixabay_music(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
):
    """Run the source PixabayMusic scraper behind the loopback boundary.

    The browser never reaches Pixabay directly.  The adapter writes only to
    a Runtime-owned temporary path and this endpoint returns the measured MP3
    bytes plus source metadata headers for the Control API importer.
    """
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        payload = parse_pixabay_payload(json.loads(
            (await read_bounded_request(request, maximum=MAX_PIXABAY_REQUEST_BYTES)).decode("utf-8")
        ))
        with TemporaryDirectory(prefix="alchemy-pixabay-") as directory:
            result = PixabayMusic().execute({**payload, "output_path": str(Path(directory) / "pixabay_music.mp3")})
            audio = result.output_path.read_bytes()
        if not audio or len(audio) > MAX_PIXABAY_AUDIO_BYTES:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music output is outside the supported range.")
    except MediaRuntimeError as error:
        return forbidden_response(error)
    except (UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError):
        return forbidden_response(MediaRuntimeError("MEDIA_RENDER_FAILED", "Pixabay Music request is invalid."))
    except Exception as error:
        if str(error).startswith("No music found on Pixabay"):
            return forbidden_response(MediaRuntimeError("MEDIA_RENDER_FAILED", str(error)))
        return forbidden_response(MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "Pixabay Music is unavailable.", retryable=True))
    track = result.track
    rating = track.get("rating")
    download_count = track.get("download_count")
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "X-Pixabay-Track-Title-Base64": encode_pixabay_header(track.get("title", "Unknown")),
            "X-Pixabay-Artist-Base64": encode_pixabay_header(track.get("artist", "Unknown")),
            "X-Pixabay-Filename-Base64": encode_pixabay_header(source_pixabay_filename(track.get("title", "pixabay_music"))),
            "X-Pixabay-Query-Base64": encode_pixabay_header(payload["query"]),
            "X-Pixabay-Duration": "" if track.get("duration") is None else str(track.get("duration")),
            "X-Pixabay-Id": "" if track.get("pixabay_id") is None else str(track.get("pixabay_id")),
            "X-Pixabay-Rating": str(rating) if isinstance(rating, (int, float)) and math.isfinite(rating) else "",
            "X-Pixabay-Download-Count": str(download_count) if isinstance(download_count, (int, float)) and math.isfinite(download_count) else "",
            "X-Pixabay-Results-Found": str(result.results_found),
            "X-Pixabay-Results-After-Filter": str(result.results_after_filter),
            "X-Media-Sha256": hashlib.sha256(audio).hexdigest(),
            "X-Media-Byte-Size": str(len(audio)),
        },
    )


@app.post("/internal/v1/media/inspect")
async def inspect_video(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "video/mp4":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        return inspection_payload(inspect_video_bytes(
            body=await read_bounded_request(request, maximum=MAX_SINGLE_VIDEO_BYTES),
            expected_sha256=x_media_expected_sha256,
        ))
    except MediaRuntimeError as error:
        return forbidden_response(error)


@app.post("/internal/v1/media/handoff-frame")
async def handoff_frame(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "video/mp4":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        result = extract_handoff_frame(
            body=await read_bounded_request(request, maximum=MAX_SINGLE_VIDEO_BYTES),
            expected_sha256=x_media_expected_sha256,
        )
    except MediaRuntimeError as error:
        return forbidden_response(error)
    return Response(
        content=result.bytes,
        media_type=result.mime_type,
        headers={
            "X-Media-Sha256": result.sha256,
            "X-Media-Byte-Size": str(result.byte_size),
            "X-Media-Width": str(result.width),
            "X-Media-Height": str(result.height),
        },
    )


@app.post("/internal/v1/media/boundary-frames")
async def boundary_frames(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "video/mp4":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        result = extract_boundary_frames(
            body=await read_bounded_request(request, maximum=MAX_SINGLE_VIDEO_BYTES),
            expected_sha256=x_media_expected_sha256,
        )
    except MediaRuntimeError as error:
        return forbidden_response(error)
    return {
        "first": {
            "mime_type": result.first.mime_type,
            "sha256": result.first.sha256,
            "byte_size": result.first.byte_size,
            "width": result.first.width,
            "height": result.first.height,
            "bytes_base64": base64.b64encode(result.first.bytes).decode("ascii"),
        },
        "last": {
            "mime_type": result.last.mime_type,
            "sha256": result.last.sha256,
            "byte_size": result.last.byte_size,
            "width": result.last.width,
            "height": result.last.height,
            "bytes_base64": base64.b64encode(result.last.bytes).decode("ascii"),
        },
    }


@app.post("/internal/v1/media/audio-inspect")
async def inspect_audio(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in _AUDIO_MIME_TYPES:
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        result = inspect_audio_bytes(
            body=await read_bounded_request(request, maximum=MAX_SINGLE_VIDEO_BYTES),
            expected_sha256=x_media_expected_sha256,
        )
    except MediaRuntimeError as error:
        return forbidden_response(error)
    return {
        "mime_type": result.mime_type,
        "sha256": result.sha256,
        "byte_size": result.byte_size,
        "duration_ms": result.duration_ms,
    }


@app.post("/internal/v1/media/final-review")
async def final_review(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
    x_media_script_text_base64: str | None = Header(default=None),
    x_media_caption_policy: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "video/mp4":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        script_text = None
        if isinstance(x_media_script_text_base64, str) and x_media_script_text_base64:
            try:
                decoded_script = base64.urlsafe_b64decode(x_media_script_text_base64 + "=" * (-len(x_media_script_text_base64) % 4)).decode("utf-8")
                if len(decoded_script) > MAX_SCRIPT_CONTEXT_CHARS:
                    raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Script context exceeds the supported limit.")
                script_text = decoded_script
            except (ValueError, UnicodeDecodeError):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Script context header is invalid.")
        return final_review_video_bytes(
            body=await read_bounded_request(request, maximum=MAX_SINGLE_VIDEO_BYTES),
            expected_sha256=x_media_expected_sha256,
            script_text=script_text,
            caption_policy=x_media_caption_policy or "OFF",
        ).payload
    except MediaRuntimeError as error:
        return forbidden_response(error)


@app.post("/internal/v1/media/captions")
async def burn_captions(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    """Burn a checked SubtitleGen SRT through the local FFmpeg fallback.

    A caller may provide an approved transcript/timing snapshot; otherwise the
    runtime attempts its configured local transcriber.  No timing is invented
    from raw script text at this boundary.
    """
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        raw = await read_bounded_request(request, maximum=MAX_CAPTION_REQUEST_BYTES)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption request is invalid.")
        if not isinstance(payload, dict) or set(payload) - {"video_base64", "transcript"}:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption request is invalid.")
        encoded_video = payload.get("video_base64")
        if not isinstance(encoded_video, str) or not encoded_video:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption video payload is invalid.")
        try:
            video_bytes = base64.b64decode(encoded_video, validate=True)
        except (ValueError, binascii.Error):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption video payload is invalid.")
        if not video_bytes or len(video_bytes) > MAX_SINGLE_VIDEO_BYTES:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption video payload is outside the supported range.")
        transcript = payload.get("transcript")
        if transcript is not None and not isinstance(transcript, dict):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Transcript timing input is invalid.")
        result = burn_captions_video_bytes(
            body=video_bytes,
            expected_sha256=x_media_expected_sha256,
            transcript=transcript,
        )
    except (MediaRuntimeError, ValueError, TypeError) as error:
        if not isinstance(error, MediaRuntimeError):
            error = MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption request is invalid.")
        return forbidden_response(error)
    return Response(
        content=result.bytes,
        media_type="video/mp4",
        headers={
            "X-Media-Sha256": result.inspection.sha256,
            "X-Media-Byte-Size": str(result.inspection.byte_size),
            "X-Media-Width": str(result.inspection.width),
            "X-Media-Height": str(result.inspection.height),
            "X-Media-Duration-Ms": str(result.inspection.duration_ms),
            "X-Media-Has-Audio": "true" if result.inspection.has_audio else "false",
            "X-Media-Captions-Present": "true",
        },
    )


@app.post("/internal/v1/media/transcribe")
async def transcribe_video(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "video/mp4":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        return transcribe_video_bytes(
            body=await read_bounded_request(request, maximum=MAX_SINGLE_VIDEO_BYTES),
            expected_sha256=x_media_expected_sha256,
        )
    except MediaRuntimeError as error:
        return forbidden_response(error)


@app.post("/internal/v1/media/narration")
async def synthesize_narration(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        payload = json.loads(
            (await read_bounded_request(request, maximum=MAX_NARRATION_REQUEST_BYTES)).decode("utf-8")
        )
        text, segments, target_duration_ms = parse_narration_payload(payload)
        provider_inputs = parse_narration_provider_inputs(payload)
        preferred_provider = provider_inputs.get("preferred_provider")
        if preferred_provider in {"doubao", "doubao_tts"}:
            try:
                selected_provider = select_provider(str(preferred_provider))
            except RuntimeError as error:
                raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", str(error), retryable=True) from error
            if selected_provider != "doubao":
                raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The requested TTS provider is unavailable in the local Runtime.", retryable=True)
            if text is None:
                raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The source Doubao route requires one canonical text input.", retryable=True)
            audio, mime_type, duration_ms = synthesize_doubao_narration_bytes(
                text=text,
                source_inputs=provider_inputs,
            )
        elif preferred_provider in {None, "piper", "piper_tts"}:
            if any(key != "preferred_provider" for key in provider_inputs):
                raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "Provider-specific narration fields require an explicit source provider.", retryable=True)
            if text is not None:
                audio, duration_ms = synthesize_narration_bytes(text=text)
            else:
                assert segments is not None and target_duration_ms is not None
                audio, duration_ms = synthesize_narration_segments_bytes(segments=segments, target_duration_ms=target_duration_ms)
            mime_type = "audio/wav"
        else:
            # Reuse the source selector's registry-first failure semantics for
            # auto/unknown values.  The local Runtime has no provider
            # registry, so it must not invent a ranking or fallback.
            try:
                select_provider(preferred_provider if isinstance(preferred_provider, str) else "auto")
            except RuntimeError as error:
                raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", str(error), retryable=True) from error
            raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The requested TTS provider is unavailable in the local Runtime.", retryable=True)
    except MediaRuntimeError as error:
        return forbidden_response(error)
    except (UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError):
        return forbidden_response(MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration request is invalid."))
    return Response(
        content=audio,
        media_type=mime_type,
        headers={
            "X-Media-Sha256": hashlib.sha256(audio).hexdigest(),
            "X-Media-Byte-Size": str(len(audio)),
            "X-Media-Duration-Ms": str(duration_ms),
        },
    )


@app.post("/internal/v1/media/compose")
async def compose_video(
    request: Request,
    authorization: str | None = Header(default=None),
    x_media_operation_id: str | None = Header(default=None),
    x_media_expected_sha256: str | None = Header(default=None),
):
    authorized = await authorize(authorization, x_media_operation_id)
    if isinstance(authorized, JSONResponse):
        return authorized
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/vnd.alchemy-media-bundle":
        return JSONResponse({"error": {"code": "MEDIA_RENDER_FAILED", "retryable": False}}, status_code=400)
    try:
        body = await read_bounded_request(request, maximum=MAX_COMPOSITION_INPUT_BYTES)
        if not (body.startswith(COMPOSITION_MAGIC) or body.startswith(COMPOSITION_PLAN_MAGIC) or body.startswith(COMPOSITION_AUDIO_PLAN_MAGIC) or body.startswith(COMPOSITION_MUSIC_PLAN_MAGIC) or body.startswith(COMPOSITION_NARRATION_PLAN_MAGIC) or body.startswith(COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC) or body.startswith(COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC) or body.startswith(COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC)):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
        result = compose_video_bundle(body=body, expected_sha256=x_media_expected_sha256)
    except MediaRuntimeError as error:
        return forbidden_response(error)
    return Response(
        content=result.bytes,
        media_type=result.inspection.mime_type,
        headers={
            "X-Media-Sha256": result.inspection.sha256,
            "X-Media-Byte-Size": str(result.inspection.byte_size),
            "X-Media-Width": str(result.inspection.width),
            "X-Media-Height": str(result.inspection.height),
            "X-Media-Duration-Ms": str(result.inspection.duration_ms),
            "X-Media-Has-Audio": "true" if result.inspection.has_audio else "false",
            **({"X-Media-Audio-Channels": str(result.inspection.audio_channels)} if result.inspection.audio_channels is not None else {}),
            **({"X-Media-Audio-Sample-Rate": str(result.inspection.audio_sample_rate)} if result.inspection.audio_sample_rate is not None else {}),
        },
    )
