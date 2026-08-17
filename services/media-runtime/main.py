from __future__ import annotations

import hashlib
import os

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse, Response

from runtime import (
    COMPOSITION_MAGIC,
    MAX_COMPOSITION_INPUT_BYTES,
    MAX_SINGLE_VIDEO_BYTES,
    MediaRuntimeError,
    compose_video_bundle,
    extract_handoff_frame,
    inspect_video_bytes,
    validate_operation_id,
)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


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
    return {
        "mime_type": value.mime_type,
        "sha256": value.sha256,
        "byte_size": value.byte_size,
        "width": value.width,
        "height": value.height,
        "duration_ms": value.duration_ms,
    }


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
        if not body.startswith(COMPOSITION_MAGIC):
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
        },
    )
