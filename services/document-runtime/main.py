from __future__ import annotations

import hashlib
import os

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

from runtime import ALLOWED_MIME_TYPES, MAX_INPUT_BYTES, DocumentRuntimeError, convert_bytes


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def runtime_token() -> str:
    value = os.environ.get("DOCUMENT_RUNTIME_TOKEN")
    if not value:
        raise RuntimeError("DOCUMENT_RUNTIME_TOKEN is required for the document runtime.")
    return value


async def read_bounded_request(request: Request) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_INPUT_BYTES:
            raise DocumentRuntimeError("DOCUMENT_UNSUPPORTED", "Document size is outside the supported range.")
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/internal/v1/document-conversions")
async def convert_document(
    request: Request,
    authorization: str | None = Header(default=None),
    x_document_conversion_id: str | None = Header(default=None),
    x_source_filename: str | None = Header(default=None),
    x_source_sha256: str | None = Header(default=None),
):
    if authorization != f"Bearer {runtime_token()}":
        return JSONResponse({"error": {"code": "AUTH_FORBIDDEN", "retryable": False}}, status_code=403)
    if not x_document_conversion_id or not x_source_filename or not x_source_sha256:
        return JSONResponse({"error": {"code": "DOCUMENT_UNSUPPORTED", "retryable": False}}, status_code=400)
    mime_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if mime_type not in ALLOWED_MIME_TYPES:
        return JSONResponse({"error": {"code": "DOCUMENT_UNSUPPORTED", "retryable": False}}, status_code=400)
    try:
        body = await read_bounded_request(request)
        if hashlib.sha256(body).hexdigest() != x_source_sha256:
            return JSONResponse({"error": {"code": "DOCUMENT_UNSUPPORTED", "retryable": False}}, status_code=400)
        result = convert_bytes(body=body, mime_type=mime_type, filename=x_source_filename)
    except DocumentRuntimeError as error:
        status_code = 413 if error.code == "DOCUMENT_UNSUPPORTED" and "size" in str(error).lower() else 400
        return JSONResponse({"error": {"code": error.code, "retryable": error.retryable}}, status_code=status_code)
    return {"markdown": result.markdown, "converter": result.converter, "converter_version": result.converter_version, "warnings": result.warnings}
