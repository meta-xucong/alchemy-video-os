"""Private, source-faithful Doubao Speech request boundary.

Source: calesthio/OpenMontage ``tools/audio/doubao_tts.py`` at
``4eab34c5cfcccaa4f1970554928feccce73ee930``.  The request headers and
``req_params`` shape below mirror ``DoubaoTTS._headers`` (source lines
294-310) and ``DoubaoTTS._submit_body`` (source lines 312-331).

The adapter owns only the source execution boundary.  Provider selection remains
an explicit Runtime input; this module does not rank providers or provide a
fallback.  A caller must supply the source-owned voice/resource profile or an
explicitly configured environment; unresolved configuration fails closed.
"""

from __future__ import annotations

import json
from hashlib import sha256
import math
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit


SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/tts/submit"
QUERY_URL = "https://openspeech.bytedance.com/api/v3/tts/query"
DEFAULT_RESOURCE_ID = "seed-tts-2.0"
DOUBAO_SPEECH_API_KEY_ENV = "DOUBAO_SPEECH_API_KEY"
DOUBAO_SPEECH_VOICE_ENV = "DOUBAO_SPEECH_VOICE_TYPE"


class DoubaoConfigurationError(RuntimeError):
    """Raised when an explicit Doubao profile cannot be resolved."""


class DoubaoExecutionError(RuntimeError):
    """Raised when the source submit/poll/download chain cannot complete."""


@dataclass(frozen=True, repr=False)
class DoubaoProfile:
    """Private source-field profile; it is not a platform contract DTO."""

    api_key: str
    voice_id: str
    resource_id: str = DEFAULT_RESOURCE_ID

    def __post_init__(self) -> None:
        if not isinstance(self.api_key, str) or not self.api_key:
            raise DoubaoConfigurationError("Doubao Speech API key is required for an explicit profile.")
        if not isinstance(self.voice_id, str) or not self.voice_id.strip():
            raise DoubaoConfigurationError("Doubao voice_id is required for an explicit profile.")
        if not isinstance(self.resource_id, str) or not self.resource_id.strip():
            raise DoubaoConfigurationError("Doubao resource_id is required for an explicit profile.")


@dataclass(frozen=True, repr=False)
class DoubaoArtifact:
    """Private result facts for a downloaded source-format audio artifact."""

    bytes: bytes
    mime_type: str
    sha256: str
    byte_size: int
    task_id: str
    provider: str
    voice_id: str
    resource_id: str
    format: str
    sample_rate: int
    speech_rate: int
    metadata: dict[str, Any]
    metadata_bytes: bytes
    audio_duration_seconds: float | None
    sentences: list[Any]
    usage: Any
    task_status: Any
    req_text_length: Any
    synthesize_text_length: Any
    url_expire_time: Any


class DoubaoTTS:
    """Source-name-compatible explicit provider execution boundary.

    OpenMontage's ``execute``/``_generate``/``_poll_query`` ordering is kept;
    the platform adaptation is only in-memory result transport, temporary
    files, and error/metadata normalization at the private Runtime boundary.
    """

    name = "doubao_tts"
    provider = "doubao"
    SUBMIT_URL = SUBMIT_URL
    QUERY_URL = QUERY_URL
    DEFAULT_RESOURCE_ID = DEFAULT_RESOURCE_ID
    DEFAULT_VOICE_ENV = DOUBAO_SPEECH_VOICE_ENV

    @staticmethod
    def get_status(environ: Mapping[str, str] | None = None) -> bool:
        """Mirror source ``get_status`` without selecting or invoking a tool."""
        values = os.environ if environ is None else environ
        return bool(values.get(DOUBAO_SPEECH_API_KEY_ENV))

    @staticmethod
    def profile_from_environment(environ: Mapping[str, str] | None = None) -> DoubaoProfile:
        """Resolve the source's explicit key/voice environment inputs.

        This helper is not called by the Runtime automatically.  It exists so
        an explicitly selected future profile can fail closed before any I/O.
        ``resource_id`` remains the source input default rather than a new
        environment-controlled setting.
        """
        values = os.environ if environ is None else environ
        api_key = values.get(DOUBAO_SPEECH_API_KEY_ENV)
        if not api_key:
            raise DoubaoConfigurationError("No Doubao Speech API key for the explicit profile.")
        voice_id = values.get(DOUBAO_SPEECH_VOICE_ENV)
        if not voice_id:
            raise DoubaoConfigurationError("No Doubao voice_id for the explicit profile.")
        return DoubaoProfile(api_key=api_key, voice_id=voice_id)

    @staticmethod
    def _headers(
        *,
        api_key: str,
        resource_id: str,
        request_id: str,
        return_usage: bool,
    ) -> dict[str, str]:
        """Mirror ``DoubaoTTS._headers`` exactly; never log or persist key."""
        headers = {
            "X-Api-Key": api_key,
            "X-Api-Resource-Id": resource_id,
            "X-Api-Request-Id": request_id,
            "Content-Type": "application/json",
        }
        if return_usage:
            headers["X-Control-Require-Usage-Tokens-Return"] = "true"
        return headers

    @staticmethod
    def _submit_body(inputs: Mapping[str, Any], *, voice_id: str, request_id: str) -> dict[str, Any]:
        """Mirror ``DoubaoTTS._submit_body`` including its JSON additions field."""
        audio_params = {
            "format": inputs.get("format", "mp3"),
            "sample_rate": inputs.get("sample_rate", 24000),
            "speech_rate": inputs.get("speech_rate", 0),
            "enable_timestamp": bool(inputs.get("enable_timestamp", True)),
        }
        additions = {
            "disable_markdown_filter": bool(inputs.get("disable_markdown_filter", False)),
        }
        return {
            "user": {"uid": inputs.get("user_id", "openmontage")},
            "unique_id": request_id,
            "req_params": {
                "text": inputs["text"],
                "speaker": voice_id,
                "audio_params": audio_params,
                "additions": json.dumps(additions, ensure_ascii=False),
            },
        }

    @staticmethod
    def _source_override(inputs: Mapping[str, Any], key: str, fallback: str) -> str:
        """Resolve a source input override, retaining an explicit profile fallback."""
        if key not in inputs:
            return fallback
        value = inputs[key]
        if not isinstance(value, str) or not value.strip():
            raise DoubaoConfigurationError(f"Doubao {key} override is invalid.")
        return value

    @classmethod
    def build_submit_request(
        cls,
        inputs: Mapping[str, Any],
        *,
        profile: DoubaoProfile,
        request_id: str,
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        """Build the source submit URL, headers and JSON body without I/O."""
        if not isinstance(profile, DoubaoProfile):
            raise DoubaoConfigurationError("Doubao submit requires an explicit profile.")
        voice_id = cls._source_override(inputs, "voice_id", profile.voice_id)
        resource_id = cls._source_override(inputs, "resource_id", profile.resource_id)
        return (
            cls.SUBMIT_URL,
            cls._headers(
                api_key=profile.api_key,
                resource_id=resource_id,
                request_id=request_id,
                return_usage=bool(inputs.get("return_usage", True)),
            ),
            cls._submit_body(inputs, voice_id=voice_id, request_id=request_id),
        )

    @classmethod
    def build_query_request(
        cls,
        *,
        profile: DoubaoProfile,
        request_id: str,
        task_id: str,
        return_usage: bool,
    ) -> tuple[str, dict[str, str], dict[str, str]]:
        """Build the source poll URL, headers and JSON body without I/O."""
        if not isinstance(profile, DoubaoProfile):
            raise DoubaoConfigurationError("Doubao query requires an explicit profile.")
        return (
            cls.QUERY_URL,
            cls._headers(
                api_key=profile.api_key,
                resource_id=profile.resource_id,
                request_id=request_id,
                return_usage=return_usage,
            ),
            {"task_id": task_id},
        )

    @classmethod
    def execute(
        cls,
        inputs: Mapping[str, Any],
        *,
        profile: DoubaoProfile | None = None,
        transport: Any | None = None,
        sleep_fn: Any = time.sleep,
        clock: Any = time.time,
        request_id: str | None = None,
        duration_probe: Any | None = None,
    ) -> DoubaoArtifact:
        """Run the source submit -> poll -> download sequence.

        ``transport`` and ``duration_probe`` are private test/runtime seams;
        the normal path lazily uses the source's ``requests`` dependency and
        the caller must explicitly provide a profile or configured env.  This
        class never selects a default or provides a selector fallback.
        """
        source_inputs = cls._validate_inputs(inputs)
        if profile is not None and not isinstance(profile, DoubaoProfile):
            raise DoubaoConfigurationError("Doubao execute requires an explicit profile.")
        if profile is None:
            api_key = os.environ.get(DOUBAO_SPEECH_API_KEY_ENV)
            if not api_key:
                raise DoubaoConfigurationError("No Doubao Speech API key for the explicit profile.")
            input_voice = source_inputs.get("voice_id")
            if input_voice is not None and (not isinstance(input_voice, str) or not input_voice.strip()):
                raise DoubaoConfigurationError("Doubao voice_id override is invalid.")
            env_voice = os.environ.get(DOUBAO_SPEECH_VOICE_ENV)
            voice = input_voice if input_voice is not None else env_voice
            if not voice:
                raise DoubaoConfigurationError("No Doubao voice_id for the explicit profile.")
            active_profile = DoubaoProfile(api_key=api_key, voice_id=voice)
        else:
            active_profile = profile
        resolved_voice = cls._source_override(source_inputs, "voice_id", active_profile.voice_id)
        resolved_resource = cls._source_override(source_inputs, "resource_id", active_profile.resource_id)
        operation_id = request_id or str(uuid.uuid4())
        if not isinstance(operation_id, str) or not operation_id:
            raise DoubaoConfigurationError("Doubao request id is required for an explicit profile.")
        client = transport or cls._default_transport()

        try:
            submit_url, headers, body = cls.build_submit_request(
                source_inputs,
                profile=DoubaoProfile(active_profile.api_key, resolved_voice, resolved_resource),
                request_id=operation_id,
            )
            submit_response = client.post(submit_url, headers=headers, json=body, timeout=(10, 60))
            submit_data = cls._json_or_raise(submit_response)
            cls._raise_for_doubao_error(cls._status_code(submit_response), submit_data)
            task_id = cls._task_id(submit_data)

            query_data = cls._poll_query(
                requests_module=client,
                profile=DoubaoProfile(active_profile.api_key, resolved_voice, resolved_resource),
                task_id=task_id,
                return_usage=bool(source_inputs.get("return_usage", True)),
                poll_interval=float(source_inputs.get("poll_interval_seconds", 2.0)),
                timeout_seconds=int(source_inputs.get("timeout_seconds", 300)),
                sleep_fn=sleep_fn,
                clock=clock,
            )
            data = query_data.get("data", {})
            if not isinstance(data, dict):
                raise DoubaoExecutionError("Doubao query succeeded but data is invalid")
            audio_url = data.get("audio_url")
            if not isinstance(audio_url, str) or not audio_url:
                raise DoubaoExecutionError("Doubao task completed but did not return data.audio_url")

            try:
                audio_response = client.get(audio_url, timeout=(10, 120))
                cls._raise_for_http_status(audio_response)
            except Exception as exc:
                raise DoubaoExecutionError(
                    f"Doubao audio download failed: {cls._safe_error(exc, api_key=active_profile.api_key, sensitive_url=audio_url)}"
                ) from exc
            audio_bytes = getattr(audio_response, "content", None)
            if not isinstance(audio_bytes, bytes) or not audio_bytes:
                raise DoubaoExecutionError("Doubao audio download returned no bytes")
            audio_format = source_inputs.get("format", "mp3")
            mime_type = cls._mime_type_for_format(audio_format)

            digest = sha256(audio_bytes).hexdigest()
            metadata_bytes = (json.dumps(query_data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            # OpenMontage writes both artifacts before probing the audio. Keep
            # that ordering and use Runtime-owned temporary files instead of
            # allowing a caller-provided path to escape the boundary.
            with TemporaryDirectory(prefix="alchemy-doubao-") as directory:
                output_path = Path(directory) / f"doubao_tts.{cls._extension_for_format(audio_format)}"
                metadata_path = output_path.with_suffix(output_path.suffix + ".json")
                output_path.write_bytes(audio_bytes)
                metadata_path.write_bytes(metadata_bytes)
                duration = cls._audio_duration(output_path, duration_probe=duration_probe)
            if duration is not None:
                if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(float(duration)) or duration <= 0:
                    raise DoubaoExecutionError("Doubao audio duration is invalid")
                duration = round(float(duration), 2)

            return DoubaoArtifact(
                bytes=audio_bytes,
                mime_type=mime_type,
                sha256=digest,
                byte_size=len(audio_bytes),
                task_id=task_id,
                provider=cls.provider,
                voice_id=resolved_voice,
                resource_id=resolved_resource,
                format=audio_format,
                sample_rate=source_inputs.get("sample_rate", 24000),
                speech_rate=source_inputs.get("speech_rate", 0),
                metadata=query_data,
                metadata_bytes=metadata_bytes,
                audio_duration_seconds=duration,
                sentences=data.get("sentences", []),
                usage=data.get("usage"),
                task_status=data.get("task_status"),
                req_text_length=data.get("req_text_length"),
                synthesize_text_length=data.get("synthesize_text_length"),
                url_expire_time=data.get("url_expire_time"),
            )
        except DoubaoConfigurationError:
            raise
        except DoubaoExecutionError:
            raise
        except Exception as exc:
            raise DoubaoExecutionError(
                f"Doubao TTS failed: {cls._safe_error(exc, api_key=active_profile.api_key)}"
            ) from exc

    @staticmethod
    def _validate_inputs(inputs: Mapping[str, Any]) -> dict[str, Any]:
        """Keep the source input schema's bounded values before any I/O."""
        if not isinstance(inputs, Mapping):
            raise DoubaoConfigurationError("Doubao inputs must be an object.")
        text = inputs.get("text")
        if not isinstance(text, str) or not text.strip():
            raise DoubaoConfigurationError("Doubao text is required.")
        result = dict(inputs)
        fmt = result.get("format", "mp3")
        if not isinstance(fmt, str) or fmt not in {"mp3", "ogg_opus", "pcm"}:
            raise DoubaoConfigurationError("Doubao format is invalid.")
        sample_rate = result.get("sample_rate", 24000)
        if type(sample_rate) is not int or sample_rate not in {8000, 16000, 22050, 24000, 32000, 44100, 48000}:
            raise DoubaoConfigurationError("Doubao sample_rate is invalid.")
        speech_rate = result.get("speech_rate", 0)
        if type(speech_rate) is not int or speech_rate < -50 or speech_rate > 100:
            raise DoubaoConfigurationError("Doubao speech_rate is invalid.")
        for key in ("enable_timestamp", "disable_markdown_filter", "return_usage"):
            if key in result and type(result[key]) is not bool:
                raise DoubaoConfigurationError(f"Doubao {key} is invalid.")
        poll_interval = result.get("poll_interval_seconds", 2.0)
        if isinstance(poll_interval, bool) or not isinstance(poll_interval, (int, float)) or not math.isfinite(float(poll_interval)) or poll_interval < 0.5:
            raise DoubaoConfigurationError("Doubao poll_interval_seconds is invalid.")
        timeout_seconds = result.get("timeout_seconds", 300)
        if type(timeout_seconds) is not int or timeout_seconds < 30:
            raise DoubaoConfigurationError("Doubao timeout_seconds is invalid.")
        return result

    @staticmethod
    def _default_transport() -> Any:
        try:
            import requests
        except ImportError as exc:
            raise DoubaoConfigurationError("Doubao requests transport is unavailable.") from exc
        return requests

    @staticmethod
    def _audio_duration(path: Path, *, duration_probe: Any | None = None) -> float | None:
        """Mirror source ``_audio_duration`` against a Runtime-owned path."""
        try:
            if duration_probe is not None:
                return duration_probe(path)
            # Keep the source probe first when the OpenMontage tool package is
            # present; the Runtime fallback uses its existing ffprobe gate.
            try:
                from tools.analysis.audio_probe import probe_duration

                return probe_duration(path)
            except Exception:
                from runtime import _probe_audio_path_duration

                return _probe_audio_path_duration(path)
        except Exception:
            return None

    @classmethod
    def _poll_query(
        cls,
        *,
        requests_module: Any,
        profile: DoubaoProfile,
        task_id: str,
        return_usage: bool,
        poll_interval: float,
        timeout_seconds: int,
        sleep_fn: Any = time.sleep,
        clock: Any = time.time,
    ) -> dict[str, Any]:
        """Mirror source ``_poll_query`` including pre-query sleep."""
        deadline = clock() + timeout_seconds
        while clock() < deadline:
            sleep_fn(poll_interval)
            url, headers, body = cls.build_query_request(
                profile=profile,
                request_id=str(uuid.uuid4()),
                task_id=task_id,
                return_usage=return_usage,
            )
            response = requests_module.post(url, headers=headers, json=body, timeout=(10, 60))
            query_data = cls._json_or_raise(response)
            cls._raise_for_doubao_error(cls._status_code(response), query_data)
            data = query_data.get("data", {})
            status = data.get("task_status") if isinstance(data, dict) else None
            if status == 2:
                return query_data
            if status == 3:
                raise DoubaoExecutionError(f"Doubao task failed: {query_data.get('message', 'unknown error')}")
        raise DoubaoExecutionError(f"Doubao task did not finish within {timeout_seconds} seconds")

    @staticmethod
    def _task_id(payload: Mapping[str, Any]) -> str:
        data = payload.get("data", {})
        task_id = data.get("task_id") if isinstance(data, dict) else None
        if not isinstance(task_id, str) or not task_id:
            raise DoubaoExecutionError("Doubao submit succeeded but did not return data.task_id")
        return task_id

    @staticmethod
    def _status_code(response: Any) -> int:
        status_code = getattr(response, "status_code", None)
        return status_code if isinstance(status_code, int) else 0

    @staticmethod
    def _raise_for_http_status(response: Any) -> None:
        raise_for_status = getattr(response, "raise_for_status", None)
        if callable(raise_for_status):
            raise_for_status()
            return
        status_code = DoubaoTTS._status_code(response)
        if status_code >= 400 or status_code == 0:
            raise DoubaoExecutionError(f"Doubao audio download failed: HTTP {status_code}")

    @staticmethod
    def _response_content_type(response: Any) -> str | None:
        headers = getattr(response, "headers", {})
        value = None
        if hasattr(headers, "get"):
            value = headers.get("Content-Type") or headers.get("content-type")
        if not isinstance(value, str):
            return None
        return value.split(";", 1)[0].strip().lower()

    @staticmethod
    def _extension_for_format(fmt: str) -> str:
        """Mirror the source output extension mapping for temp artifacts."""
        if fmt == "ogg_opus":
            return "ogg"
        if fmt == "pcm":
            return "pcm"
        return "mp3"

    @staticmethod
    def _mime_type_for_format(fmt: str) -> str:
        return {"mp3": "audio/mpeg", "ogg_opus": "audio/ogg", "pcm": "audio/pcm"}[fmt]

    @staticmethod
    def _json_or_raise(response: Any) -> dict[str, Any]:
        try:
            payload = response.json()
        except (ValueError, AttributeError) as exc:
            raise DoubaoExecutionError(
                f"Non-JSON response from Doubao API: HTTP {DoubaoTTS._status_code(response)}"
            ) from exc
        if not isinstance(payload, dict):
            raise DoubaoExecutionError("Doubao API response is not an object")
        return payload

    @staticmethod
    def _raise_for_doubao_error(http_status: int, payload: Mapping[str, Any]) -> None:
        """Mirror source success/error interpretation without provider fallback."""
        code = payload.get("code")
        if http_status < 400 and code == 20000000:
            return
        message = payload.get("message", "unknown error")
        hint = DoubaoTTS._diagnostic_hint(str(message))
        raise RuntimeError(f"HTTP {http_status}, code {code}: {message}{hint}")

    @staticmethod
    def _diagnostic_hint(message: str) -> str:
        lowered = message.lower()
        if "load grant" in lowered or "requested grant not found" in lowered:
            return " (check DOUBAO_SPEECH_API_KEY and use the new-console X-Api-Key flow)"
        if "speaker permission denied" in lowered or "access denied" in lowered:
            return " (check voice_id/DOUBAO_SPEECH_VOICE_TYPE and voice authorization)"
        if "quota exceeded" in lowered:
            return " (check quota, concurrency, or remaining character package)"
        if "unsupported additions explicit language" in lowered:
            return " (do not pass additions.explicit_language for this endpoint)"
        return ""

    @staticmethod
    def _safe_error(exc: Exception, *, api_key: str | None = None, sensitive_url: str | None = None) -> str:
        """Redact profile secrets and signed audio URL query/fragment data."""
        secret = api_key or os.environ.get(DOUBAO_SPEECH_API_KEY_ENV, "")
        diagnostic = str(exc)
        if secret:
            diagnostic = diagnostic.replace(secret, "[redacted]")
        if sensitive_url:
            parsed = urlsplit(sensitive_url)
            safe_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
            diagnostic = diagnostic.replace(sensitive_url, safe_url)
        return diagnostic


__all__ = [
    "DEFAULT_RESOURCE_ID",
    "DOUBAO_SPEECH_API_KEY_ENV",
    "DOUBAO_SPEECH_VOICE_ENV",
    "DoubaoArtifact",
    "DoubaoConfigurationError",
    "DoubaoExecutionError",
    "DoubaoProfile",
    "DoubaoTTS",
    "QUERY_URL",
    "SUBMIT_URL",
]
