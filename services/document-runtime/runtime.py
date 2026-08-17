from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePath

from markitdown import MarkItDown, StreamInfo, __version__ as MARKITDOWN_VERSION


MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_OUTPUT_BYTES = 10 * 1024 * 1024
ALLOWED_MIME_TYPES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "text/markdown": ".md",
    "text/plain": ".txt",
}


class DocumentRuntimeError(ValueError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class ConversionResult:
    markdown: str
    converter: str
    converter_version: str
    warnings: list[str]


def safe_filename(value: str, mime_type: str) -> str:
    if not value or len(value) > 255 or any(character in value for character in ("/", "\\", "\x00")):
        raise DocumentRuntimeError("DOCUMENT_UNSUPPORTED", "Source filename is invalid.")
    suffix = PurePath(value).suffix.lower()
    if suffix and suffix != ALLOWED_MIME_TYPES[mime_type]:
        raise DocumentRuntimeError("DOCUMENT_UNSUPPORTED", "Source filename extension does not match its MIME type.")
    return value


def convert_bytes(*, body: bytes, mime_type: str, filename: str) -> ConversionResult:
    if mime_type not in ALLOWED_MIME_TYPES:
        raise DocumentRuntimeError("DOCUMENT_UNSUPPORTED", "This document format is not supported.")
    if not body or len(body) > MAX_INPUT_BYTES:
        raise DocumentRuntimeError("DOCUMENT_UNSUPPORTED", "Document size is outside the supported range.")
    filename = safe_filename(filename, mime_type)
    try:
        result = MarkItDown(enable_plugins=False).convert_stream(
            BytesIO(body),
            stream_info=StreamInfo(mimetype=mime_type, extension=ALLOWED_MIME_TYPES[mime_type], filename=filename),
        )
    except Exception as error:
        raise DocumentRuntimeError("DOCUMENT_CONVERSION_FAILED", "The document could not be converted.") from error
    markdown = result.text_content
    encoded = markdown.encode("utf-8")
    if not markdown.strip() or len(encoded) > MAX_OUTPUT_BYTES:
        raise DocumentRuntimeError("DOCUMENT_OUTPUT_INVALID", "Converted Markdown is outside the supported range.")
    return ConversionResult(markdown=markdown, converter="markitdown", converter_version=MARKITDOWN_VERSION, warnings=[])
