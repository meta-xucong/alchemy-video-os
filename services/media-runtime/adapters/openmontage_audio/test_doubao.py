import hashlib
import json
import os
import unittest
from unittest.mock import patch

from .doubao import (
    DEFAULT_RESOURCE_ID,
    DOUBAO_SPEECH_API_KEY_ENV,
    DOUBAO_SPEECH_VOICE_ENV,
    DoubaoConfigurationError,
    DoubaoExecutionError,
    DoubaoProfile,
    DoubaoTTS,
)


class _Response:
    def __init__(self, payload=None, *, content=b"", status_code=200, content_type=None):
        self._payload = payload
        self.content = content
        self.status_code = status_code
        self.headers = {"Content-Type": content_type} if content_type else {}

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _Transport:
    def __init__(self, audio=b"fixture-mp3", *, audio_url="https://audio.invalid/fixture.mp3", content_type="audio/mpeg"):
        self.audio = audio
        self.audio_url = audio_url
        self.content_type = content_type
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append(("post", url, kwargs))
        if url == DoubaoTTS.SUBMIT_URL:
            return _Response({"code": 20000000, "data": {"task_id": "task-fixture-01"}})
        return _Response({
            "code": 20000000,
            "data": {
                "task_status": 2,
                "audio_url": self.audio_url,
                "sentences": [{"text": "fixture", "start_time": 0}],
                "usage": {"text_words": 1},
            },
        })

    def get(self, url, **kwargs):
        self.calls.append(("get", url, kwargs))
        return _Response(content=self.audio, content_type=self.content_type)


class OpenMontageDoubaoAdapterTests(unittest.TestCase):
    def test_profile_requires_explicit_key_and_voice(self):
        with self.assertRaisesRegex(DoubaoConfigurationError, "API key"):
            DoubaoTTS.profile_from_environment({})

        with self.assertRaisesRegex(DoubaoConfigurationError, "voice_id"):
            DoubaoTTS.profile_from_environment({DOUBAO_SPEECH_API_KEY_ENV: "fixture-secret"})

        profile = DoubaoTTS.profile_from_environment(
            {
                DOUBAO_SPEECH_API_KEY_ENV: "fixture-secret",
                DOUBAO_SPEECH_VOICE_ENV: "zh_female_vv_uranus_bigtts",
            }
        )
        self.assertEqual(profile.voice_id, "zh_female_vv_uranus_bigtts")
        self.assertEqual(profile.resource_id, DEFAULT_RESOURCE_ID)

    def test_submit_request_preserves_openmontage_headers_and_body(self):
        profile = DoubaoProfile(
            api_key="fixture-secret",
            voice_id="zh_female_vv_uranus_bigtts",
        )
        url, headers, body = DoubaoTTS.build_submit_request(
            {
                "text": "你好，世界。",
                "format": "mp3",
                "sample_rate": 24000,
                "speech_rate": 0,
                "enable_timestamp": True,
                "disable_markdown_filter": False,
                "return_usage": True,
            },
            profile=profile,
            request_id="request-fixture-01",
        )

        self.assertEqual(url, "https://openspeech.bytedance.com/api/v3/tts/submit")
        self.assertEqual(headers["X-Api-Key"], "fixture-secret")
        self.assertEqual(headers["X-Api-Resource-Id"], DEFAULT_RESOURCE_ID)
        self.assertEqual(headers["X-Api-Request-Id"], "request-fixture-01")
        self.assertEqual(headers["X-Control-Require-Usage-Tokens-Return"], "true")
        self.assertEqual(body["user"], {"uid": "openmontage"})
        self.assertEqual(body["unique_id"], "request-fixture-01")
        self.assertEqual(body["req_params"]["speaker"], "zh_female_vv_uranus_bigtts")
        self.assertEqual(body["req_params"]["audio_params"], {
            "format": "mp3",
            "sample_rate": 24000,
            "speech_rate": 0,
            "enable_timestamp": True,
        })
        self.assertEqual(
            json.loads(body["req_params"]["additions"]),
            {"disable_markdown_filter": False},
        )

    def test_query_request_requires_explicit_profile_and_preserves_source_shape(self):
        with self.assertRaisesRegex(DoubaoConfigurationError, "explicit profile"):
            DoubaoTTS.build_query_request(
                profile=object(),
                request_id="request-fixture-02",
                task_id="task-fixture-01",
                return_usage=False,
            )

        profile = DoubaoProfile("fixture-secret", "zh_female_vv_uranus_bigtts")
        url, headers, body = DoubaoTTS.build_query_request(
            profile=profile,
            request_id="request-fixture-02",
            task_id="task-fixture-01",
            return_usage=False,
        )
        self.assertEqual(url, "https://openspeech.bytedance.com/api/v3/tts/query")
        self.assertEqual(body, {"task_id": "task-fixture-01"})
        self.assertNotIn("X-Control-Require-Usage-Tokens-Return", headers)
        self.assertEqual(headers["X-Api-Request-Id"], "request-fixture-02")

    def test_submit_input_voice_and_resource_override_profile_fallback(self):
        profile = DoubaoProfile("fixture-secret", "profile-voice", "profile-resource")
        _, headers, body = DoubaoTTS.build_submit_request(
            {"text": "fixture", "voice_id": "input-voice", "resource_id": "input-resource"},
            profile=profile,
            request_id="request-fixture-03",
        )
        self.assertEqual(headers["X-Api-Resource-Id"], "input-resource")
        self.assertEqual(body["req_params"]["speaker"], "input-voice")

        for key in ("voice_id", "resource_id"):
            with self.subTest(key=key):
                with self.assertRaisesRegex(DoubaoConfigurationError, f"{key} override"):
                    DoubaoTTS.build_submit_request(
                        {"text": "fixture", key: ""},
                        profile=profile,
                        request_id="request-fixture-04",
                    )
                with self.assertRaisesRegex(DoubaoConfigurationError, f"{key} override"):
                    DoubaoTTS.build_submit_request(
                        {"text": "fixture", key: 42},
                        profile=profile,
                        request_id="request-fixture-05",
                    )

    def test_error_and_secret_redaction_preserve_source_boundary(self):
        with self.assertRaisesRegex(RuntimeError, "speaker permission denied"):
            DoubaoTTS._raise_for_doubao_error(
                403,
                {"code": 40100002, "message": "speaker permission denied"},
            )

        with patch.dict(os.environ, {}, clear=True):
            diagnostic = DoubaoTTS._safe_error(
                RuntimeError("request failed fixture-secret"),
                api_key="fixture-secret",
            )
        self.assertNotIn("fixture-secret", diagnostic)
        self.assertIn("[redacted]", diagnostic)

    def test_execute_preserves_source_submit_poll_download_and_artifact_facts(self):
        transport = _Transport()
        sleeps = []
        probed = []
        profile = DoubaoProfile("fixture-secret", "profile-voice", "profile-resource")

        artifact = DoubaoTTS.execute(
            {
                "text": "你好，世界。",
                "voice_id": "input-voice",
                "resource_id": "input-resource",
                "format": "mp3",
                "sample_rate": 24000,
                "speech_rate": 0,
                "enable_timestamp": True,
                "disable_markdown_filter": False,
                "return_usage": True,
                "poll_interval_seconds": 0.5,
                "timeout_seconds": 30,
            },
            profile=profile,
            transport=transport,
            request_id="request-fixture-06",
            sleep_fn=sleeps.append,
            clock=lambda: 0.0,
            duration_probe=lambda path: (probed.append((path, path.read_bytes())) or 1.25),
        )

        self.assertEqual([call[0] for call in transport.calls], ["post", "post", "get"])
        submit = transport.calls[0]
        self.assertEqual(submit[1], DoubaoTTS.SUBMIT_URL)
        self.assertEqual(submit[2]["timeout"], (10, 60))
        self.assertEqual(submit[2]["headers"]["X-Api-Resource-Id"], "input-resource")
        self.assertEqual(submit[2]["headers"]["X-Api-Request-Id"], "request-fixture-06")
        self.assertEqual(submit[2]["json"]["req_params"]["speaker"], "input-voice")
        query = transport.calls[1]
        self.assertEqual(query[1], DoubaoTTS.QUERY_URL)
        self.assertEqual(query[2]["timeout"], (10, 60))
        self.assertEqual(query[2]["headers"]["X-Api-Resource-Id"], "input-resource")
        self.assertEqual(query[2]["json"], {"task_id": "task-fixture-01"})
        download = transport.calls[2]
        self.assertEqual(download[2]["timeout"], (10, 120))
        self.assertEqual(sleeps, [0.5])
        self.assertEqual(probed[0][1], b"fixture-mp3")
        self.assertEqual(probed[0][0].suffix, ".mp3")
        self.assertEqual(artifact.bytes, b"fixture-mp3")
        self.assertEqual(artifact.mime_type, "audio/mpeg")
        self.assertEqual(artifact.byte_size, len(b"fixture-mp3"))
        self.assertEqual(artifact.sha256, hashlib.sha256(b"fixture-mp3").hexdigest())
        self.assertEqual(artifact.task_id, "task-fixture-01")
        self.assertEqual(artifact.voice_id, "input-voice")
        self.assertEqual(artifact.resource_id, "input-resource")
        self.assertEqual(artifact.audio_duration_seconds, 1.25)
        self.assertEqual(artifact.sentences[0]["text"], "fixture")
        self.assertEqual(artifact.usage, {"text_words": 1})
        self.assertIn(b'"task_status": 2', artifact.metadata_bytes)

    def test_execute_rejects_invalid_source_input_before_transport(self):
        transport = _Transport()
        with self.assertRaisesRegex(DoubaoConfigurationError, "poll_interval_seconds"):
            DoubaoTTS.execute(
                {"text": "fixture", "poll_interval_seconds": 0.49},
                profile=DoubaoProfile("fixture-secret", "fixture-voice"),
                transport=transport,
            )
        self.assertEqual(transport.calls, [])

    def test_execute_allows_source_download_without_content_type(self):
        artifact = DoubaoTTS.execute(
            {"text": "fixture", "timeout_seconds": 30},
            profile=DoubaoProfile("fixture-secret", "fixture-voice"),
            transport=_Transport(content_type=None),
            sleep_fn=lambda _seconds: None,
            clock=lambda: 0.0,
            duration_probe=lambda _path: 1.0,
        )
        self.assertEqual(artifact.mime_type, "audio/mpeg")

    def test_execute_accepts_input_voice_without_environment_voice(self):
        with patch.dict(os.environ, {DOUBAO_SPEECH_API_KEY_ENV: "fixture-secret"}, clear=True):
            artifact = DoubaoTTS.execute(
                {"text": "fixture", "voice_id": "input-voice", "timeout_seconds": 30},
                transport=_Transport(),
                sleep_fn=lambda _seconds: None,
                clock=lambda: 0.0,
                duration_probe=lambda _path: 1.0,
            )
        self.assertEqual(artifact.voice_id, "input-voice")

    def test_execute_rejects_non_profile_before_transport(self):
        transport = _Transport()
        with self.assertRaisesRegex(DoubaoConfigurationError, "explicit profile"):
            DoubaoTTS.execute({"text": "fixture"}, profile=object(), transport=transport)
        self.assertEqual(transport.calls, [])

    def test_execute_rejects_poll_timeout(self):
        class PendingTransport(_Transport):
            def post(self, url, **kwargs):
                if url == DoubaoTTS.QUERY_URL:
                    self.calls.append(("post", url, kwargs))
                    return _Response({"code": 20000000, "data": {"task_status": 1}})
                return super().post(url, **kwargs)

        clock_values = iter((0.0, 0.0, 31.0))
        with self.assertRaisesRegex(DoubaoExecutionError, "did not finish"):
            DoubaoTTS.execute(
                {"text": "fixture", "timeout_seconds": 30},
                profile=DoubaoProfile("fixture-secret", "fixture-voice"),
                transport=PendingTransport(),
                sleep_fn=lambda _seconds: None,
                clock=lambda: next(clock_values),
            )

    def test_execute_rejects_invalid_submit_json(self):
        class InvalidJsonTransport(_Transport):
            def post(self, url, **kwargs):
                self.calls.append(("post", url, kwargs))
                return _Response(None)

        with self.assertRaisesRegex(DoubaoExecutionError, "Non-JSON"):
            DoubaoTTS.execute(
                {"text": "fixture"},
                profile=DoubaoProfile("fixture-secret", "fixture-voice"),
                transport=InvalidJsonTransport(),
            )

    def test_execute_redacts_signed_audio_url_query_and_fragment(self):
        signed_url = "https://audio.invalid/fixture.mp3?token=signed-secret#fragment"

        class FailingDownloadTransport(_Transport):
            def get(self, url, **kwargs):
                raise RuntimeError(f"GET failed for {url}")

        with self.assertRaises(DoubaoExecutionError) as raised:
            DoubaoTTS.execute(
                {"text": "fixture"},
                profile=DoubaoProfile("fixture-secret", "fixture-voice"),
                transport=FailingDownloadTransport(audio_url=signed_url),
                sleep_fn=lambda _seconds: None,
                clock=lambda: 0.0,
            )
        message = str(raised.exception)
        self.assertNotIn("signed-secret", message)
        self.assertNotIn("#fragment", message)
        self.assertIn("https://audio.invalid/fixture.mp3", message)


if __name__ == "__main__":
    unittest.main()
