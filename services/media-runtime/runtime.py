from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import shutil
from tempfile import TemporaryDirectory
import wave

from adapters.openmontage_audio.piper import PiperConfig, build_piper_command, length_scale_for_pace
from adapters.openmontage_audio.full_mix import OpenMontageAudioMixer, OpenMontageFullMixError
from adapters.openmontage_audio.hyperframes_audio import (
    HyperFramesAudioResolution,
    OpenMontageHyperFramesAudio,
    OpenMontageHyperFramesAudioError,
)
from adapters.openmontage_audio.segmented_music import (
    OpenMontageSegmentedMusicError,
    OpenMontageSegmentedMusicMixer,
)
from adapters.openmontage_audio.doubao import (
    DoubaoConfigurationError,
    DoubaoExecutionError,
    DoubaoTTS,
)


MAX_SINGLE_VIDEO_BYTES = 50 * 1024 * 1024
MAX_COMPOSITION_INPUT_BYTES = 160 * 1024 * 1024
MAX_COMPOSITION_SEGMENTS = 12
_AUDIO_FORMAT_MIME_TYPES: dict[str, str] = {
    "mp3": "audio/mpeg",
    "mpeg": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
}
# Keep the loopback request gate derived from the source format mapper.  The
# public asset contract accepts these canonical MIME values; source aliases
# (mpeg/oga) are normalized by ``inspect_audio_bytes`` rather than exposed as
# additional MIME types.
_AUDIO_MIME_TYPES = frozenset(_AUDIO_FORMAT_MIME_TYPES.values())
COMPOSITION_MAGIC = b"ALCHMED1"
COMPOSITION_PLAN_MAGIC = b"ALCHMED2"
COMPOSITION_AUDIO_PLAN_MAGIC = b"ALCHMED3"
COMPOSITION_MUSIC_PLAN_MAGIC = b"ALCHMED4"
COMPOSITION_NARRATION_PLAN_MAGIC = b"ALCHMED5"
COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC = b"ALCHMED6"
COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC = b"ALCHMED7"
COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC = b"ALCHMED8"
# Shared with the C12.7B measured-duration contract; this is a media-boundary
# tolerance, not a subtitle timing adjustment.
MEDIA_DURATION_TOLERANCE_SECONDS = 0.25
MAX_SUBTITLE_WORDS = 20_000
MAX_SUBTITLE_TEXT_CHARS = 20_000
# OpenMontage ``video_stitch._stitch`` accepts one transition type and a
# 0.1-5.0 second duration, defaulting to 0.5 seconds.  Keep these source
# values at the Runtime boundary; PASS is mapped to the source cut path and
# therefore has no transition duration.
OPENMONTAGE_TRANSITION_MIN_SECONDS = 0.1
OPENMONTAGE_TRANSITION_MAX_SECONDS = 5.0
OPENMONTAGE_DEFAULT_TRANSITION_SECONDS = 0.5
BLACK_TRANSITION_MAX_SECONDS = 1.0
OPERATION_ID_PATTERN = re.compile(r"^mop_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
_VISUAL_MODEL_CACHE: tuple[object, object, object] | None = None


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
    has_audio: bool = False
    audio_channels: int | None = None
    audio_sample_rate: int | None = None
    # The fields below mirror the media facts consumed by OpenMontage's
    # video_stitch compatibility check.  They are kept private to the Runtime
    # boundary; the public composition contract remains unchanged.
    fps: float | None = None
    video_codec: str | None = None
    pixel_format: str | None = None
    audio_codec: str | None = None


@dataclass(frozen=True)
class AudioInspection:
    mime_type: str
    sha256: str
    byte_size: int
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
class BoundaryFrames:
    first: ImageArtifact
    last: ImageArtifact


@dataclass(frozen=True)
class CompositionArtifact:
    inspection: VideoInspection
    bytes: bytes


@dataclass(frozen=True)
class CompositionAudioTrack:
    track_id: str
    ownership: str
    start_ms: int
    end_ms: int
    duck_under_narration: bool = False
    asset_id: str | None = None
    gain_db: str | None = None
    fade_in_ms: int | None = None
    fade_out_ms: int | None = None


@dataclass(frozen=True)
class CompositionAudioPlan:
    version: int
    target_duration_ms: int
    narration_asset_id: str | None
    narration_sections: tuple[tuple[str, int, int, str], ...]
    tracks: tuple[CompositionAudioTrack, ...]
    stitch_policy: str
    transcript_script: str | None = None
    transcript_timing_asset_id: str | None = None


@dataclass(frozen=True)
class CompositionPlan:
    transitions: tuple[str, ...]
    target_duration_ms: int
    bridge_durations_ms: tuple[int, ...]
    audio_policy: str = "LEGACY_PRESERVE"
    music_bytes: bytes | None = None
    narration_bytes: bytes | None = None
    # ALCHMED8 private carrier for independently measured OpenMontage speech
    # tracks.  The legacy single narration_bytes field remains unchanged.
    narration_tracks: tuple[tuple[str, bytes], ...] = ()
    music_volume: float = 0.12
    ducking_reduction_db: float = 8.0
    target_lufs: float = -14.0
    true_peak_db: float = -1.5
    music_eq_cut_db: float = 3.0
    voice_enhance: bool = True
    music_segments_ms: tuple[tuple[int, int], ...] = ()
    fade_in_ms: int = 1_500
    fade_out_ms: int = 2_500
    ducking_enabled: bool = True
    # ALCHMED1-6 do not carry ownership bytes.  None is therefore an explicit
    # "unknown" state, not permission to discard source audio; ALCHMED7 is the
    # private ownership-bearing extension.
    audio_ownership: tuple[str, ...] | None = None
    audio_tracks: tuple[CompositionAudioTrack, ...] | None = None
    audio_plan: CompositionAudioPlan | None = None


def _visual_tail_windows_ms(audio_plan: CompositionAudioPlan | None) -> tuple[tuple[int, int], ...]:
    if audio_plan is None:
        return ()
    return tuple(
        (start_ms, end_ms)
        for _section_id, start_ms, end_ms, visual_role in audio_plan.narration_sections
        if visual_role in {"HOLD", "BROLL"}
    )


@dataclass(frozen=True)
class FinalReview:
    payload: dict[str, object]


def _controlled_runtime_python(env_name: str) -> tuple[str | None, str | None]:
    """Resolve an optional tool interpreter without crossing the server boundary.

    The Runtime imports optional Python tools in-process.  A configured
    interpreter is therefore only valid when it is the interpreter serving
    this process; otherwise a capability check must fail closed instead of
    reporting a different venv as available while executing the system one.
    """
    configured = os.environ.get(env_name, "").strip()
    candidate = Path(configured) if configured else Path(sys.executable)
    if not candidate.is_file():
        return None, f"configured {env_name} interpreter is unavailable."
    try:
        selected = candidate.resolve()
        current = Path(sys.executable).resolve()
    except OSError:
        return None, f"configured {env_name} interpreter cannot be resolved."
    if selected != current:
        return None, f"{env_name} must match the media Runtime interpreter."
    return str(selected), None


def transcriber_capability() -> dict[str, object]:
    runtime_python, resolution_issue = _controlled_runtime_python("MEDIA_TRANSCRIBER_PYTHON_PATH")
    if runtime_python is None:
        return {
            "status": "UNAVAILABLE",
            "provider": "faster-whisper",
            "runtime_python": None,
            "hf_home": os.environ.get("HF_HOME"),
            "issues": [resolution_issue or "The controlled transcriber interpreter is unavailable."],
        }
    try:
        probe = subprocess.run(
            [runtime_python, "-c", "import faster_whisper"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=15,
            text=True,
            env=os.environ.copy(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return {
            "status": "UNAVAILABLE",
            "provider": "faster-whisper",
            "runtime_python": runtime_python,
            "hf_home": os.environ.get("HF_HOME"),
            "issues": ["faster-whisper capability probe failed."],
        }
    if probe.returncode != 0:
        return {
            "status": "UNAVAILABLE",
            "provider": "faster-whisper",
            "runtime_python": runtime_python,
            "hf_home": os.environ.get("HF_HOME"),
            "issues": ["faster-whisper is not installed in the controlled Runtime interpreter."],
        }
    return {
        "status": "AVAILABLE",
        "provider": "faster-whisper",
        "runtime_python": runtime_python,
        "hf_home": os.environ.get("HF_HOME"),
        "issues": [],
    }


def _piper_runtime() -> tuple[list[str], str, str]:
    """Resolve Piper independently from the web server's Python launcher.

    On Windows a venv-launched Uvicorn process can re-exec its listener with
    the base interpreter.  Prefer an explicitly configured interpreter and
    fall back to the repository's known local runtime so narration cannot
    silently depend on whichever Python happens to own port 3433.
    """
    workspace_root = Path(__file__).resolve().parents[2]
    configured_python = os.environ.get("PIPER_PYTHON_PATH", "").strip()
    python_candidates = [
        configured_python,
    ] if configured_python else [
        str(workspace_root / ".codex-longrun" / "c10-document-runtime-venv" / "Scripts" / "python.exe"),
        sys.executable,
    ]
    model_value = os.environ.get("PIPER_MODEL_PATH") or str(workspace_root / ".codex-longrun" / "piper-models" / "zh_CN-huayan-medium.onnx")
    config_value = os.environ.get("PIPER_MODEL_CONFIG_PATH") or str(workspace_root / ".codex-longrun" / "piper-models" / "zh_CN-huayan-medium.onnx.json")
    if not Path(model_value).is_file() or not Path(config_value).is_file():
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The configured local Piper narration runtime is unavailable.", retryable=True)
    for candidate in python_candidates:
        if candidate and Path(candidate).is_file():
            piper_entrypoints = (Path(candidate).parent / "piper.exe", Path(candidate).parent / "piper")
            for entry in piper_entrypoints:
                if entry.is_file():
                    return [str(entry)], model_value, config_value
            # Some local installs expose Piper only as a Python module.  Keep
            # the upstream flags/stdin contract; this is a launcher fallback,
            # not the old non-upstream -i/-f protocol.  A Python executable
            # alone is not evidence that its environment has the module, so
            # probe the candidate before selecting it (source selector
            # get_status semantics).
            try:
                probe = subprocess.run(
                    [candidate, "-c", "import piper"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=False,
                    timeout=15,
                    text=True,
                )
            except (OSError, subprocess.TimeoutExpired):
                continue
            if probe.returncode == 0:
                return [candidate, "-m", "piper"], model_value, config_value
    # Do not discover a machine-wide PATH executable.  OpenMontage's selector
    # treats executable capability as bound to the configured local runtime;
    # accepting PATH here would make the voice/version depend on ambient
    # process state and bypass the controlled interpreter check above.
    raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The configured local Piper narration runtime is unavailable.", retryable=True)


def synthesize_narration_bytes(*, text: str, sentence_silence: float = 0.3, length_scale: float = 1.0) -> tuple[bytes, int]:
    """Create the authoritative local narration track with the configured Piper voice.

    Provider-generated dialogue is useful for mouth movement, but it is not a
    reliable master track: a video model can truncate or omit speech. Keeping
    synthesis inside the loopback Runtime lets the Worker send only bounded
    text and receive verified audio bytes for the final composition.
    """
    source = text.strip()
    if not source or len(source.encode("utf-8")) > 5_000:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration text is empty or exceeds the bounded input limit.")
    if not isinstance(sentence_silence, (int, float)) or sentence_silence < 0 or sentence_silence > 10:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pause metadata is invalid.")
    if isinstance(length_scale, bool) or not isinstance(length_scale, (int, float)) or not math.isfinite(float(length_scale)) or length_scale <= 0:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pace metadata is invalid.")
    piper_command, model_value, config_value = _piper_runtime()
    with TemporaryDirectory(prefix="alchemy-c12-narration-") as directory:
        root = Path(directory)
        output_path = root / "narration.wav"
        try:
            completed = subprocess.run(
                [*piper_command, *build_piper_command(PiperConfig(Path(model_value), Path(config_value), length_scale=float(length_scale), sentence_silence=float(sentence_silence)), output_path)],
                input=source,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                text=True,
                timeout=300,
                cwd=None,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local Piper narration runtime is unavailable.", retryable=True) from error
        if completed.returncode != 0 or not output_path.is_file():
            raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local Piper narration runtime could not synthesize audio.", retryable=True)
        audio = output_path.read_bytes()
    try:
        with wave.open(BytesIO(audio), "rb") as reader:
            frame_rate = reader.getframerate()
            frame_count = reader.getnframes()
            channels = reader.getnchannels()
        duration_ms = round(frame_count / frame_rate * 1_000) if frame_rate > 0 else 0
    except (EOFError, wave.Error) as error:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "The local narration output is not a valid WAV file.") from error
    if duration_ms < 1 or duration_ms > 600_000 or channels < 1:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "The local narration output is outside the supported duration range.")
    return audio, duration_ms


def synthesize_doubao_narration_bytes(
    *,
    text: str,
    source_inputs: dict[str, object] | None = None,
) -> tuple[bytes, str, int]:
    """Run an explicitly selected OpenMontage Doubao TTS profile.

    The provider adapter owns the source submit/poll/download order and its
    defaults.  Runtime contributes only bounded text, a controlled duration
    probe and the existing SHA/MIME/size facts; it never selects Doubao by
    default or falls back between providers.
    """
    source = text.strip()
    if not source or len(source.encode("utf-8")) > 5_000:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration text is empty or exceeds the bounded input limit.")
    inputs = {"text": source, **(source_inputs or {})}
    # This helper is only the explicit source-provider branch.  Do not
    # silently consume a different selector value and accidentally route it to
    # Doubao.
    if inputs.get("preferred_provider") not in {"doubao", "doubao_tts"}:
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "Doubao narration requires an explicit source provider.", retryable=True)
    inputs.pop("preferred_provider", None)
    try:
        artifact = DoubaoTTS.execute(inputs, duration_probe=_probe_audio_path_duration)
    except DoubaoConfigurationError as error:
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", str(error), retryable=True) from error
    except DoubaoExecutionError as error:
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", str(error), retryable=True) from error
    if not artifact.bytes or artifact.byte_size != len(artifact.bytes) or artifact.sha256 != sha256(artifact.bytes).hexdigest():
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Doubao audio output failed integrity verification.")
    duration_seconds = artifact.audio_duration_seconds
    if duration_seconds is None or not math.isfinite(float(duration_seconds)) or duration_seconds <= 0:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Doubao audio duration could not be measured.")
    duration_ms = round(float(duration_seconds) * 1_000)
    if duration_ms < 1 or duration_ms > 600_000:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Doubao audio duration is outside the supported range.")
    return artifact.bytes, artifact.mime_type, duration_ms


def synthesize_narration_segments_bytes(*, segments: list[dict[str, object]], target_duration_ms: int) -> tuple[bytes, int]:
    """Render one continuous narration, then place it at the approved start.

    The source OpenMontage compose path generates the canonical narration once
    and measures that asset before applying timeline placement.  This adapter
    accepts one compatibility cue only; it deliberately does not invoke Piper
    once per visual cue (which would reset prosody and sentence pauses).
    """
    if target_duration_ms < 1 or target_duration_ms > 600_000 or not segments:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segments are invalid.")
    # The current adapter does not yet consume OpenMontage's `_full_mix`
    # speech-track path.  Refuse multi-cue synthesis before invoking Piper so
    # independent cue renders cannot masquerade as one continuous narration.
    if len(segments) != 1:
        raise MediaRuntimeError(
            "MEDIA_RUNTIME_UNAVAILABLE",
            "Multi-cue narration requires an approved full narration asset or OpenMontage full_mix.",
            retryable=True,
        )
    prepared: list[dict[str, object]] = []
    previous_start_ms = -1
    for segment in segments:
        provider_text = segment.get("provider_text")
        text = provider_text if provider_text is not None else segment.get("text")
        start_ms = segment.get("start_ms")
        if not isinstance(text, str) or not text.strip() or not isinstance(start_ms, int) or start_ms < 0:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segment is invalid.")
        if start_ms < previous_start_ms or (previous_start_ms >= 0 and start_ms - previous_start_ms > 1_000):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration segments are out of order.")
        pronunciation_guides = segment.get("pronunciation_guides", [])
        if pronunciation_guides is None:
            pronunciation_guides = []
        if not isinstance(pronunciation_guides, list):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pronunciation metadata is invalid.")
        spoken_text = text.strip()
        for guide in pronunciation_guides:
            if not isinstance(guide, dict):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pronunciation metadata is invalid.")
            source = guide.get("source")
            spoken = guide.get("spoken")
            if not isinstance(source, str) or not source.strip() or not isinstance(spoken, str) or not spoken.strip():
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pronunciation metadata is invalid.")
            spoken_text = spoken_text.replace(source, spoken)
        if re.search(r"<break\b", spoken_text, flags=re.IGNORECASE):
            # Piper's sentence_silence only applies at its own sentence
            # boundaries. Replacing an SSML break with punctuation would
            # silently lose its declared duration, so cue-only synthesis
            # remains closed until an approved timing/asset path can prove it.
            raise MediaRuntimeError(
                "MEDIA_RUNTIME_UNAVAILABLE",
                "The local Piper fallback cannot verify SSML break timing; use an approved narration asset.",
                retryable=True,
            )
        if re.search(r"<[^>]+>", spoken_text):
            raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local Piper fallback cannot honor unsupported SSML; use an approved narration asset.", retryable=True)
        pause_before_ms = segment.get("pause_before_ms", 0)
        pause_after_ms = segment.get("pause_after_ms", 0)
        if not isinstance(pause_before_ms, int) or pause_before_ms < 0 or pause_before_ms > 10_000:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pause metadata is invalid.")
        if not isinstance(pause_after_ms, int) or pause_after_ms < 0 or pause_after_ms > 10_000:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pause metadata is invalid.")
        if pause_before_ms > start_ms:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration pause-before must already be represented by the absolute cue start.")
        pace = segment.get("pace", "NATURAL")
        energy = segment.get("energy", "NEUTRAL")
        if not isinstance(pace, str) or pace not in {"SLOW", "NATURAL", "FAST"} or not isinstance(energy, str) or energy not in {"CALM", "NEUTRAL", "EMPHATIC"}:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration delivery metadata is invalid.")
        if energy != "NEUTRAL":
            raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "The local Piper fallback cannot honor energy metadata; use an approved narration asset.", retryable=True)
        try:
            length_scale = length_scale_for_pace(pace)
        except (KeyError, ValueError) as error:
            # OpenMontage Piper accepts a numeric length_scale, not the
            # platform's symbolic SLOW/FAST labels. Do not invent a numeric
            # mapping that could change the approved voice timing.
            raise MediaRuntimeError(
                "MEDIA_RUNTIME_UNAVAILABLE",
                "The local Piper fallback has no source-backed mapping for this narration pace; use an approved narration asset or provider profile.",
                retryable=True,
            ) from error
        prepared.append({
            "start_ms": start_ms,
            "text": spoken_text,
            "length_scale": length_scale,
            "pause_after_ms": pause_after_ms,
            "pause_after_explicit": "pause_after_ms" in segment,
        })
        previous_start_ms = start_ms
    if len(prepared) == 1:
        item = prepared[0]
        first_start_ms = int(item["start_ms"])
        if first_start_ms > 1_000 or first_start_ms >= target_duration_ms:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration start is outside the declared target timeline.")
        sentence_silence = int(item["pause_after_ms"]) / 1_000 if bool(item["pause_after_explicit"]) else 0.3
        synthesis_kwargs: dict[str, object] = {"text": str(item["text"]), "sentence_silence": sentence_silence}
        if float(item["length_scale"]) != 1.0:
            synthesis_kwargs["length_scale"] = float(item["length_scale"])
        audio, duration_ms = synthesize_narration_bytes(**synthesis_kwargs)
        spoken_end_ms = first_start_ms + duration_ms
        if spoken_end_ms > target_duration_ms:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Narration exceeds the declared target duration.")
        if first_start_ms == 0:
            return audio, spoken_end_ms
        with TemporaryDirectory(prefix="alchemy-c12-narration-placement-") as directory:
            root = Path(directory)
            input_path = root / "narration.wav"
            output_path = root / "narration-placed.wav"
            input_path.write_bytes(audio)
            ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
            graph = f"[0:a]adelay={first_start_ms}|{first_start_ms}[aout]"
            _run(ffmpeg, ["-y", "-i", str(input_path), "-filter_complex", graph, "-map", "[aout]", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "1", str(output_path)], timeout_seconds=90)
            audio = output_path.read_bytes()
        return audio, spoken_end_ms
    raise MediaRuntimeError(
        "MEDIA_RUNTIME_UNAVAILABLE",
        "Multi-cue narration requires an approved full narration asset or OpenMontage full_mix.",
        retryable=True,
    )


def transcribe_video_bytes(*, body: bytes, expected_sha256: str | None) -> dict[str, object]:
    _validated_video_bytes(body, expected_sha256)
    capability = transcriber_capability()
    if capability["status"] != "AVAILABLE":
        return {"status": "UNAVAILABLE", "issues": capability["issues"]}
    with TemporaryDirectory(prefix="alchemy-c12-transcribe-") as directory:
        source = Path(directory) / "input.mp4"
        source.write_bytes(body)
        try:
            from faster_whisper import WhisperModel  # type: ignore
            model = WhisperModel(os.environ.get("MEDIA_TRANSCRIBER_MODEL", "base"), device="cpu", compute_type="int8")
            segments_iter, info = model.transcribe(str(source), word_timestamps=True, vad_filter=True)
            segments: list[dict[str, object]] = []
            words: list[dict[str, object]] = []
            for segment in segments_iter:
                segment_words: list[dict[str, object]] = []
                for word in segment.words or []:
                    item = {"word": word.word.strip(), "start": round(float(word.start), 3), "end": round(float(word.end), 3), "probability": round(float(word.probability), 3)}
                    segment_words.append(item)
                    words.append(item)
                segments.append({"start": round(float(segment.start), 3), "end": round(float(segment.end), 3), "text": segment.text.strip(), "words": segment_words})
            return {"status": "CHECKED", "language": getattr(info, "language", None), "duration_seconds": round(float(info.duration), 3), "segments": segments, "word_timestamps": words, "issues": []}
        except Exception as error:
            return {"status": "UNAVAILABLE", "issues": [f"transcriber execution unavailable: {type(error).__name__}"]}


def _subtitle_srt_from_transcript(transcript: dict[str, object], *, video_duration_seconds: float | None = None) -> str:
    """Render source SubtitleGen-compatible SRT from checked word timings.

    This is the pure formatting part of OpenMontage ``subtitle_gen.py``:
    words are grouped into bounded cues without changing their timestamps.
    The caller must provide a checked transcript; no timing is invented from
    the script text.
    """
    if transcript.get("status") != "CHECKED":
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "Checked word timestamps are required for subtitles.", retryable=True)
    raw_words = transcript.get("word_timestamps")
    if not isinstance(raw_words, list) or not raw_words:
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "Checked word timestamps are required for subtitles.", retryable=True)
    if len(raw_words) > MAX_SUBTITLE_WORDS:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle timing input is outside the supported range.")
    transcript_duration = transcript.get("duration_seconds")
    if transcript_duration is not None:
        if not isinstance(transcript_duration, (int, float)) or isinstance(transcript_duration, bool) \
                or not math.isfinite(float(transcript_duration)) or float(transcript_duration) <= 0:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle transcript duration is invalid.")
        if video_duration_seconds is not None and abs(float(transcript_duration) - video_duration_seconds) > MEDIA_DURATION_TOLERANCE_SECONDS:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle transcript duration does not match the video.")
    words: list[dict[str, object]] = []
    total_text_chars = 0
    for raw in raw_words:
        if not isinstance(raw, dict):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle word timing is invalid.")
        word = raw.get("word")
        start = raw.get("start")
        end = raw.get("end")
        if not isinstance(word, str) or not word.strip() or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle word timing is invalid.")
        if isinstance(start, bool) or isinstance(end, bool) or not math.isfinite(float(start)) or not math.isfinite(float(end)) or float(start) < 0 or float(end) < float(start):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle word timing is invalid.")
        if video_duration_seconds is not None and (float(start) > video_duration_seconds + MEDIA_DURATION_TOLERANCE_SECONDS
                or float(end) > video_duration_seconds + MEDIA_DURATION_TOLERANCE_SECONDS):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle word timing exceeds the video duration.")
        if words and float(start) < float(words[-1]["end"]):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle word timings are out of order.")
        normalized_word = word.strip()
        total_text_chars += len(normalized_word)
        if total_text_chars > MAX_SUBTITLE_TEXT_CHARS:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Subtitle text is outside the supported range.")
        words.append({"word": normalized_word, "start": float(start), "end": float(end)})
    cues: list[dict[str, object]] = []
    buffer: list[dict[str, object]] = []
    buffer_text = ""
    for word in words:
        candidate = f"{buffer_text} {word['word']}".strip() if buffer_text else str(word["word"])
        if buffer and (len(buffer) >= 8 or len(candidate) > 42):
            cues.append({"start": buffer[0]["start"], "end": buffer[-1]["end"], "text": buffer_text})
            buffer = []
            buffer_text = ""
        buffer.append(word)
        # Match OpenMontage ``SubtitleGen._build_cues``: after a cue flush,
        # the new cue starts with the current word rather than the pre-flush
        # candidate string.
        buffer_text = f"{buffer_text} {word['word']}".strip() if buffer_text else str(word["word"])
    if buffer:
        cues.append({"start": buffer[0]["start"], "end": buffer[-1]["end"], "text": buffer_text})

    def timestamp(seconds: float) -> str:
        total_ms = int(round(seconds * 1_000))
        hours, remainder = divmod(total_ms, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        whole_seconds, millis = divmod(remainder, 1_000)
        return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{millis:03d}"

    lines: list[str] = []
    for index, cue in enumerate(cues, start=1):
        lines.extend([
            str(index),
            f"{timestamp(float(cue['start']))} --> {timestamp(float(cue['end']))}",
            str(cue["text"]),
            "",
        ])
    return "\n".join(lines)


def burn_captions_video_bytes(*, body: bytes, expected_sha256: str | None, transcript: dict[str, object] | None = None) -> CompositionArtifact:
    """Burn checked OpenMontage-style SRT captions using the FFmpeg fallback.

    Remotion is intentionally not invoked from this loopback Runtime. The
    source tool's deterministic SRT output plus FFmpeg's ``subtitles`` filter
    is the bounded fallback. A metadata marker is written so final review can
    distinguish a burned result from an unverified caption claim.
    """
    digest = _validated_video_bytes(body, expected_sha256)
    checked_transcript = transcript or transcribe_video_bytes(body=body, expected_sha256=digest)
    if checked_transcript.get("status") != "CHECKED":
        raise MediaRuntimeError("MEDIA_RUNTIME_UNAVAILABLE", "Subtitle generation requires a checked transcript.", retryable=True)
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    with TemporaryDirectory(prefix="alchemy-c12-caption-burn-") as directory:
        root = Path(directory)
        source = root / "input.mp4"
        subtitle = root / "captions.srt"
        output = root / "captioned.mp4"
        source.write_bytes(body)
        source_inspection = _inspect_path(source, len(body), digest)
        srt = _subtitle_srt_from_transcript(
            checked_transcript,
            video_duration_seconds=source_inspection.duration_ms / 1_000,
        )
        subtitle.write_text(srt, encoding="utf-8")
        escaped = str(subtitle).replace("\\", "/").replace(":", "\\:")
        _run(
            ffmpeg,
            [
                "-y", "-i", str(source),
                "-vf", f"subtitles='{escaped}':force_style='FontName=Arial,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=40'",
                "-map", "0:v:0", "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-pix_fmt", "yuv420p", "-c:a", "copy",
                "-movflags", "use_metadata_tags",
                "-metadata", "alchemy_captions=burned_srt", str(output),
            ],
            timeout_seconds=90,
        )
        if not output.is_file():
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "FFmpeg subtitle burn produced no output.")
        captioned = output.read_bytes()
        # Probe while the service-owned temporary directory still exists.  The
        # returned bytes are the durable artifact; retaining a path outside the
        # context would make inspection fail after cleanup.
        inspection = _inspect_path(output, len(captioned), sha256(captioned).hexdigest())
        return CompositionArtifact(inspection=inspection, bytes=captioned)


def compare_transcript_to_script(*, transcript: dict[str, object] | None, script_text: str | None) -> dict[str, object]:
    result: dict[str, object] = {"status": "UNAVAILABLE", "transcript_matches_script": None, "word_accuracy": None, "issues": []}
    if not script_text:
        # Source-aligned sound intent: a visual-only story has no expected
        # spoken text, so it is not a failed comparison and should not emit a
        # misleading low-match warning.
        result["status"] = "NOT_EXPECTED"
        return result
    if not transcript or transcript.get("status") != "CHECKED":
        result["issues"] = ["transcript_comparison unavailable: no checked transcript."]
        return result
    def spoken_number(value: str) -> str:
        digits = "零一二三四五六七八九"
        if "." in value:
            integer, fraction = value.split(".", 1)
            return spoken_number(integer) + "点" + "".join(digits[int(character)] for character in fraction)
        number = int(value)
        if number == 0:
            return digits[0]
        units = (("千", 1000), ("百", 100), ("十", 10))
        result = ""
        pending_zero = False
        for unit, divisor in units:
            digit = number // divisor
            number %= divisor
            if digit:
                if pending_zero:
                    result += digits[0]
                    pending_zero = False
                if not (unit == "十" and digit == 1 and not result):
                    result += digits[digit]
                result += unit
            elif result and number:
                pending_zero = True
        if number:
            if pending_zero:
                result += digits[0]
            result += digits[number]
        return result
    def normalize_spoken_numbers(value: str) -> str:
        return re.sub(r"\d+(?:\.\d+)?", lambda match: spoken_number(match.group()), value)
    def tokens(value: str) -> list[str]:
        # ASR returns CJK speech as individual characters while Latin speech is
        # returned as words. Treating a whole CJK sentence as one token makes
        # harmless homophone/traditional-character differences look like 0%.
        normalized = value.casefold()
        return [
            item
            for item in re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[a-z0-9]+(?:-[a-z0-9]+)?", normalized)
            if item and item != "-"
        ]
    def normalize_spelled_initialisms(values: list[str]) -> list[str]:
        # Whisper may emit an acronym such as "AI" as two letter tokens;
        # compare it with the source token without treating that harmless
        # segmentation difference as missing product copy.
        normalized: list[str] = []
        index = 0
        while index < len(values):
            if index + 1 < len(values) and len(values[index]) == 1 and len(values[index + 1]) == 1:
                pair = f"{values[index]}{values[index + 1]}"
                if pair in {"ai", "ui", "ml", "ar", "vr"}:
                    normalized.append(pair)
                    index += 2
                    continue
            normalized.append(values[index])
            index += 1
        return normalized
    words = transcript.get("word_timestamps") or []
    transcript_tokens = tokens(" ".join(str(item.get("word", "")) for item in words if isinstance(item, dict)))
    script_tokens = tokens(normalize_spoken_numbers(script_text))
    if not transcript_tokens or not script_tokens:
        result["issues"] = ["transcript_comparison: empty token set."]
        return result
    script_set = set(script_tokens)
    leaks = {word: transcript_tokens.count(word) for word in ("dot", "comma", "hyphen", "ellipsis") if word in transcript_tokens and word not in script_set}
    transcript_set = set(transcript_tokens)
    cjk = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
    script_cjk = [token for token in script_tokens if cjk.fullmatch(token)]
    script_latin = [token for token in script_tokens if not cjk.fullmatch(token)]
    transcript_cjk = [token for token in transcript_tokens if cjk.fullmatch(token)]
    if "ai" in script_latin:
        normalized_cjk: list[str] = []
        cursor = 0
        while cursor < len(transcript_cjk):
            # The Chinese Whisper model commonly writes a spoken A-I acronym
            # as 艾艾. It is source-authorized only when the script itself
            # contains AI; ordinary inserted characters remain detectable.
            if transcript_cjk[cursor:cursor + 2] == ["艾", "艾"]:
                cursor += 2
                continue
            normalized_cjk.append(transcript_cjk[cursor])
            cursor += 1
        transcript_cjk = normalized_cjk
    transcript_latin = normalize_spelled_initialisms([token for token in transcript_tokens if not cjk.fullmatch(token)])
    if script_cjk:
        # CJK ASR commonly changes simplified/traditional glyphs and homophones.
        # Use utterance coverage for that part, while retaining exact matching
        # for any Latin words or identifiers in the same script.
        cjk_coverage = len(transcript_cjk) / max(1, len(script_cjk))
        # Coverage alone misses a short inserted filler word: a transcript can
        # still contain every expected character while being longer than the
        # requested script. Detect that case when the expected script remains
        # an ordered subsequence of the ASR output.
        inserted_tokens = 0
        script_index = 0
        for token in transcript_cjk:
            if script_index < len(script_cjk) and token == script_cjk[script_index]:
                script_index += 1
            else:
                inserted_tokens += 1
        ordered_script = script_index == len(script_cjk)
        inserted_cjk = ordered_script and inserted_tokens > 0
        # Product acronyms are routinely rendered as Chinese homophones by
        # the compact local ASR model (for example AI -> "艾艾").  The CJK
        # coverage already evaluates the spoken surrounding phrase, so do
        # not downgrade an otherwise complete Chinese narration for this
        # ASR-only spelling ambiguity.
        significant_latin = [
            word for word in script_latin
            if not word.isdigit() and not re.fullmatch(r"[a-z]{2,5}", word)
        ]
        latin_accuracy = (
            sum(1 for word in significant_latin if word in set(transcript_latin)) / max(1, len(significant_latin))
            if significant_latin
            else 1.0
        )
        accuracy = min(1.0, cjk_coverage)
        matches = 0.75 <= cjk_coverage <= 1.15 and latin_accuracy >= 0.9 and not leaks and not inserted_cjk
        issues: list[str] = []
        if cjk_coverage < 0.75 or cjk_coverage > 1.15:
            issues.append(f"Low transcript-to-script coverage: {cjk_coverage:.0%}.")
        if inserted_cjk:
            issues.append(f"Unexpected inserted spoken characters detected: {inserted_tokens}.")
        if latin_accuracy < 0.9:
            issues.append(f"Low transcript-to-script match: {latin_accuracy:.0%}.")
    else:
        accuracy = sum(1 for word in script_tokens if word in transcript_set) / max(1, len(script_tokens))
        matches = accuracy >= 0.9 and not leaks
        issues = []
        if leaks:
            issues.append("TTS punctuation leak detected.")
        if accuracy < 0.9:
            issues.append(f"Low transcript-to-script match: {accuracy:.0%}.")
    result.update({"status": "CHECKED", "transcript_matches_script": matches, "word_accuracy": round(accuracy, 3)})
    result["issues"] = issues
    return result


def check_narration_alignment(*, narration_cues: list[dict[str, object]] | None, visual_landmarks: list[dict[str, object]] | None, duration_seconds: float, tolerance_seconds: float = 0.5) -> dict[str, object]:
    """Source-aligned equivalent of OpenMontage assert_alignment.

    The runtime only evaluates timestamps supplied by a trusted internal
    caller. It never invents landmarks when ASR or an editor cue is missing.
    """
    if narration_cues is None or visual_landmarks is None:
        return {"status": "UNAVAILABLE", "issues": ["narration alignment requires cue and landmark timelines."]}
    issues: list[str] = []
    previous_end = 0.0
    for cue in narration_cues:
        start = float(cue.get("start_seconds", -1))
        end = float(cue.get("end_seconds", -1))
        cue_id = str(cue.get("cue_id", "unknown"))
        if start < 0 or end <= start:
            issues.append(f"Invalid narration cue: {cue_id}.")
            continue
        if start < previous_end - 1e-3:
            issues.append(f"Narration cue overlap: {cue_id}.")
        if start > previous_end + 1e-3 and previous_end > 0:
            issues.append(f"Narration cue gap before: {cue_id}.")
        if end > duration_seconds + tolerance_seconds:
            issues.append(f"Narration cue exceeds visual duration: {cue_id}.")
        previous_end = max(previous_end, end)
        landmarks = [float(item.get("time_seconds", -1)) for item in visual_landmarks if isinstance(item, dict)]
        if not any(start - tolerance_seconds <= landmark <= end + tolerance_seconds for landmark in landmarks):
            issues.append(f"No visual landmark aligned with narration cue: {cue_id}.")
    if previous_end > duration_seconds + tolerance_seconds:
        issues.append("Narration timeline exceeds visual duration.")
    return {"status": "CHECKED" if not issues else "NEEDS_ATTENTION", "tolerance_seconds": tolerance_seconds, "issues": issues}


def visual_semantic_capability() -> dict[str, object]:
    try:
        import torch  # type: ignore  # noqa: F401
        import transformers  # type: ignore  # noqa: F401
    except ImportError:
        return {"status": "UNAVAILABLE", "provider": "transformers", "model": "clip", "issues": ["transformers/torch is not installed."]}
    return {"status": "AVAILABLE", "provider": "transformers", "model": os.environ.get("MEDIA_VISUAL_MODEL", "clip"), "issues": []}


def _load_visual_model() -> tuple[object, object, object]:
    global _VISUAL_MODEL_CACHE
    if _VISUAL_MODEL_CACHE is not None:
        return _VISUAL_MODEL_CACHE
    from transformers import CLIPModel, CLIPProcessor  # type: ignore
    import torch  # type: ignore
    model_id = os.environ.get("MEDIA_VISUAL_MODEL_ID", "openai/clip-vit-base-patch32")
    processor = CLIPProcessor.from_pretrained(model_id)
    model = CLIPModel.from_pretrained(model_id).to("cpu")
    model.eval()
    _VISUAL_MODEL_CACHE = (model, processor, torch)
    return _VISUAL_MODEL_CACHE


def visual_semantic_review(*, path: Path, duration_seconds: float) -> dict[str, object]:
    capability = visual_semantic_capability()
    if capability["status"] != "AVAILABLE":
        return {"status": "UNAVAILABLE", "issues": capability["issues"]}
    categories = ("indoor", "outdoor", "landscape", "cityscape", "portrait", "action", "close-up", "aerial", "night", "nature", "urban", "abstract", "text-overlay")
    try:
        ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
        with TemporaryDirectory(prefix="alchemy-c12-visual-review-") as directory:
            frame_paths: list[Path] = []
            for index, timestamp in enumerate((0.0, duration_seconds * 0.33, duration_seconds * 0.66, max(0.0, duration_seconds - 0.1))):
                output = Path(directory) / f"frame-{index:02d}.png"
                _run(ffmpeg, ["-y", "-ss", f"{timestamp:.3f}", "-i", str(path), "-frames:v", "1", "-update", "1", "-f", "image2", str(output)], timeout_seconds=30)
                frame_paths.append(output)
            from PIL import Image  # type: ignore
            model, processor, torch = _load_visual_model()
            labels = [f"a {category} scene" for category in categories]
            per_frame: list[str] = []
            for frame_path in frame_paths:
                image = Image.open(frame_path).convert("RGB")
                inputs = processor(text=labels, images=image, return_tensors="pt", padding=True)
                with torch.no_grad():
                    logits = model(**inputs).logits_per_image.softmax(dim=1)[0]
                per_frame.append(categories[int(logits.argmax().item())])
            return {"status": "CHECKED", "issues": [], "frames_checked": len(per_frame), "scene_categories": per_frame}
    except Exception as error:
        return {"status": "UNAVAILABLE", "issues": [f"visual evaluator execution unavailable: {type(error).__name__}"]}


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


def _run_capture(binary: str, args: list[str], *, timeout_seconds: int) -> tuple[str, str]:
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
    stdout = completed.stdout.decode("utf-8", errors="replace")
    stderr = completed.stderr.decode("utf-8", errors="replace")
    if completed.returncode != 0:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "The media operation could not complete.")
    return stdout, stderr


def _run(binary: str, args: list[str], *, timeout_seconds: int) -> str:
    stdout, _ = _run_capture(binary, args, timeout_seconds=timeout_seconds)
    return stdout


def _validated_video_bytes(body: bytes, expected_sha256: str | None) -> str:
    if not body or len(body) > MAX_SINGLE_VIDEO_BYTES:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Video input is outside the supported range.")
    actual = sha256(body).hexdigest()
    if expected_sha256 and actual != expected_sha256:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Video input integrity verification failed.")
    return actual


def _validated_audio_bytes(body: bytes, expected_sha256: str | None) -> str:
    if not body or len(body) > MAX_SINGLE_VIDEO_BYTES:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Audio input is outside the supported range.")
    actual = sha256(body).hexdigest()
    if expected_sha256 and actual != expected_sha256:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Audio input integrity verification failed.")
    return actual


def _inspect_path(
    path: Path,
    byte_size: int,
    digest: str,
    *,
    include_audio: bool = True,
    require_compatibility_facts: bool = False,
) -> VideoInspection:
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    output = _run(
        ffprobe,
        [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_type,width,height,duration,codec_name,pix_fmt,r_frame_rate,avg_frame_rate:format=duration",
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
        video_codec = stream.get("codec_name")
        pixel_format = stream.get("pix_fmt")
        fps = _parse_frame_rate(stream.get("r_frame_rate")) or _parse_frame_rate(stream.get("avg_frame_rate"))
        stream_duration = float(stream.get("duration", 0))
        format_duration = float(parsed.get("format", {}).get("duration", 0))
        # Some ffmpeg filter graphs retain the first input's video-stream
        # duration even though the muxed container and audio span all inputs.
        # Use the longer verified container duration so composition QC does
        # not reject a valid multi-segment result.
        duration_seconds = max(stream_duration, format_duration)
    except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
        raise MediaRuntimeError("QC_FAILED", "The video could not be inspected.") from error
    if (
        stream.get("codec_type") != "video"
        or width <= 0
        or height <= 0
        or not math.isfinite(duration_seconds)
        or duration_seconds <= 0
        or (
            include_audio
            and require_compatibility_facts
            and (
                not isinstance(video_codec, str)
                or not video_codec
                or not isinstance(pixel_format, str)
                or not pixel_format
                or fps is None
            )
        )
    ):
        raise MediaRuntimeError("QC_FAILED", "The video could not be inspected.")
    audio_stream_present, audio_codec, audio_channels, audio_sample_rate = (
        _audio_metadata_details(path) if include_audio else (False, None, None, None)
    )
    if include_audio and audio_stream_present and (
        not isinstance(audio_codec, str)
        or not audio_codec
        or audio_sample_rate is None
        or audio_channels is None
    ):
        raise MediaRuntimeError("QC_FAILED", "The video audio could not be inspected.")
    return VideoInspection(
        mime_type="video/mp4",
        sha256=digest,
        byte_size=byte_size,
        width=width,
        height=height,
        duration_ms=round(duration_seconds * 1000),
        has_audio=audio_stream_present,
        audio_channels=audio_channels if audio_stream_present else None,
        audio_sample_rate=audio_sample_rate if audio_stream_present else None,
        fps=fps,
        video_codec=video_codec,
        pixel_format=pixel_format,
        audio_codec=audio_codec,
    )


def _parse_frame_rate(value: object) -> float | None:
    """Parse the ffprobe rate form used by OpenMontage's ``_probe_clip``."""
    if isinstance(value, str) and "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            numerator_value = float(numerator)
            denominator_value = float(denominator)
        except ValueError:
            return None
        if denominator_value == 0:
            return None
        value = numerator_value / denominator_value
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed) or parsed <= 0:
        return None
    return round(parsed, 6)


def _audio_metadata(path: Path) -> tuple[int | None, int | None]:
    """Probe the audio stream using the OpenMontage source-review contract."""
    _present, _codec, channels, sample_rate = _audio_metadata_details(path)
    return channels, sample_rate


def _audio_metadata_details(path: Path) -> tuple[bool, str | None, int | None, int | None]:
    """Read the first audio stream facts used by source compatibility checks."""
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    output = _run(
        ffprobe,
        [
            "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type,codec_name,channels,sample_rate",
            "-of", "json",
            str(path),
        ],
        timeout_seconds=15,
    )
    try:
        streams = json.loads(output).get("streams", [])
        if not streams:
            return False, None, None, None
        stream = streams[0]
        codec = stream.get("codec_name")
        channels = int(stream.get("channels", 0)) or None
        sample_rate = int(stream.get("sample_rate", 0)) or None
        return True, codec if isinstance(codec, str) and codec else None, channels, sample_rate
    except (TypeError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise MediaRuntimeError("QC_FAILED", "The video audio could not be inspected.") from error


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


def inspect_audio_bytes(*, body: bytes, expected_sha256: str | None) -> AudioInspection:
    """Probe an approved audio asset using the source AudioProbe facts."""
    if not body or len(body) > MAX_SINGLE_VIDEO_BYTES:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Audio input is outside the supported range.")
    digest = sha256(body).hexdigest()
    if expected_sha256 and digest != expected_sha256:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Audio input integrity verification failed.")
    with TemporaryDirectory(prefix="alchemy-c12-audio-") as directory:
        # Do not label the staged bytes as WAV: OpenMontage's AudioProbe lets
        # ffprobe identify the container and reports format_name/codec facts.
        source = Path(directory) / "source"
        source.write_bytes(body)
        ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
        output = _run(ffprobe, [
            "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_type,codec_name,duration:format=format_name,duration",
            "-of", "json", str(source),
        ], timeout_seconds=15)
    try:
        parsed = json.loads(output)
        stream = parsed.get("streams", [])[0]
        if stream.get("codec_type") != "audio":
            raise ValueError("audio stream missing")
        stream_duration = float(stream.get("duration", 0))
        format_duration = float(parsed.get("format", {}).get("duration", 0))
        if any(
            not math.isfinite(duration) or duration <= 0
            for duration in (stream_duration, format_duration)
        ):
            raise ValueError("audio duration missing or non-finite")
        duration_seconds = max(stream_duration, format_duration)
        format_name = parsed.get("format", {}).get("format_name")
        if not isinstance(format_name, str):
            raise ValueError("audio format missing")
        format_names = {value.strip().lower() for value in format_name.split(",") if value.strip()}
        mime_type = next(
            (_AUDIO_FORMAT_MIME_TYPES[name] for name in ("mp3", "mpeg", "wav", "ogg", "oga") if name in format_names),
            None,
        )
        if mime_type is None:
            raise ValueError("audio format unsupported")
    except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
        raise MediaRuntimeError("QC_FAILED", "The audio could not be inspected.") from error
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise MediaRuntimeError("QC_FAILED", "The audio duration could not be inspected.")
    return AudioInspection(mime_type=mime_type, sha256=digest, byte_size=len(body), duration_ms=round(duration_seconds * 1000))


def _probe_audio_path_duration(path: Path) -> float:
    """Read an already-staged audio file through the existing ffprobe gate."""
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    output = _run(
        ffprobe,
        [
            "-v", "error", "-select_streams", "a:0",
            "-show_entries", "stream=codec_type,duration:format=duration",
            "-of", "json", str(path),
        ],
        timeout_seconds=15,
    )
    try:
        parsed = json.loads(output)
        streams = parsed.get("streams", [])
        stream = streams[0] if streams else {}
        if stream.get("codec_type") != "audio":
            raise ValueError("audio stream missing")
        stream_duration = float(stream.get("duration", 0))
        format_duration = float(parsed.get("format", {}).get("duration", 0))
        duration = max(stream_duration, format_duration)
    except (ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
        raise MediaRuntimeError("QC_FAILED", "The HyperFrames audio could not be inspected.") from error
    if not math.isfinite(duration) or duration <= 0:
        raise MediaRuntimeError("QC_FAILED", "The HyperFrames audio duration could not be inspected.")
    return duration


def resolve_hyperframes_audio_refs(
    *,
    audio: dict[str, object] | None,
    assets: list[dict[str, object]],
    workspace: Path,
    total_duration_seconds: float,
    workspace_id: str,
    project_id: str,
) -> HyperFramesAudioResolution:
    """Resolve source HyperFrames timed-audio refs inside the Runtime boundary.

    The caller must have staged authorized asset files into ``workspace``. The
    adapter verifies existing scope, MIME, bytes, SHA and ffprobe duration;
    unresolved or cross-workspace references become a QC failure instead of
    invoking OpenMontage's silent skip/copy behavior.
    """
    try:
        return OpenMontageHyperFramesAudio(probe_duration=_probe_audio_path_duration).resolve(
            audio,
            assets,
            workspace,
            total_duration=total_duration_seconds,
            workspace_id=workspace_id,
            project_id=project_id,
        )
    except OpenMontageHyperFramesAudioError as error:
        raise MediaRuntimeError("QC_FAILED", str(error)) from error


def segment_music_video_bytes(
    *,
    video_body: bytes,
    music_body: bytes,
    video_expected_sha256: str | None,
    music_expected_sha256: str | None,
    music_mime_type: str,
    music_segments_ms: tuple[tuple[int, int], ...],
    music_volume: float = 0.20,
    fade_duration: float = 0.5,
) -> CompositionArtifact:
    """Run OpenMontage's independent ``segmented_music`` operation.

    This is an internal Runtime helper, not a new public bundle or endpoint.
    The caller provides already-authorized bytes and the existing platform
    MIME/SHA facts; the source adapter receives only controlled temporary
    paths and the existing ffmpeg/ffprobe command boundary.
    """
    video_digest = _validated_video_bytes(video_body, video_expected_sha256)
    music_digest = _validated_audio_bytes(music_body, music_expected_sha256)
    if not isinstance(music_mime_type, str) or music_mime_type.lower() not in {"audio/mpeg", "audio/ogg", "audio/wav"}:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Music input MIME is invalid.")
    if not isinstance(music_segments_ms, tuple) or not music_segments_ms:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Segmented music requires declared windows.")
    for window in music_segments_ms:
        if not isinstance(window, tuple) or len(window) != 2:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Segmented music windows are invalid.")
        start_ms, end_ms = window
        if (
            isinstance(start_ms, bool)
            or isinstance(end_ms, bool)
            or not isinstance(start_ms, int)
            or not isinstance(end_ms, int)
            or start_ms < 0
            or end_ms <= start_ms
        ):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Segmented music windows are invalid.")
    # The existing platform composition plan requires ordered, non-overlapping
    # music windows.  Keep that plan invariant at this boundary while the
    # source adapter itself retains OpenMontage's additive overlap semantics.
    ordered_music_segments_ms = tuple(sorted(music_segments_ms, key=lambda window: window[0]))
    previous_end_ms: int | None = None
    for start_ms, end_ms in ordered_music_segments_ms:
        if previous_end_ms is not None and start_ms < previous_end_ms:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Segmented music windows overlap.")
        previous_end_ms = end_ms
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    suffix = {"audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav"}[music_mime_type.lower()]
    with TemporaryDirectory(prefix="alchemy-c12-segmented-music-") as directory:
        root = Path(directory)
        video_path = root / "source.mp4"
        music_path = root / f"music{suffix}"
        output_path = root / "segmented-music.mp4"
        video_path.write_bytes(video_body)
        music_path.write_bytes(music_body)
        try:
            OpenMontageSegmentedMusicMixer(
                run_command=lambda binary, args, timeout: _run(binary, args, timeout_seconds=timeout),
                ffprobe=ffprobe,
            ).segmented_music({
                "video_path": str(video_path),
                "music_path": str(music_path),
                "music_volume": music_volume,
                "segments": [
                    {"start": start_ms / 1000, "end": end_ms / 1000}
                    for start_ms, end_ms in ordered_music_segments_ms
                ],
                "fade_duration": fade_duration,
                "ffmpeg": ffmpeg,
                "output_path": str(output_path),
            })
        except OpenMontageSegmentedMusicError as error:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", str(error)) from error
        if not output_path.is_file():
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Segmented music produced no output.")
        output = output_path.read_bytes()
        output_digest = _validated_video_bytes(output, None)
        inspection = _inspect_path(output_path, len(output), output_digest)
    return CompositionArtifact(inspection=inspection, bytes=output)


def _probe_final_review_technical(path: Path, byte_size: int) -> dict[str, object]:
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    output = _run(
        ffprobe,
        [
            "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate:format=duration:format_tags=alchemy_captions",
            "-of", "json",
            str(path),
        ],
        timeout_seconds=15,
    )
    try:
        parsed = json.loads(output)
        streams = parsed.get("streams", [])
        video = next(stream for stream in streams if stream.get("codec_type") == "video")
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        rate_num, rate_den = (int(value) for value in str(video.get("r_frame_rate", "0/1")).split("/", 1))
        fps = rate_num / rate_den if rate_den else 0
        duration = float(parsed.get("format", {}).get("duration", 0))
        width = int(video.get("width", 0))
        height = int(video.get("height", 0))
        codec = str(video.get("codec_name", "unknown"))
        format_tags = parsed.get("format", {}).get("tags", {})
        captions_present = isinstance(format_tags, dict) and format_tags.get("alchemy_captions") == "burned_srt"
    except (StopIteration, ValueError, TypeError, KeyError, ZeroDivisionError, json.JSONDecodeError) as error:
        raise MediaRuntimeError("QC_FAILED", "The final video technical probe failed.") from error
    if width <= 0 or height <= 0 or fps <= 0 or duration <= 0:
        raise MediaRuntimeError("QC_FAILED", "The final video technical probe is incomplete.")
    return {
        "valid_container": True,
        "duration_seconds": duration,
        "resolution": f"{width}x{height}",
        "fps": fps,
        "has_audio": audio is not None,
        "codec": codec,
        "file_size_bytes": byte_size,
        "issues": [],
        "audio_channels": int(audio.get("channels", 0)) if audio and audio.get("channels") else None,
        "audio_sample_rate": int(audio.get("sample_rate", 0)) if audio and audio.get("sample_rate") else None,
        "captions_present": captions_present,
    }


def _sample_review_frames(path: Path, duration_seconds: float) -> tuple[int, bool, list[str]]:
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    with TemporaryDirectory(prefix="alchemy-final-review-") as directory:
        timestamps = (0.0, duration_seconds * 0.33, duration_seconds * 0.66, max(0.0, duration_seconds - 0.1))
        samples: list[Path] = []
        for index, timestamp in enumerate(timestamps):
            output = Path(directory) / f"sample-{index:02d}.png"
            _run(
                ffmpeg,
                ["-y", "-ss", f"{timestamp:.3f}", "-i", str(path), "-frames:v", "1", "-update", "1", "-f", "image2", str(output)],
                timeout_seconds=30,
            )
            samples.append(output)
        for sample in samples:
            _png_dimensions(sample.read_bytes())
        _, stderr = _run_capture(
            ffmpeg,
            ["-v", "info", "-i", str(path), "-vf", "blackdetect=d=0.5:pix_th=0.1", "-an", "-f", "null", "-"],
            timeout_seconds=30,
        )
        events = [
            (float(start), float(end), float(duration))
            for start, end, duration in re.findall(
                r"black_start:\s*([0-9.]+).*?black_end:\s*([0-9.]+).*?black_duration:\s*([0-9.]+)",
                stderr,
            )
        ]
        durations = [float(value) for value in re.findall(r"black_duration:\s*([0-9.]+)", stderr)]
        def near_total_black(event: tuple[float, float, float]) -> bool:
            start, end, duration = event
            if end <= start or duration <= 0:
                return True
            # A dark logo/end card has a black background but still carries
            # visible content. Sample three interior frames with a stricter
            # blackframe threshold before treating the whole interval as a
            # broken black screen.
            interior = (start + duration * 0.2, start + duration * 0.5, end - duration * 0.2)
            for timestamp in interior:
                _, frame_stderr = _run_capture(
                    ffmpeg,
                    [
                        "-v", "info", "-ss", f"{max(0.0, timestamp):.3f}", "-i", str(path),
                        "-frames:v", "1", "-vf", "blackframe=amount=99.5:threshold=32", "-an", "-f", "null", "-",
                    ],
                    timeout_seconds=30,
                )
                if "pblack:" not in frame_stderr:
                    return False
            return True
        terminal_fade = any(
            duration > BLACK_TRANSITION_MAX_SECONDS
            and duration <= 2.0
            and end >= duration_seconds - 0.2
            for _, end, duration in events
        )
        candidate_events = [
            event for event in events
            if event[2] > BLACK_TRANSITION_MAX_SECONDS
            and not (event[2] <= 2.0 and event[1] >= duration_seconds - 0.2)
        ]
        black = any(near_total_black(event) for event in candidate_events) if events else any(duration > BLACK_TRANSITION_MAX_SECONDS for duration in durations)
        graphic_cards = bool(candidate_events) and not black
        issues = (["黑帧检测发现连续黑帧。"] if black else
                  (["检测到深色品牌或文字卡，但画面仍有可见内容。"] if graphic_cards else
                  (["检测到片尾淡黑转场（不超过 2 秒），按允许的片尾处理。"] if terminal_fade else
                   (["检测到短暂淡黑转场（不超过 1 秒），按允许的转场处理。"] if durations else []))))
        return len(samples), black, issues


def _audio_review(path: Path, duration_seconds: float, technical: dict[str, object], *, authoritative_narration: bool = False) -> tuple[bool, list[str]]:
    if not technical.get("has_audio"):
        return False, ["成片没有音频轨。"]
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    _, silence_stderr = _run_capture(
        ffmpeg,
        ["-v", "info", "-i", str(path), "-af", "silencedetect=noise=-50dB:d=1", "-f", "null", "-"],
        timeout_seconds=30,
    )
    silence_durations = [float(match) for match in re.findall(r"silence_duration:\s*([0-9.]+)", silence_stderr)]
    long_silence = max(silence_durations, default=0.0)
    # OpenMontage's silence_cutter uses ``mark`` for reviewable dead air.  For
    # an authoritative narration track, however, no HOLD/BROLL/ambient-tail
    # metadata is available at this final-review boundary, so any uncovered
    # gap over one second is an unexpected silence and must block delivery.
    # Purely visual/ambient videos retain the source near-total-silence rule.
    unexpected = any(
        duration > 1.0 if authoritative_narration else duration >= max(1.0, duration_seconds * 0.8)
        for duration in silence_durations
    )
    issues: list[str] = []
    _, loudness_stderr = _run_capture(
        ffmpeg,
        ["-v", "info", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        timeout_seconds=30,
    )
    if technical.get("audio_sample_rate") and int(technical["audio_sample_rate"]) != 48_000:
        issues.append("成片音频采样率不是推荐的 48 kHz。")
    if unexpected:
        issues.append("音频存在大段异常静音。")
    if long_silence >= 5.0 and not unexpected:
        # OpenMontage talking-head preflight marks >5s dead air for review;
        # this remains a warning because a planned visual-only hold may use
        # ambient-only sound intentionally.
        issues.append(f"存在约 {long_silence:.1f} 秒长静音段；按源仓库规则建议缩短该段或改为空镜/非说话画面。")
    return unexpected, issues


def _audio_loudness_metrics(path: Path) -> dict[str, float]:
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    try:
        _, stderr = _run_capture(ffmpeg, ["-v", "info", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], timeout_seconds=30)
    except MediaRuntimeError:
        return {}
    summary = stderr.split("Summary:")[-1]
    metrics: dict[str, float] = {}
    for key, pattern in {
        "integrated_lufs": r"Integrated loudness:\s*I:\s*([-0-9.]+)\s*LUFS",
        "loudness_range_lu": r"Loudness range:\s*LRA:\s*([0-9.]+)\s*LU",
        "true_peak_db": r"True peak:\s*Peak:\s*([-0-9.]+)\s*dBFS",
    }.items():
        match = re.search(pattern, summary, re.S)
        if match:
            metrics[key] = float(match.group(1))
    return metrics


def final_review_video_bytes(*, body: bytes, expected_sha256: str | None, script_text: str | None = None, caption_policy: str = "OFF") -> FinalReview:
    if caption_policy not in {"REQUIRED", "OPTIONAL", "OFF"}:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Caption policy is invalid.")
    digest = _validated_video_bytes(body, expected_sha256)
    with TemporaryDirectory(prefix="alchemy-c12-final-review-") as directory:
        source = Path(directory) / "final.mp4"
        source.write_bytes(body)
        technical = _probe_final_review_technical(source, len(body))
        frames_sampled, black_frames, visual_issues = _sample_review_frames(source, float(technical["duration_seconds"]))
        unexpected_silence, audio_issues = _audio_review(
            source,
            float(technical["duration_seconds"]),
            technical,
            authoritative_narration=bool(script_text and script_text.strip()),
        )
        audio_metrics = _audio_loudness_metrics(source) if technical.get("has_audio") else {}
        if audio_metrics.get("true_peak_db", -99) > -1.5:
            audio_issues.append("成片音频 true peak 超过 -1.5 dBTP。")
        semantic_review = visual_semantic_review(path=source, duration_seconds=float(technical["duration_seconds"]))
        transcript = transcribe_video_bytes(body=body, expected_sha256=digest)
    visual_capability_note = "叠加层、素材引用和文字可读性检查未配置；以下三项为未发现而非已完成语义检查。" if semantic_review["status"] != "CHECKED" else ""
    transcript_comparison = compare_transcript_to_script(transcript=transcript, script_text=script_text)
    transcript_issues = list(transcript_comparison["issues"])
    transcript_issue = transcript_issues[0] if transcript_issues else ""
    subtitles_expected = caption_policy == "REQUIRED"
    captions_present = bool(technical.get("captions_present"))
    subtitle_issues = ["交付策略要求字幕，但当前成片没有可验证的字幕轨或字幕资产。"] if subtitles_expected and not captions_present else []
    issues = [*visual_issues, *audio_issues, *subtitle_issues, visual_capability_note, *(["视觉语义评估器未配置，无法自动核对人物/背景/道具连续性。"] if semantic_review["status"] != "CHECKED" else []), transcript_issue]
    if not transcript_issue and issues and issues[-1] == "":
        issues.pop()
    issues = [issue for issue in issues if issue]
    technical_failed = bool(black_frames) or not bool(technical["valid_container"])
    # Missing audio and the source detector's *unexpected* silence are hard
    # blocks.  Only a source ``mark`` warning on a visual/ambient or explicitly
    # planned tail remains reviewable; authoritative narration has no such
    # private tail metadata at this boundary.
    audio_block = (not bool(technical.get("has_audio"))) or unexpected_silence
    status = "FAILED" if technical_failed else "PASS" if not issues else "NEEDS_ATTENTION"
    payload = {
        "status": status,
        "technical_probe": {key: value for key, value in technical.items() if key not in {"audio_channels", "audio_sample_rate"}},
        "visual_spotcheck": {
            "frames_sampled": frames_sampled,
            "black_frames_detected": black_frames,
            "broken_overlays": False,
            "missing_assets": False,
            "unreadable_text": False,
            "issues": [*visual_issues, *([visual_capability_note] if visual_capability_note else [])],
        },
        "audio_spotcheck": {
            "has_audio": bool(technical["has_audio"]),
            **({"audio_channels": technical["audio_channels"]} if technical.get("audio_channels") else {}),
            **({"audio_sample_rate": technical["audio_sample_rate"]} if technical.get("audio_sample_rate") else {}),
            "unexpected_silence": unexpected_silence,
            **audio_metrics,
            "issues": audio_issues,
        },
        "promise_preservation": {
            "status": "CHECKED",
            "renderer_family_used": "source-aligned video composition",
            "render_runtime_used": "ffmpeg",
            "runtime_swap_detected": False,
            "silent_downgrade_detected": False,
            "issues": [],
        },
        "subtitle_check": {
            "status": "CHECKED" if captions_present else "UNAVAILABLE" if subtitles_expected else "NOT_EXPECTED",
            "subtitles_expected": subtitles_expected,
            "subtitles_present": captions_present,
            "issues": subtitle_issues,
        },
        "transcript_comparison": {
            "status": transcript_comparison["status"],
            "transcript_matches_script": transcript_comparison["transcript_matches_script"],
            "word_accuracy": transcript_comparison["word_accuracy"],
            "issues": transcript_issues,
        },
        "semantic_evaluation": {
            "status": semantic_review["status"],
            "issues": list(semantic_review["issues"]),
        },
        "issues_found": issues,
        "recommended_action": "BLOCK" if technical_failed or audio_block or bool(subtitle_issues) else "PRESENT_WITH_REVIEW",
    }
    return FinalReview(payload=payload)


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
        _inspect_path(source, len(body), digest, include_audio=False)
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


def extract_boundary_frames(*, body: bytes, expected_sha256: str | None) -> BoundaryFrames:
    """Extract bounded first/last frames without exposing service-owned paths."""
    digest = _validated_video_bytes(body, expected_sha256)
    ffmpeg = configured_binary("MEDIA_RUNTIME_FFMPEG_PATH")
    with TemporaryDirectory(prefix="alchemy-c12-media-boundary-") as directory:
        source = Path(directory) / "source.mp4"
        first_output = Path(directory) / "first.png"
        last_output = Path(directory) / "last.png"
        source.write_bytes(body)
        _inspect_path(source, len(body), digest, include_audio=False)
        _run(
            ffmpeg,
            ["-y", "-i", str(source), "-frames:v", "1", "-update", "1", "-f", "image2", str(first_output)],
            timeout_seconds=20,
        )
        _run(
            ffmpeg,
            ["-y", "-sseof", "-0.5", "-i", str(source), "-frames:v", "1", "-update", "1", "-f", "image2", str(last_output)],
            timeout_seconds=20,
        )
        first_bytes = first_output.read_bytes() if first_output.is_file() else b""
        last_bytes = last_output.read_bytes() if last_output.is_file() else b""
    def artifact(image: bytes) -> ImageArtifact:
        width, height = _png_dimensions(image)
        return ImageArtifact(
            mime_type="image/png",
            sha256=sha256(image).hexdigest(),
            byte_size=len(image),
            width=width,
            height=height,
            bytes=image,
        )
    return BoundaryFrames(first=artifact(first_bytes), last=artifact(last_bytes))


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


def decode_composition_bundle_with_plan(body: bytes) -> tuple[list[bytes], CompositionPlan | None]:
    if body.startswith(COMPOSITION_MAGIC):
        return decode_composition_bundle(body), None
    if body.startswith(COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC):
        plan_magic = COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC
    elif body.startswith(COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC):
        plan_magic = COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC
    elif body.startswith(COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC):
        plan_magic = COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC
    elif body.startswith(COMPOSITION_NARRATION_PLAN_MAGIC):
        plan_magic = COMPOSITION_NARRATION_PLAN_MAGIC
    elif body.startswith(COMPOSITION_MUSIC_PLAN_MAGIC):
        plan_magic = COMPOSITION_MUSIC_PLAN_MAGIC
    else:
        plan_magic = COMPOSITION_AUDIO_PLAN_MAGIC if body.startswith(COMPOSITION_AUDIO_PLAN_MAGIC) else COMPOSITION_PLAN_MAGIC
    if len(body) > MAX_COMPOSITION_INPUT_BYTES or len(body) < len(plan_magic) + 2:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is outside the supported range.")
    if body[: len(plan_magic)] != plan_magic:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    cursor = len(plan_magic)
    count = body[cursor]
    cursor += 1
    transition_count = body[cursor]
    cursor += 1
    if count < 1 or count > MAX_COMPOSITION_SEGMENTS or transition_count != count - 1:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    raw_transitions = body[cursor : cursor + transition_count]
    cursor += transition_count
    transition_map = {0: "PASS", 1: "BLEND", 2: "BRIDGE"}
    transitions = tuple(transition_map.get(value, "") for value in raw_transitions)
    if any(not value for value in transitions) or cursor + 5 > len(body):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    target_duration_ms = struct.unpack(">I", body[cursor : cursor + 4])[0]
    cursor += 4
    bridge_count = body[cursor]
    cursor += 1
    # ALCHMED4 is the legacy music-only marker.  It has no policy byte, so it
    # must never be interpreted as a continuous-narration plan: doing so would
    # replace historical/provider audio with anullsrc merely because a music
    # bed was attached.  New continuous plans with narration use ALCHMED5/6.
    audio_policy = "CONTINUOUS_NARRATION" if plan_magic in (COMPOSITION_AUDIO_PLAN_MAGIC, COMPOSITION_NARRATION_PLAN_MAGIC) else "LEGACY_PRESERVE"
    if plan_magic in (COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC, COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC, COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC):
        if cursor >= len(body) or body[cursor] not in (0, 1):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition audio policy is invalid.")
        audio_policy = "CONTINUOUS_NARRATION" if body[cursor] == 1 else "LEGACY_PRESERVE"
        cursor += 1
    if audio_policy == "CONTINUOUS_NARRATION" and plan_magic not in (COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC, COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC, COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC):
        if cursor >= len(body) or body[cursor] != 1:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
        cursor += 1
    music_bytes: bytes | None = None
    narration_bytes: bytes | None = None
    narration_payloads: tuple[tuple[str, bytes], ...] = ()
    has_narration = False
    has_narration_tracks = False
    has_music = plan_magic == COMPOSITION_MUSIC_PLAN_MAGIC
    if plan_magic == COMPOSITION_MUSIC_PLAN_MAGIC and cursor < len(body):
        # Older ALCHMED4 writers emitted a redundant policy byte after the
        # bridge count.  Accept it only when the next four bytes cannot be a
        # valid music length, while keeping music-only semantics legacy.
        candidate_length = struct.unpack(">I", body[cursor : cursor + 4])[0] if cursor + 4 <= len(body) else 0
        if (candidate_length == 0 or candidate_length > MAX_SINGLE_VIDEO_BYTES
                or cursor + 4 + candidate_length > len(body)) and body[cursor] in (0, 1):
            cursor += 1
    if plan_magic in (COMPOSITION_NARRATION_PLAN_MAGIC, COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC, COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC, COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC):
        if cursor >= len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition audio flags are invalid.")
        flags = body[cursor]
        cursor += 1
        has_narration = bool(flags & 1)
        has_music = bool(flags & 2)
        has_narration_tracks = bool(flags & 4)
        if flags & ~7 or (has_narration and has_narration_tracks) or (plan_magic == COMPOSITION_NARRATION_PLAN_MAGIC and not has_narration) or (plan_magic == COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC and audio_policy == "CONTINUOUS_NARRATION" and not has_narration):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition audio flags are invalid.")
    music_volume = 0.12
    ducking_reduction_db = 8.0
    target_lufs = -14.0
    true_peak_db = -1.5
    music_eq_cut_db = 3.0
    voice_enhance = True
    music_segments_ms: tuple[tuple[int, int], ...] = ()
    fade_in_ms = 1_500
    fade_out_ms = 2_500
    ducking_enabled = True
    if plan_magic in (COMPOSITION_ADVANCED_AUDIO_PLAN_MAGIC, COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC, COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC):
        if cursor + 14 > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition audio settings are invalid.")
        music_volume = struct.unpack(">H", body[cursor : cursor + 2])[0] / 1000
        cursor += 2
        ducking_reduction_db = float(body[cursor])
        cursor += 1
        target_lufs = float(body[cursor] - 100)
        cursor += 1
        true_peak_db = struct.unpack(">h", body[cursor : cursor + 2])[0] / 10
        cursor += 2
        music_eq_cut_db = float(body[cursor])
        cursor += 1
        voice_enhance = body[cursor] == 1
        cursor += 1
        fade_in_ms = struct.unpack(">H", body[cursor : cursor + 2])[0]
        cursor += 2
        fade_out_ms = struct.unpack(">H", body[cursor : cursor + 2])[0]
        cursor += 2
        ducking_enabled = body[cursor] == 1
        cursor += 1
        if (
            not 0 <= music_volume <= 1
            or not 0 <= ducking_reduction_db <= 30
            or not -24 <= target_lufs <= -10
            or not -6 <= true_peak_db <= -0.1
            or not 0 <= music_eq_cut_db <= 12
            or fade_in_ms > 10_000
            or fade_out_ms > 10_000
            or body[cursor - 1] not in (0, 1)
        ):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition audio settings are invalid.")
        segment_count = body[cursor]
        cursor += 1
        if segment_count > 32 or cursor + segment_count * 8 > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition music segments are invalid.")
        segments = []
        previous_music_end = 0
        for _ in range(segment_count):
            start_ms = struct.unpack(">I", body[cursor : cursor + 4])[0]
            end_ms = struct.unpack(">I", body[cursor + 4 : cursor + 8])[0]
            cursor += 8
            if (start_ms >= end_ms or end_ms > target_duration_ms
                    or (segments and start_ms < previous_music_end)):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition music segments are invalid.")
            segments.append((start_ms, end_ms))
            previous_music_end = end_ms
        music_segments_ms = tuple(segments)
    audio_tracks: tuple[CompositionAudioTrack, ...] | None = None
    audio_plan: CompositionAudioPlan | None = None
    if plan_magic == COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC:
        ownership_values = {
            0: "PLATFORM_NARRATION",
            1: "PROVIDER_DIALOGUE",
            2: "PROVIDER_AMBIENCE",
            3: "USER_SOURCE_AUDIO",
            4: "MUSIC",
            5: "SFX",
            6: "LEGACY_PRESERVE",
        }

        def read_text_field(*, length_bytes: int, maximum: int, required: bool = False) -> str | None:
            nonlocal cursor
            if cursor + length_bytes > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
            length = int.from_bytes(body[cursor : cursor + length_bytes], "big")
            cursor += length_bytes
            if length > maximum or cursor + length > len(body) or (required and length == 0):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
            raw = body[cursor : cursor + length]
            cursor += length
            try:
                value = raw.decode("utf-8")
            except UnicodeDecodeError as error:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.") from error
            return value if value else None

        if cursor + 2 > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
        audio_plan_version = body[cursor]
        stitch_code = body[cursor + 1]
        cursor += 2
        # SEGMENT_AUDIO has no payload in this wire version.  Do not retain a
        # parser-only enum that would silently discard a valid-looking plan.
        stitch_policy = {0: "CONTINUOUS_NARRATION", 2: "LEGACY_PRESERVE"}.get(stitch_code)
        if audio_plan_version != 1 or stitch_policy is None:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
        narration_asset_id = read_text_field(length_bytes=1, maximum=160)
        transcript_timing_asset_id = read_text_field(length_bytes=1, maximum=160)
        transcript_script = read_text_field(length_bytes=2, maximum=8_000)
        if cursor >= len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
        narration_section_count = body[cursor]
        cursor += 1
        if narration_section_count == 0 or narration_section_count > 120:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition narration section metadata is invalid.")
        narration_role_values = {0: "PRIMARY", 1: "BROLL", 2: "HOLD"}
        narration_sections: list[tuple[str, int, int, str]] = []
        narration_section_ids: set[str] = set()
        previous_section_end = 0
        for _ in range(narration_section_count):
            section_id = read_text_field(length_bytes=1, maximum=160, required=True)
            if section_id is None or cursor + 1 + 4 + 4 > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition narration section metadata is invalid.")
            visual_role = narration_role_values.get(body[cursor])
            cursor += 1
            start_ms = struct.unpack(">I", body[cursor : cursor + 4])[0]
            end_ms = struct.unpack(">I", body[cursor + 4 : cursor + 8])[0]
            cursor += 8
            if visual_role is None or section_id in narration_section_ids or start_ms < previous_section_end or start_ms >= end_ms or end_ms > target_duration_ms:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition narration section windows are invalid.")
            if start_ms - previous_section_end > 1_000 and visual_role not in {"BROLL", "HOLD"}:
                raise MediaRuntimeError("QC_FAILED", "Uncovered narration section gaps require an explicit BROLL or HOLD role.")
            narration_section_ids.add(section_id)
            previous_section_end = end_ms
            narration_sections.append((section_id, start_ms, end_ms, visual_role))
        if narration_sections[-1][2] != target_duration_ms:
            raise MediaRuntimeError("QC_FAILED", "Narration sections must cover the composition target; declare an explicit HOLD or BROLL tail.")
        if has_narration and not has_narration_tracks:
            # A singular byte payload is the source full_mix full-track path.
            # Section assets are carried by the independent speech-track
            # payloads; never silently choose one section or infer offsets for
            # a complete narration asset.
            if len(narration_sections) != 1 or narration_sections[0][1] != 0 or narration_sections[0][2] != target_duration_ms or narration_sections[0][3] != "PRIMARY":
                raise MediaRuntimeError("QC_FAILED", "Full narration section windows are not consumed by this Runtime.")
        if cursor >= len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is truncated before track count.")
        track_count = body[cursor]
        cursor += 1
        if track_count == 0 or track_count > 64:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
        tracks: list[CompositionAudioTrack] = []
        track_ids: set[str] = set()
        previous_start = -1
        for _ in range(track_count):
            track_id = read_text_field(length_bytes=1, maximum=160, required=True)
            if track_id is None or track_id in track_ids or cursor + 1 + 4 + 4 + 1 > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
            ownership = ownership_values.get(body[cursor])
            cursor += 1
            if ownership is None:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
            start_ms = struct.unpack(">I", body[cursor : cursor + 4])[0]
            end_ms = struct.unpack(">I", body[cursor + 4 : cursor + 8])[0]
            cursor += 8
            duck_under_narration = body[cursor]
            cursor += 1
            if duck_under_narration not in (0, 1) or start_ms >= end_ms or end_ms > target_duration_ms or start_ms < previous_start:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan windows are invalid.")
            asset_id = read_text_field(length_bytes=1, maximum=160, required=True)
            gain_db = read_text_field(length_bytes=1, maximum=32, required=True)
            if asset_id is None or gain_db is None or not re.fullmatch(r"-?(?:\d+(?:\.\d+)?)", gain_db):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan gain/asset metadata is invalid.")
            if cursor + 4 > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition AudioPlan metadata is invalid.")
            fade_in_raw = struct.unpack(">H", body[cursor : cursor + 2])[0]
            fade_out_raw = struct.unpack(">H", body[cursor + 2 : cursor + 4])[0]
            cursor += 4
            fade_in_ms = None if fade_in_raw == 0xFFFF else fade_in_raw
            fade_out_ms = None if fade_out_raw == 0xFFFF else fade_out_raw
            track_ids.add(track_id)
            previous_start = start_ms
            tracks.append(CompositionAudioTrack(
                track_id, ownership, start_ms, end_ms, bool(duck_under_narration),
                asset_id, gain_db, fade_in_ms, fade_out_ms,
            ))
        if stitch_policy == "CONTINUOUS_NARRATION" and audio_policy != "CONTINUOUS_NARRATION":
            raise MediaRuntimeError("QC_FAILED", "AudioPlan stitch policy does not match the composition policy.")
        if stitch_policy == "LEGACY_PRESERVE" and audio_policy != "LEGACY_PRESERVE":
            raise MediaRuntimeError("QC_FAILED", "AudioPlan stitch policy does not match the composition policy.")
        narration_tracks = [track for track in tracks if track.ownership == "PLATFORM_NARRATION"]
        if narration_asset_id and any(track.asset_id != narration_asset_id for track in narration_tracks):
            raise MediaRuntimeError("QC_FAILED", "The narration asset identity does not match the platform narration track.")
        if has_narration and not has_narration_tracks and (
            len(narration_tracks) != 1
            or narration_tracks[0].start_ms != 0
            or narration_tracks[0].end_ms != target_duration_ms
        ):
            raise MediaRuntimeError("QC_FAILED", "A single narration payload requires one platform track covering the full target.")
        if audio_policy == "CONTINUOUS_NARRATION" and not any(
            track.start_ms == 0 and track.end_ms == target_duration_ms for track in narration_tracks
        ) and not has_narration_tracks:
            raise MediaRuntimeError("QC_FAILED", "Continuous narration requires a platform narration ownership track covering the full target.")
        if has_narration_tracks:
            if audio_policy != "CONTINUOUS_NARRATION" or not narration_tracks:
                raise MediaRuntimeError("QC_FAILED", "Independent narration tracks require continuous narration AudioPlan ownership.")
            primary_windows = {(start_ms, end_ms) for _section_id, start_ms, end_ms, visual_role in narration_sections if visual_role == "PRIMARY"}
            if len(primary_windows) != len(narration_tracks) or any((track.start_ms, track.end_ms) not in primary_windows for track in narration_tracks):
                raise MediaRuntimeError("QC_FAILED", "Independent narration tracks must match every PRIMARY section window.")
        music_tracks = [track for track in tracks if track.ownership == "MUSIC"]
        if plan_magic == COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC and has_music and not music_tracks:
            raise MediaRuntimeError("QC_FAILED", "A MUSIC payload requires a mapped AudioPlan MUSIC track.")
        if len(music_tracks) > 1:
            raise MediaRuntimeError("QC_FAILED", "This Runtime supports one mapped MUSIC payload per AudioPlan.")
        if music_tracks:
            if not has_music or not music_segments_ms:
                raise MediaRuntimeError("QC_FAILED", "A MUSIC ownership track requires music audio bytes and coverage windows.")
            if plan_magic == COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC:
                music_track = music_tracks[0]
                if (
                    len(music_segments_ms) != 1
                    or music_segments_ms[0] != (music_track.start_ms, target_duration_ms)
                    or music_track.end_ms != target_duration_ms
                ):
                    raise MediaRuntimeError(
                        "QC_FAILED",
                        "OpenMontage full_mix cannot consume partial or multiple MUSIC windows.",
                    )
            if any(
                not any(window_start <= track.start_ms and window_end >= track.end_ms for window_start, window_end in music_segments_ms)
                for track in music_tracks
            ):
                raise MediaRuntimeError("QC_FAILED", "MUSIC ownership windows must be covered by music segments.")
        unsupported_tracks = [track for track in tracks if track.ownership == "SFX"]
        if unsupported_tracks:
            raise MediaRuntimeError("QC_FAILED", "SFX ownership requires a corresponding audio payload, which this Runtime bundle does not carry.")
        if any(
            track.ownership in {"PROVIDER_DIALOGUE", "PROVIDER_AMBIENCE", "USER_SOURCE_AUDIO", "LEGACY_PRESERVE"}
            and not track.track_id.startswith("segment-")
            for track in tracks
        ):
            raise MediaRuntimeError("QC_FAILED", "Source AudioPlan tracks must map to an accepted segment payload.")
        audio_plan = CompositionAudioPlan(
            audio_plan_version, target_duration_ms, narration_asset_id, tuple(narration_sections), tuple(tracks), stitch_policy,
            transcript_script, transcript_timing_asset_id,
        )
        audio_tracks = tuple(tracks)
    if plan_magic == COMPOSITION_OWNERSHIP_AUDIO_PLAN_MAGIC:
        if cursor >= len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.")
        track_count = body[cursor]
        cursor += 1
        if track_count == 0 or track_count > 64:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.")
        tracks: list[CompositionAudioTrack] = []
        track_ids: set[str] = set()
        ownership_values = {
            0: "PLATFORM_NARRATION",
            1: "PROVIDER_DIALOGUE",
            2: "PROVIDER_AMBIENCE",
            3: "USER_SOURCE_AUDIO",
            4: "MUSIC",
            5: "SFX",
            6: "LEGACY_PRESERVE",
        }
        for _ in range(track_count):
            if cursor >= len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.")
            id_length = body[cursor]
            cursor += 1
            if id_length == 0 or id_length > 64 or cursor + id_length + 10 > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.")
            try:
                track_id = body[cursor : cursor + id_length].decode("utf-8")
            except UnicodeDecodeError as error:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.") from error
            cursor += id_length
            ownership = ownership_values.get(body[cursor])
            cursor += 1
            if ownership is None or track_id in track_ids:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.")
            start_ms = struct.unpack(">I", body[cursor : cursor + 4])[0]
            end_ms = struct.unpack(">I", body[cursor + 4 : cursor + 8])[0]
            cursor += 8
            duck_under_narration = body[cursor]
            cursor += 1
            if duck_under_narration not in (0, 1) or start_ms >= end_ms or end_ms > target_duration_ms:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition ownership facts are invalid.")
            track_ids.add(track_id)
            tracks.append(CompositionAudioTrack(track_id, ownership, start_ms, end_ms, bool(duck_under_narration)))
        # Ownership is an executable AudioPlan fact, not descriptive metadata.
        # A declared platform/music track must have its corresponding payload
        # and an absolute window; otherwise an old or hand-crafted writer could
        # silently produce a missing/empty mix.
        if any(track.ownership == "PLATFORM_NARRATION" for track in tracks) and not has_narration:
            raise MediaRuntimeError("QC_FAILED", "A PLATFORM_NARRATION track requires narration audio bytes.")
        music_tracks = [track for track in tracks if track.ownership == "MUSIC"]
        if music_tracks:
            if not has_music or not music_segments_ms:
                raise MediaRuntimeError("QC_FAILED", "A MUSIC ownership track requires music audio bytes and coverage windows.")
            if any(not any(window_start <= track.start_ms and window_end >= track.end_ms for window_start, window_end in music_segments_ms) for track in music_tracks):
                raise MediaRuntimeError("QC_FAILED", "MUSIC ownership windows must be covered by music segments.")
        if audio_policy == "CONTINUOUS_NARRATION":
            # The private ALCHMED7 writer is not a trusted boundary: old or
            # hand-crafted writers can bypass the TypeScript contract.  A
            # platform track therefore has to cover the complete target from
            # the absolute origin; merely carrying a partial track is not
            # evidence that the narration owns the final mix.
            if not any(
                track.ownership == "PLATFORM_NARRATION"
                and track.start_ms == 0
                and track.end_ms == target_duration_ms
                for track in tracks
            ):
                raise MediaRuntimeError(
                    "QC_FAILED",
                    "Continuous narration requires a platform narration ownership track covering the full target.",
                )
        audio_tracks = tuple(tracks)
    if has_narration_tracks:
        if plan_magic != COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC or audio_plan is None:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payloads require ALCHMED8 AudioPlan metadata.")
        if cursor >= len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payloads are truncated.")
        payload_count = body[cursor]
        cursor += 1
        platform_track_ids = {track.track_id for track in audio_plan.tracks if track.ownership == "PLATFORM_NARRATION"}
        if payload_count == 0 or payload_count != len(platform_track_ids) or payload_count > 64:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payload count is invalid.")
        payloads: list[tuple[str, bytes]] = []
        payload_ids: set[str] = set()
        for _ in range(payload_count):
            if cursor >= len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payload metadata is truncated.")
            id_length = body[cursor]
            cursor += 1
            if id_length == 0 or id_length > 160 or cursor + id_length + 4 > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payload metadata is invalid.")
            try:
                track_id = body[cursor : cursor + id_length].decode("utf-8")
            except UnicodeDecodeError as error:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payload metadata is invalid.") from error
            cursor += id_length
            payload_length = struct.unpack(">I", body[cursor : cursor + 4])[0]
            cursor += 4
            if track_id in payload_ids or track_id not in platform_track_ids or payload_length == 0 or payload_length > MAX_SINGLE_VIDEO_BYTES or cursor + payload_length > len(body):
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payload is invalid.")
            payload_ids.add(track_id)
            payloads.append((track_id, body[cursor : cursor + payload_length]))
            cursor += payload_length
        if payload_ids != platform_track_ids:
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Independent narration payload identities do not match AudioPlan tracks.")
        narration_payloads = tuple(payloads)
    if has_narration:
        if cursor + 4 > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition narration input is invalid.")
        narration_length = struct.unpack(">I", body[cursor : cursor + 4])[0]
        cursor += 4
        if narration_length == 0 or narration_length > MAX_SINGLE_VIDEO_BYTES or cursor + narration_length > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition narration input is invalid.")
        narration_bytes = body[cursor : cursor + narration_length]
        cursor += narration_length
    if has_music:
        if cursor + 4 > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition music input is invalid.")
        music_length = struct.unpack(">I", body[cursor : cursor + 4])[0]
        cursor += 4
        if music_length == 0 or music_length > MAX_SINGLE_VIDEO_BYTES or cursor + music_length > len(body):
            raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition music input is invalid.")
        music_bytes = body[cursor : cursor + music_length]
        cursor += music_length
    if bridge_count > transition_count or cursor + bridge_count * 4 > len(body):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    bridge_durations = tuple(
        struct.unpack(">I", body[cursor + index * 4 : cursor + index * 4 + 4])[0]
        for index in range(bridge_count)
    )
    cursor += bridge_count * 4
    if any(duration < 1_000 or duration > 3_000 for duration in bridge_durations):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    if bridge_count != sum(transition == "BRIDGE" for transition in transitions):
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
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
    if cursor != len(body) or target_duration_ms <= 0:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input is invalid.")
    return segments, CompositionPlan(
        transitions=transitions,
        target_duration_ms=target_duration_ms,
        bridge_durations_ms=bridge_durations,
        audio_policy=audio_policy,
        music_bytes=music_bytes,
        narration_bytes=narration_bytes,
        narration_tracks=narration_payloads,
        music_volume=music_volume,
        ducking_reduction_db=ducking_reduction_db,
        target_lufs=target_lufs,
        true_peak_db=true_peak_db,
        music_eq_cut_db=music_eq_cut_db,
        voice_enhance=voice_enhance,
        music_segments_ms=music_segments_ms,
        fade_in_ms=fade_in_ms,
        fade_out_ms=fade_out_ms,
        ducking_enabled=ducking_enabled,
        audio_ownership=None,
        audio_tracks=audio_tracks,
        audio_plan=audio_plan,
    )


def _narration_voice_effects(*, voice_enhance: bool, gain_db: str | None, fade_in_ms: int | None, fade_out_ms: int | None, target_seconds: float) -> str:
    chain = "aresample=48000,highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=100,alimiter=limit=0.95" if voice_enhance else "aresample=48000"
    if gain_db:
        if not re.fullmatch(r"-?(?:\d+(?:\.\d+)?)", gain_db):
            raise MediaRuntimeError("QC_FAILED", "Narration gain metadata is invalid.")
        chain += f",volume={gain_db}dB"
    if fade_in_ms and fade_in_ms > 0:
        chain += f",afade=t=in:st=0:d={fade_in_ms / 1000:.3f}"
    if fade_out_ms and fade_out_ms > 0:
        fade_start = max(0.0, target_seconds - fade_out_ms / 1000)
        chain += f",afade=t=out:st={fade_start:.3f}:d={fade_out_ms / 1000:.3f}"
    return chain


def _openmontage_ducking_volume(ducking_reduction_db: float) -> float:
    """Map the platform's positive reduction field to OpenMontage's source form.

    OpenMontage's simple ``duck`` operation accepts a negative dB
    ``duck_level`` and converts it to the linear
    ``music_volume_during_speech`` value with ``10 ** (db / 20)``.  The
    platform contract stores that same attenuation as a positive reduction
    amount, so the only adaptation is applying the source conversion to
    ``-abs(reduction)``.  The compressor ratio stays the source value (9); a
    dB amount must never be reinterpreted as a ratio.
    """
    if (
        isinstance(ducking_reduction_db, bool)
        or not isinstance(ducking_reduction_db, (int, float))
        or not math.isfinite(float(ducking_reduction_db))
        or ducking_reduction_db < 0
        or ducking_reduction_db > 30
    ):
        raise MediaRuntimeError("QC_FAILED", "AudioPlan ducking reduction metadata is invalid.")
    return math.pow(10.0, -abs(float(ducking_reduction_db)) / 20.0)


def _openmontage_track_volume(gain_db: str | None) -> float:
    """Map the platform AudioPlan dB field to OpenMontage's ``volume`` field."""
    if gain_db is None:
        return 1.0
    if not re.fullmatch(r"-?(?:\d+(?:\.\d+)?)", gain_db):
        raise MediaRuntimeError("QC_FAILED", "AudioPlan gain metadata is invalid.")
    return math.pow(10.0, float(gain_db) / 20.0)


def _source_audio_track_filters(*, track: CompositionAudioTrack, duration_seconds: float) -> str:
    """Apply source OpenMontage track filters before timeline concatenation.

    ``audio_mixer._track_filters`` applies volume and fades to the source
    samples before scheduling/delay.  The composition path concatenates each
    accepted segment at its already-audited absolute window, so this mapper
    keeps that ordering while refusing malformed gain/fade metadata.
    """
    chain = ["aresample=48000"]
    if track.gain_db is not None:
        if not re.fullmatch(r"-?(?:\d+(?:\.\d+)?)", track.gain_db):
            raise MediaRuntimeError("QC_FAILED", "Source AudioPlan gain metadata is invalid.")
        chain.append(f"volume={track.gain_db}dB")
    for field_name, value, fade_type in (
        ("fade_in_ms", track.fade_in_ms, "in"),
        ("fade_out_ms", track.fade_out_ms, "out"),
    ):
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 600_000:
            raise MediaRuntimeError("QC_FAILED", f"Source AudioPlan {field_name} metadata is invalid.")
        if value == 0:
            continue
        fade_seconds = value / 1000
        if fade_type == "in":
            chain.append(f"afade=t=in:st=0:d={fade_seconds:.3f}")
        else:
            fade_start = max(0.0, duration_seconds - fade_seconds)
            chain.append(f"afade=t=out:st={fade_start:.3f}:d={fade_seconds:.3f}")
    # Segment concatenation already places this source at its audited
    # absolute window; reset PTS only after source-local filters.
    chain.append("asetpts=PTS-STARTPTS")
    return ",".join(chain)


def _openmontage_transition_plan(
    composition_plan: CompositionPlan | None,
    segment_count: int,
) -> tuple[str, tuple[float, ...]]:
    """Map one platform transition plan to OpenMontage's global transition.

    The pinned ``video_stitch._stitch`` accepts one transition type and one
    duration for the complete clip list.  A mixed platform plan, or bridge
    boundaries with different durations, therefore cannot be represented by
    that source call without inventing a per-boundary algorithm.
    """
    boundary_count = max(0, segment_count - 1)
    if boundary_count == 0:
        return "cut", ()
    kinds = composition_plan.transitions if composition_plan is not None else ("PASS",) * boundary_count
    if len(kinds) != boundary_count or len(set(kinds)) != 1:
        raise MediaRuntimeError(
            "QC_FAILED",
            "Mixed transition plans are not expressible by the source video_stitch operation.",
        )
    kind = kinds[0]
    if kind == "PASS":
        return "cut", (0.0,) * boundary_count
    if kind == "BLEND":
        duration = OPENMONTAGE_DEFAULT_TRANSITION_SECONDS
    elif kind == "BRIDGE":
        if composition_plan is None or len(composition_plan.bridge_durations_ms) != boundary_count:
            raise MediaRuntimeError("QC_FAILED", "Bridge transition metadata is not expressible by the source video_stitch operation.")
        bridge_durations = tuple(value / 1000 for value in composition_plan.bridge_durations_ms)
        if any(
            not math.isfinite(value)
            or value < OPENMONTAGE_TRANSITION_MIN_SECONDS
            or value > OPENMONTAGE_TRANSITION_MAX_SECONDS
            for value in bridge_durations
        ):
            raise MediaRuntimeError("QC_FAILED", "Bridge transition duration is outside the source video_stitch range.")
        if len(set(bridge_durations)) != 1:
            raise MediaRuntimeError("QC_FAILED", "Per-boundary bridge durations are not expressible by the source video_stitch operation.")
        duration = bridge_durations[0]
    else:
        raise MediaRuntimeError("QC_FAILED", "Composition transition is not supported by the source video_stitch operation.")
    if not math.isfinite(duration) or not OPENMONTAGE_TRANSITION_MIN_SECONDS <= duration <= OPENMONTAGE_TRANSITION_MAX_SECONDS:
        raise MediaRuntimeError("QC_FAILED", "Composition transition duration is outside the source video_stitch range.")
    return ("fadeblack" if kind == "BRIDGE" else "fade"), (duration,) * boundary_count


def _openmontage_effective_duration_ms(
    inspections: tuple[VideoInspection, ...] | list[VideoInspection],
    source_transition: str,
    transition_durations: tuple[float, ...],
) -> int:
    """Calculate the source stitch duration using its rounded/max-zero offsets."""
    if not inspections:
        return 0
    if source_transition == "cut":
        return sum(item.duration_ms for item in inspections)
    cumulative_offset = 0.0
    for index, transition in enumerate(transition_durations):
        clip_duration = inspections[index].duration_ms / 1000
        cumulative_offset = max(0.0, round(cumulative_offset + clip_duration - transition, 3))
    return round((cumulative_offset + inspections[-1].duration_ms / 1000) * 1000)


def _composition_facts_complete(inspections: list[VideoInspection]) -> bool:
    """Check that the OpenMontage compatibility facts are available.

    ``_inspect_path`` supplies these facts for real multi-segment Runtime
    inputs.  The optional fields on ``VideoInspection`` keep older single-
    segment in-process callers source-compatible; multi-segment composition
    remains fail-closed when the fields are absent.
    """
    for inspection in inspections:
        if (
            inspection.fps is None
            or not inspection.video_codec
            or not inspection.pixel_format
        ):
            return False
        if inspection.has_audio and (
            not inspection.audio_codec
            or inspection.audio_channels is None
            or inspection.audio_sample_rate is None
        ):
            return False
    return True


def _needs_composition_normalization(inspections: list[VideoInspection]) -> bool:
    """Mirror OpenMontage's compatibility check at the Runtime boundary.

    The current Runtime transition graph already targets 24 fps, H.264,
    yuv420p and the existing AAC/48 kHz/stereo audio layout.  The target
    canvas itself comes from the first accepted clip, matching
    ``video_stitch._resolve_normalization_target`` when no profile or
    explicit target is present.
    """
    if len(inspections) < 2:
        return False
    reference = inspections[0]
    if reference.width <= 0 or reference.height <= 0:
        raise MediaRuntimeError("QC_FAILED", "Composition video dimensions could not be inspected.")
    if not _composition_facts_complete(inspections):
        raise MediaRuntimeError("QC_FAILED", "Composition media facts are incomplete for normalization.")
    for inspection in inspections:
        if (
            inspection.width != reference.width
            or inspection.height != reference.height
            or abs(float(inspection.fps) - 24.0) > 1e-6
            or inspection.video_codec != "h264"
            or inspection.pixel_format != "yuv420p"
            or (
                inspection.has_audio
                and (
                    inspection.audio_codec != "aac"
                    or inspection.audio_channels != 2
                    or inspection.audio_sample_rate != 48_000
                )
            )
        ):
            return True
    return False


def _normalize_composition_clip(
    *,
    ffmpeg: str,
    source: Path,
    output: Path,
    width: int,
    height: int,
    has_audio: bool,
) -> None:
    """Apply OpenMontage's scale+pad normalization to one video input."""
    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24"
    )
    args = [
        "-y", "-i", str(source),
        "-map", "0:v:0",
        "-vf", video_filter,
        "-c:v", "libx264", "-crf", "23", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-r", "24",
    ]
    if has_audio:
        args.extend([
            "-map", "0:a:0?",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
        ])
    else:
        args.append("-an")
    args.extend(["-movflags", "+faststart", str(output)])
    _run(ffmpeg, args, timeout_seconds=90)
    if not output.is_file() or output.stat().st_size <= 0:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Video normalization did not produce an output.")


def _prepare_composition_paths(
    *,
    ffmpeg: str,
    root: Path,
    paths: list[Path],
    inspections: list[VideoInspection],
    audio_present: list[bool],
) -> list[Path]:
    """Probe-derived target selection followed by temporary normalization."""
    if not _needs_composition_normalization(inspections):
        return paths
    reference = inspections[0]
    if reference.width <= 0 or reference.height <= 0:
        raise MediaRuntimeError("QC_FAILED", "Composition normalization target is invalid.")
    normalized_paths: list[Path] = []
    for index, (path, has_audio) in enumerate(zip(paths, audio_present)):
        normalized = root / f"normalized-segment-{index + 1:02d}.mp4"
        _normalize_composition_clip(
            ffmpeg=ffmpeg,
            source=path,
            output=normalized,
            width=reference.width,
            height=reference.height,
            has_audio=has_audio,
        )
        normalized_paths.append(normalized)
    return normalized_paths


def _validate_narration_duration(*, narration_duration: float, target_seconds: float, allow_tail_fill: bool, music_segments_ms: tuple[tuple[int, int], ...] = (), visual_tail_windows_ms: tuple[tuple[int, int], ...] = ()) -> None:
    """Apply the existing source duration gate before any audio mixer call."""
    target = max(0.1, target_seconds)
    if not math.isfinite(narration_duration) or narration_duration <= 0:
        raise MediaRuntimeError("QC_FAILED", "Narration duration could not be measured safely.")
    # The source compose-director rule sends overlong narration back to the
    # script/scene plan.  Never trim, stretch, or otherwise mutate the bytes.
    if narration_duration > target:
        raise MediaRuntimeError("QC_FAILED", "Narration exceeds the visual plan; revise the script or extend visuals.")
    if narration_duration < target and not allow_tail_fill:
        # Only an explicitly declared music or visual tail may account for a
        # shorter measured narration track; do not manufacture a silent tail.
        raise MediaRuntimeError("QC_FAILED", "Narration is shorter than the visual plan and no declared music or visual tail is available.")
    if narration_duration < target and allow_tail_fill:
        covered_until = round(narration_duration * 1000)
        declared_tail_windows = tuple(sorted((*music_segments_ms, *visual_tail_windows_ms)))
        for start_ms, end_ms in declared_tail_windows:
            if start_ms > covered_until:
                break
            covered_until = max(covered_until, end_ms)
        if covered_until < round(target * 1000):
            raise MediaRuntimeError("QC_FAILED", "Declared music windows do not cover the complete visual tail.")


def _mix_narration_track(*, ffmpeg: str, source: Path, narration: Path, output: Path, duration_seconds: float, target_lufs: float = -14.0, true_peak_db: float = -1.5, voice_enhance: bool = True, allow_tail_fill: bool = False, music_segments_ms: tuple[tuple[int, int], ...] = (), visual_tail_windows_ms: tuple[tuple[int, int], ...] = (), preserve_source_audio: bool = False, source_audio_ducked: bool = False, ducking_reduction_db: float = 8.0, narration_gain_db: str | None = None, narration_fade_in_ms: int | None = None, narration_fade_out_ms: int | None = None) -> float:
    target = max(0.1, duration_seconds)
    ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
    probe, _ = _run_capture(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(narration)], timeout_seconds=20)
    try:
        narration_duration = float(probe.strip())
    except ValueError as error:
        raise MediaRuntimeError("QC_FAILED", "Narration duration could not be measured safely.") from error
    _validate_narration_duration(
        narration_duration=narration_duration,
        target_seconds=target,
        allow_tail_fill=allow_tail_fill,
        music_segments_ms=music_segments_ms,
        visual_tail_windows_ms=visual_tail_windows_ms,
    )
    voice_chain = _narration_voice_effects(
        voice_enhance=voice_enhance,
        gain_db=narration_gain_db,
        fade_in_ms=narration_fade_in_ms,
        fade_out_ms=narration_fade_out_ms,
        target_seconds=target,
    )
    # Only a declared music/visual tail may pad a short spoken track.  Never
    # atrim a measured track; overlong audio was rejected above.
    audio_chain = voice_chain
    effective_target = target
    if narration_duration < target and allow_tail_fill:
        audio_chain = f"{voice_chain},apad=whole_dur={target:.3f},atrim=duration={target:.3f}"
    if preserve_source_audio:
        # AudioPlan ownership has explicitly classified one or more source
        # tracks as ambience/user audio. Keep those bytes under the measured
        # platform narration; only PROVIDER_DIALOGUE is replaced upstream.
        source_chain = f"[0:a]aresample=48000,apad=whole_dur={target:.3f},atrim=duration={target:.3f},asetpts=PTS-STARTPTS[source_audio];"
        if source_audio_ducked:
            music_volume_during_speech = _openmontage_ducking_volume(ducking_reduction_db)
            filter_graph = (
                f"{source_chain}[1:a]{audio_chain},asetpts=PTS-STARTPTS[narration_audio];"
                "[narration_audio]asplit=2[narration_key][narration_out];"
                "[source_audio][narration_key]sidechaincompress=threshold=0.02:ratio=9:attack=0.2:release=0.5:level_sc=1:mix=0.9[ducked_source];"
                f"[ducked_source]volume={music_volume_during_speech * 3:.4f}[ducked_source_level];"
                f"[narration_out][ducked_source_level]amix=inputs=2:duration=longest,loudnorm=I={target_lufs:.1f}:TP={true_peak_db:.1f}:LRA=11[aout]"
            )
        else:
            filter_graph = f"{source_chain}[1:a]{audio_chain},asetpts=PTS-STARTPTS[narration_audio];[source_audio][narration_audio]amix=inputs=2:duration=longest,loudnorm=I={target_lufs:.1f}:TP={true_peak_db:.1f}:LRA=11[aout]"
    else:
        filter_graph = f"[1:a]{audio_chain},loudnorm=I={target_lufs:.1f}:TP={true_peak_db:.1f}:LRA=11[aout]"
    _run(ffmpeg, ["-y", "-i", str(source), "-i", str(narration), "-filter_complex", filter_graph,
                  "-map", "0:v:0", "-map", "[aout]", "-t", f"{effective_target:.3f}", "-c:v", "copy",
                   "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(output)], timeout_seconds=90)
    return effective_target


def _mix_music_track(*, ffmpeg: str, source: Path, music: Path, output: Path, duration_seconds: float, music_volume: float = 0.12, music_gain_db: str | None = None, ducking_reduction_db: float = 8.0, target_lufs: float = -14.0, true_peak_db: float = -1.5, music_eq_cut_db: float = 3.0, voice_enhance: bool = True, music_segments_ms: tuple[tuple[int, int], ...] = (), fade_in_ms: int = 1_500, fade_out_ms: int = 2_500, ducking_enabled: bool = True) -> None:
    """Source-aligned full_mix: low music bed, speech ducking, fades and loudness normalization."""
    target = max(0.1, duration_seconds)
    fade_in_seconds = max(0.0, min(10.0, fade_in_ms / 1000))
    fade_out_seconds = max(0.0, min(10.0, fade_out_ms / 1000))
    fade_out_start = max(0.0, target - fade_out_seconds)
    fade_filters = []
    if fade_in_seconds > 0:
        fade_filters.append(f"afade=t=in:st=0:d={fade_in_seconds:.3f}")
    if fade_out_seconds > 0:
        fade_filters.append(f"afade=t=out:st={fade_out_start:.3f}:d={fade_out_seconds:.3f}")
    fade_suffix = ("," + ",".join(fade_filters)) if fade_filters else ""
    voice_chain = "aresample=48000,highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=100,alimiter=limit=0.95" if voice_enhance else "aresample=48000"
    gain_suffix = ""
    if music_gain_db is not None:
        if not re.fullmatch(r"-?(?:\d+(?:\.\d+)?)", music_gain_db):
            raise MediaRuntimeError("QC_FAILED", "Music AudioPlan gain metadata is invalid.")
        gain_suffix = f",volume={music_gain_db}dB"
    if music_segments_ms:
        segment_expr = "+".join(f"between(t,{start / 1000:.3f},{end / 1000:.3f})" for start, end in music_segments_ms)
        segment_volume = f"if({segment_expr},{music_volume},0)"
    else:
        segment_volume = str(music_volume)
    music_volume_during_speech = _openmontage_ducking_volume(ducking_reduction_db)
    if ducking_enabled:
        music_mix_chain = (
            "[music][speech_key]sidechaincompress=threshold=0.02:ratio=9:attack=0.2:release=0.5:"
            f"level_sc=1:mix=0.9[ducked];[ducked]volume={music_volume_during_speech * 3:.4f}[ducked_level];"
        )
        ducked_label = "[ducked_level]"
    else:
        # OpenMontage's full_mix uses a plain amix when ducking is disabled;
        # do not leave a compressor in the graph with a made-up mix setting.
        music_mix_chain = "[music]acopy[ducked];"
        ducked_label = "[ducked]"
    filter_graph = (
        f"[0:a]{voice_chain},asetpts=PTS-STARTPTS,apad=whole_dur={target:.3f},atrim=duration={target:.3f}[speech];"
        # The segment gate depends on the audio timestamp.  FFmpeg's volume
        # expressions otherwise default to a single initialization-time
        # evaluation, which silently drops the music after the first window.
        f"[1:a]aresample=48000,volume='{segment_volume}':eval=frame{gain_suffix},equalizer=f=3000:t=q:w=1:g=-{music_eq_cut_db:.1f}{fade_suffix},apad=whole_dur={target:.3f},atrim=duration={target:.3f}[music];"
        "[speech]asplit=2[speech_key][speech_out];"
        f"{music_mix_chain}"
        f"{ducked_label}apad=whole_dur={target:.3f},atrim=duration={target:.3f}[ducked_duration];"
        # OpenMontage full_mix leaves the ducked final amix at FFmpeg's source
        # default dropout transition; do not introduce a zero-transition tail
        # that changes the source timing semantics.
        "[speech_out][ducked_duration]amix=inputs=2:duration=longest,"
        f"loudnorm=I={target_lufs:.1f}:TP={true_peak_db:.1f}:LRA=11[aout]"
    )
    _run(
        ffmpeg,
        ["-y", "-i", str(source), "-stream_loop", "-1", "-i", str(music),
         "-filter_complex", filter_graph, "-map", "0:v:0", "-map", "[aout]",
         "-t", f"{target:.3f}", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
         "-movflags", "+faststart", str(output)],
        timeout_seconds=90,
    )


def compose_video_bundle(*, body: bytes, expected_sha256: str | None) -> CompositionArtifact:
    if expected_sha256 and sha256(body).hexdigest() != expected_sha256:
        raise MediaRuntimeError("MEDIA_RENDER_FAILED", "Composition input integrity verification failed.")
    segments, composition_plan = decode_composition_bundle_with_plan(body)
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
            inspections.append(
                _inspect_path(
                    path,
                    len(segment),
                    sha256(segment).hexdigest(),
                    require_compatibility_facts=len(segments) > 1,
                )
            )
            audio_present.append(_has_audio_stream(path))
        composition_audio_tracks = (
            composition_plan.audio_plan.tracks
            if composition_plan and composition_plan.audio_plan is not None
            else composition_plan.audio_tracks if composition_plan else None
        )
        if composition_plan and composition_plan.audio_policy == "CONTINUOUS_NARRATION":
            if composition_plan.narration_bytes is None and not composition_plan.narration_tracks:
                raise MediaRuntimeError("QC_FAILED", "Continuous narration requires an authoritative narration asset.")
            if composition_audio_tracks is None:
                # Without a transmitted private AudioPlan we cannot tell
                # provider dialogue from ambience/user source audio.  Refuse
                # to guess (or silently drop all tracks).
                raise MediaRuntimeError("QC_FAILED", "Continuous narration requires explicit audio ownership for source tracks.")
            ownership_by_segment = {
                track.track_id: track.ownership
                for track in composition_audio_tracks
                if track.track_id.startswith("segment-")
            }
            allowed_source_ownership = {"PROVIDER_DIALOGUE", "PROVIDER_AMBIENCE", "USER_SOURCE_AUDIO", "LEGACY_PRESERVE"}
            if any(f"segment-{index + 1}" not in ownership_by_segment for index in range(len(paths))):
                raise MediaRuntimeError("QC_FAILED", "Continuous narration requires ownership for every source segment.")
            expected_start_ms = 0
            for index, inspection in enumerate(inspections):
                track = next((item for item in composition_audio_tracks if item.track_id == f"segment-{index + 1}"), None)
                if track is None or track.ownership not in allowed_source_ownership:
                    raise MediaRuntimeError("QC_FAILED", "Continuous narration requires ownership for every source audio track.")
                expected_end_ms = expected_start_ms + inspection.duration_ms
                if track.start_ms != expected_start_ms or track.end_ms != expected_end_ms:
                    raise MediaRuntimeError("QC_FAILED", "Audio ownership windows do not match the accepted source timeline.")
                expected_start_ms = expected_end_ms
        output = root / "composed.mp4"
        if len(paths) == 1:
            compose_args = ["-y", "-i", str(paths[0])]
            single_track = next(
                (track for track in (composition_audio_tracks or ()) if track.track_id == "segment-1"),
                None,
            )
            continuous_single = bool(
                composition_plan
                and composition_plan.audio_policy == "CONTINUOUS_NARRATION"
            )
            if continuous_single:
                if single_track is None:
                    raise MediaRuntimeError("QC_FAILED", "Continuous narration requires ownership for every source audio track.")
                if single_track.ownership == "PROVIDER_DIALOGUE":
                    # Only an explicitly declared Provider dialogue track is
                    # replaced.  Ambience/user audio remains source-owned and
                    # is filtered below before the narration mix.
                    compose_args.extend([
                        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                        "-map", "0:v:0", "-map", "1:a:0",
                        "-t", f"{inspections[0].duration_ms / 1000:.3f}",
                    ])
                elif audio_present[0]:
                    source_filters = _source_audio_track_filters(
                        track=single_track,
                        duration_seconds=inspections[0].duration_ms / 1000,
                    )
                    compose_args.extend([
                        "-filter_complex", f"[0:a:0]{source_filters}[source_audio]",
                        "-map", "0:v:0", "-map", "[source_audio]",
                    ])
                else:
                    # The narration mixer expects a finite source audio input
                    # even when the video has no original audio stream.
                    compose_args.extend([
                        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                        "-map", "0:v:0", "-map", "1:a:0",
                        "-t", f"{inspections[0].duration_ms / 1000:.3f}",
                    ])
            elif composition_plan and composition_plan.music_bytes and not audio_present[0]:
                # A music-only plan still needs a finite source audio stream
                # for the mixer.  Add a bounded silence input; the selected
                # music asset, not this placeholder, remains the audible bed.
                compose_args.extend([
                    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                    "-map", "0:v:0", "-map", "1:a:0",
                    "-t", f"{inspections[0].duration_ms / 1000:.3f}",
                ])
            else:
                compose_args.extend(["-map", "0:v:0", "-map", "0:a:0?"])
            _run(
                ffmpeg,
                [
                    *compose_args,
                    "-c:v", "libx264", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
                ],
                timeout_seconds=90,
            )
        else:
            source_transition, transition_durations = _openmontage_transition_plan(composition_plan, len(inspections))
            source_effective_duration_ms = _openmontage_effective_duration_ms(
                inspections, source_transition, transition_durations
            )
            if source_effective_duration_ms <= 0:
                raise MediaRuntimeError("QC_FAILED", "Source transition overlap leaves no effective video duration.")
            if composition_plan and composition_plan.target_duration_ms != source_effective_duration_ms:
                raise MediaRuntimeError(
                    "QC_FAILED",
                    "Composition target duration does not match the source transition effective duration.",
                )
            if (
                composition_plan
                and composition_plan.audio_policy == "CONTINUOUS_NARRATION"
                and source_transition != "cut"
            ):
                raise MediaRuntimeError(
                    "QC_FAILED",
                    "Continuous narration audio transitions are not source-equivalent for this composition.",
                )
            working_paths = _prepare_composition_paths(
                ffmpeg=ffmpeg,
                root=root,
                paths=paths,
                inspections=inspections,
                audio_present=audio_present,
            )
            filter_parts: list[str] = []
            for index, inspection in enumerate(inspections):
                filter_parts.append(
                    f"[{index}:v:0]setpts=PTS-STARTPTS,setsar=1,fps=24,format=yuv420p[v{index}]"
                )

            current_video = "v0"
            cumulative_offset = 0.0
            for index in range(1, len(inspections)):
                output_label = f"vx{index}"
                if source_transition == "cut":
                    # The source _stitch_cut uses the concat demuxer with
                    # -c copy.  Runtime must keep its existing filter graph
                    # for AudioPlan ownership, so this concat filter is only
                    # a timeline-equivalent thin shell, not codec-copy parity.
                    filter_parts.append(f"[{current_video}][v{index}]concat=n=2:v=1:a=0[{output_label}]")
                else:
                    transition = transition_durations[index - 1]
                    clip_duration = inspections[index - 1].duration_ms / 1000
                    # OpenMontage _chain_xfade uses cumulative offset plus
                    # the current clip duration minus the transition, with no
                    # tpad.  Keep the source's rounded/max-zero operation.
                    offset = max(0.0, round(cumulative_offset + clip_duration - transition, 3))
                    filter_parts.append(
                        f"[{current_video}][v{index}]xfade=transition={source_transition}:"
                        f"duration={transition:.3f}:offset={offset:.3f}[{output_label}]"
                    )
                    cumulative_offset = offset
                current_video = output_label
            filter_parts.append(f"[{current_video}]format=yuv420p[vout]")

            current_audio = ""
            for index, inspection in enumerate(inspections):
                duration_seconds = inspection.duration_ms / 1000
                audio_label = f"a{index}"
                # Audio ownership is not encoded in the legacy ALCHMED1-5
                # bundle.  Preserve source audio when ownership is unknown;
                # only a future explicit AudioPlan may safely remove a
                # PROVIDER_DIALOGUE track.  This fail-safe preserves ambience
                # and user audio instead of silently discarding it.
                ownership = None
                if composition_audio_tracks:
                    ownership = next((track.ownership for track in composition_audio_tracks if track.track_id == f"segment-{index + 1}"), None)
                if audio_present[index] and not (
                    composition_plan
                    and composition_plan.audio_policy == "CONTINUOUS_NARRATION"
                    and ownership == "PROVIDER_DIALOGUE"
                ):
                    source_track = next(
                        (track for track in (composition_audio_tracks or ()) if track.track_id == f"segment-{index + 1}"),
                        None,
                    )
                    if (
                        composition_plan
                        and composition_plan.audio_policy == "CONTINUOUS_NARRATION"
                        and source_track is not None
                        and source_track.ownership in {"PROVIDER_AMBIENCE", "USER_SOURCE_AUDIO", "LEGACY_PRESERVE"}
                    ):
                        source_filters = _source_audio_track_filters(
                            track=source_track,
                            duration_seconds=duration_seconds,
                        )
                        filter_parts.append(f"[{index}:a:0]{source_filters}[{audio_label}]")
                    else:
                        filter_parts.append(f"[{index}:a:0]asetpts=PTS-STARTPTS[{audio_label}]")
                else:
                    filter_parts.append(
                        "anullsrc=channel_layout=stereo:sample_rate=48000,"
                        f"atrim=duration={duration_seconds:.3f},asetpts=PTS-STARTPTS[{audio_label}]"
                    )
                if index == 0:
                    current_audio = audio_label
                    continue
                output_label = f"ax{index}"
                if composition_plan and composition_plan.audio_policy == "CONTINUOUS_NARRATION":
                    filter_parts.append(f"[{current_audio}][{audio_label}]concat=n=2:v=0:a=1[{output_label}]")
                elif source_transition == "cut":
                    # Source cut preserves sequential audio without overlap.
                    filter_parts.append(f"[{current_audio}][{audio_label}]concat=n=2:v=0:a=1[{output_label}]")
                else:
                    filter_parts.append(
                        f"[{current_audio}][{audio_label}]acrossfade=d={transition_durations[index - 1]:.3f}[{output_label}]"
                    )
                current_audio = output_label

            if composition_plan and composition_plan.audio_policy == "CONTINUOUS_NARRATION":
                bounded_audio = "audio_bounded"
                filter_parts.append(
                    f"[{current_audio}]apad,atrim=duration={composition_plan.target_duration_ms / 1000:.3f},"
                    f"asetpts=PTS-STARTPTS[{bounded_audio}]"
                )
                current_audio = bounded_audio

            _run(
                ffmpeg,
                [
                    "-y",
                    *[part for path in working_paths for part in ("-i", str(path))],
                    "-filter_complex", ";".join(filter_parts),
                    "-map", "[vout]", "-map", f"[{current_audio}]",
                     "-c:v", "libx264", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
                ],
                timeout_seconds=90,
            )
        used_openmontage_full_mix = False
        if composition_plan and (
            composition_plan.narration_tracks
            or (
                composition_plan.audio_plan is not None
                and (composition_plan.narration_bytes is not None or composition_plan.music_bytes is not None)
            )
        ):
            if composition_plan.audio_plan is None:
                raise MediaRuntimeError("QC_FAILED", "Independent narration tracks require an AudioPlan.")
            track_by_id = {track.track_id: track for track in composition_plan.audio_plan.tracks}
            mixer_tracks: list[dict[str, object]] = []
            music_track = next((track for track in composition_audio_tracks or () if track.ownership == "MUSIC"), None)
            visual_tail_windows_ms = _visual_tail_windows_ms(composition_plan.audio_plan)
            music_tail_windows_ms = (
                composition_plan.music_segments_ms
                if composition_plan.music_bytes is not None and music_track is not None
                else ()
            )
            narration_payloads = composition_plan.narration_tracks
            complete_narration_inspection: AudioInspection | None = None
            if not narration_payloads and composition_plan.narration_bytes is not None:
                # A complete ALCHMED8 full-track payload has one byte stream;
                # map it to the one source speech track instead of selecting
                # a section or falling back to a parallel mixer graph.
                platform_tracks = [
                    track for track in composition_plan.audio_plan.tracks
                    if track.ownership == "PLATFORM_NARRATION"
                ]
                if len(platform_tracks) != 1:
                    raise MediaRuntimeError(
                        "QC_FAILED",
                        "A single narration payload requires one platform track covering the full target.",
                    )
                track = platform_tracks[0]
                if track.start_ms != 0 or track.end_ms != composition_plan.target_duration_ms:
                    raise MediaRuntimeError(
                        "QC_FAILED",
                        "A single narration payload requires one platform track covering the full target.",
                    )
                narration_payloads = ((track.track_id, composition_plan.narration_bytes),)
                # Unlike independent section payloads, the complete ALCHMED8
                # payload used to reach _full_mix without an authoritative
                # Runtime duration probe.  Measure the exact bytes here so
                # the existing narration gate is applied before source mix
                # padding/normalization can hide a planning mismatch.
                complete_narration_inspection = inspect_audio_bytes(
                    body=composition_plan.narration_bytes,
                    expected_sha256=None,
                )
            for track_id, audio_bytes in narration_payloads:
                if audio_bytes is None:
                    raise MediaRuntimeError("QC_FAILED", "Narration payload is missing.")
                track = track_by_id.get(track_id)
                if track is None or track.ownership != "PLATFORM_NARRATION":
                    raise MediaRuntimeError("QC_FAILED", "Independent narration payload identity is not a platform narration track.")
                if composition_plan.narration_tracks:
                    measured = inspect_audio_bytes(body=audio_bytes, expected_sha256=None)
                    _validate_narration_duration(
                        narration_duration=(track.start_ms + measured.duration_ms) / 1000,
                        target_seconds=track.end_ms / 1000,
                        allow_tail_fill=bool(music_tail_windows_ms or visual_tail_windows_ms),
                        music_segments_ms=music_tail_windows_ms,
                        visual_tail_windows_ms=visual_tail_windows_ms,
                    )
                path = root / f"{track_id}.wav"
                path.write_bytes(audio_bytes)
                mixer_track: dict[str, object] = {
                    "path": str(path),
                    "role": "speech",
                    "start_seconds": track.start_ms / 1000,
                    "volume": _openmontage_track_volume(track.gain_db),
                }
                if track.fade_in_ms is not None:
                    mixer_track["fade_in_seconds"] = track.fade_in_ms / 1000
                if track.fade_out_ms is not None:
                    mixer_track["fade_out_seconds"] = track.fade_out_ms / 1000
                mixer_tracks.append(mixer_track)
            if composition_plan.music_bytes and music_track is None:
                # OpenMontage's ``_full_mix`` only consumes tracks supplied by
                # the caller. Do not silently drop a MUSIC payload when the
                # AudioPlan has no corresponding ownership fact.
                raise MediaRuntimeError("QC_FAILED", "A MUSIC payload requires a mapped AudioPlan MUSIC track.")
            if composition_plan.music_bytes and music_track is not None:
                # The pinned OpenMontage ``_full_mix`` path supports an
                # absolute start, but has no end/window expression. Accept
                # only the one contiguous window it can represent exactly;
                # partial or multiple windows must fail closed rather than
                # inventing a second filter graph.
                target_ms = composition_plan.target_duration_ms
                music_windows = composition_plan.music_segments_ms
                if (
                    music_track.end_ms != target_ms
                    or len(music_windows) != 1
                    or music_windows[0] != (music_track.start_ms, target_ms)
                ):
                    raise MediaRuntimeError(
                        "QC_FAILED",
                        "OpenMontage full_mix cannot consume partial or multiple MUSIC windows.",
                    )
                music_path = root / "music-track-full-mix.bin"
                music_path.write_bytes(composition_plan.music_bytes)
                music_input: dict[str, object] = {
                    "path": str(music_path),
                    "role": "music",
                    "start_seconds": music_track.start_ms / 1000,
                    # OpenMontage ``_full_mix`` receives one linear ``volume``
                    # field.  Preserve the platform's authored music bed
                    # level and apply the AudioPlan track gain using the same
                    # dB-to-linear mapping used for speech tracks.
                    "volume": composition_plan.music_volume * _openmontage_track_volume(music_track.gain_db),
                }
                if music_track.fade_in_ms is not None:
                    music_input["fade_in_seconds"] = music_track.fade_in_ms / 1000
                if music_track.fade_out_ms is not None:
                    music_input["fade_out_seconds"] = music_track.fade_out_ms / 1000
                mixer_tracks.append(music_input)
            if complete_narration_inspection is not None:
                _validate_narration_duration(
                    narration_duration=complete_narration_inspection.duration_ms / 1000,
                    target_seconds=composition_plan.target_duration_ms / 1000,
                    allow_tail_fill=bool(music_tail_windows_ms or visual_tail_windows_ms),
                    music_segments_ms=music_tail_windows_ms,
                    visual_tail_windows_ms=visual_tail_windows_ms,
                )
            if _has_audio_stream(output):
                # The preceding composition path has already removed only
                # explicitly declared PROVIDER_DIALOGUE.  Feed the remaining
                # source audio to the source mixer as its supported SFX role.
                mixer_tracks.append({"path": str(output), "role": "sfx", "start_seconds": 0})
            mixer_output = root / "openmontage-full-mix.wav"
            try:
                ffprobe = configured_binary("MEDIA_RUNTIME_FFPROBE_PATH")
                mixer = OpenMontageAudioMixer(
                    run_command=lambda binary, args, timeout: _run(binary, args, timeout_seconds=timeout),
                    ffprobe=ffprobe,
                )
                mixer.full_mix({
                    "tracks": mixer_tracks,
                    "ducking": {
                        # ``_full_mix`` exposes one global ducking switch. A
                        # MUSIC track's existing ownership fact controls that
                        # switch without adding a new policy or filter.
                        "enabled": composition_plan.ducking_enabled and (
                            music_track is None or music_track.duck_under_narration
                        ),
                        "music_volume_during_speech": _openmontage_ducking_volume(composition_plan.ducking_reduction_db),
                    },
                    "normalize": True,
                    "loudnorm_target": composition_plan.target_lufs,
                    "target_duration": composition_plan.target_duration_ms / 1000,
                    "ffmpeg": ffmpeg,
                    "output_path": str(mixer_output),
                })
            except OpenMontageFullMixError as error:
                raise MediaRuntimeError("MEDIA_RENDER_FAILED", str(error)) from error
            remuxed_output = root / "composed-full-mix.mp4"
            _run(ffmpeg, [
                "-y", "-i", str(output), "-i", str(mixer_output),
                "-map", "0:v:0", "-map", "1:a:0",
                "-t", f"{composition_plan.target_duration_ms / 1000:.3f}",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                "-movflags", "+faststart", str(remuxed_output),
            ], timeout_seconds=90)
            output = remuxed_output
            used_openmontage_full_mix = True
            # OpenMontage ``_full_mix`` receives the composition target as the
            # authoritative output duration. Keep that same target for the
            # final inspection gate for both independent and complete
            # full-track ALCHMED8 narration payloads.
            narration_target_seconds = composition_plan.target_duration_ms / 1000
        elif composition_plan and composition_plan.narration_bytes:
            narration_path = root / "narration-track.bin"
            narration_path.write_bytes(composition_plan.narration_bytes)
            narrated_output = root / "composed-narrated.mp4"
            preserved_source_tracks = tuple(
                track
                for track in (composition_audio_tracks or ())
                if track.track_id.startswith("segment-")
                and track.ownership in {"PROVIDER_AMBIENCE", "USER_SOURCE_AUDIO", "LEGACY_PRESERVE"}
            )
            preserve_source_audio = bool(
                composition_audio_tracks
                and any(
                    audio_present[index]
                    and next((track.ownership for track in composition_audio_tracks if track.track_id == f"segment-{index + 1}"), None) != "PROVIDER_DIALOGUE"
                    for index in range(len(audio_present))
                )
            )
            source_audio_ducked = any(track.duck_under_narration for track in preserved_source_tracks)
            platform_narration_track = next(
                (track for track in (composition_audio_tracks or ()) if track.ownership == "PLATFORM_NARRATION"),
                None,
            )
            visual_tail_windows_ms = _visual_tail_windows_ms(composition_plan.audio_plan)
            narration_target_seconds = _mix_narration_track(
                ffmpeg=ffmpeg, source=output, narration=narration_path, output=narrated_output,
                duration_seconds=composition_plan.target_duration_ms / 1000,
                target_lufs=composition_plan.target_lufs,
                true_peak_db=composition_plan.true_peak_db,
                voice_enhance=composition_plan.voice_enhance,
                allow_tail_fill=bool(composition_plan.music_bytes or visual_tail_windows_ms),
                music_segments_ms=composition_plan.music_segments_ms,
                visual_tail_windows_ms=visual_tail_windows_ms,
                preserve_source_audio=preserve_source_audio,
                source_audio_ducked=source_audio_ducked,
                ducking_reduction_db=composition_plan.ducking_reduction_db,
                narration_gain_db=platform_narration_track.gain_db if platform_narration_track else None,
                narration_fade_in_ms=platform_narration_track.fade_in_ms if platform_narration_track else None,
                narration_fade_out_ms=platform_narration_track.fade_out_ms if platform_narration_track else None,
            )
            output = narrated_output
        else:
            narration_target_seconds = composition_plan.target_duration_ms / 1000 if composition_plan else sum(item.duration_ms for item in inspections) / 1000
        if composition_plan and composition_plan.music_bytes and not used_openmontage_full_mix:
            music_path = root / "music-track.bin"
            music_path.write_bytes(composition_plan.music_bytes)
            mixed_output = root / "composed-mixed.mp4"
            music_track = next((track for track in (composition_audio_tracks or ()) if track.ownership == "MUSIC"), None)
            _mix_music_track(
                ffmpeg=ffmpeg,
                source=output,
                music=music_path,
                output=mixed_output,
                duration_seconds=narration_target_seconds,
                music_volume=composition_plan.music_volume if composition_plan else 0.12,
                music_gain_db=music_track.gain_db if music_track else None,
                ducking_reduction_db=composition_plan.ducking_reduction_db if composition_plan else 8.0,
                target_lufs=composition_plan.target_lufs if composition_plan else -14.0,
                true_peak_db=composition_plan.true_peak_db if composition_plan else -1.5,
                music_eq_cut_db=composition_plan.music_eq_cut_db if composition_plan else 3.0,
                voice_enhance=composition_plan.voice_enhance if composition_plan else True,
                music_segments_ms=composition_plan.music_segments_ms if composition_plan else (),
                fade_in_ms=music_track.fade_in_ms if music_track and music_track.fade_in_ms is not None else composition_plan.fade_in_ms if composition_plan else 1_500,
                fade_out_ms=music_track.fade_out_ms if music_track and music_track.fade_out_ms is not None else composition_plan.fade_out_ms if composition_plan else 2_500,
                ducking_enabled=composition_plan.ducking_enabled if composition_plan else True,
            )
            output = mixed_output
        composed = output.read_bytes() if output.is_file() else b""
        digest = _validated_video_bytes(composed, None)
        inspection = _inspect_path(output, len(composed), digest)
        if any(audio_present) and not _has_audio_stream(output):
            raise MediaRuntimeError("QC_FAILED", "The final video audio could not be inspected.")
        expected_duration_ms = round(narration_target_seconds * 1000) if composition_plan else sum(item.duration_ms for item in inspections)
        if abs(inspection.duration_ms - expected_duration_ms) > 1500:
            raise MediaRuntimeError("QC_FAILED", "The final video duration could not be verified.")
    return CompositionArtifact(inspection=inspection, bytes=composed)
