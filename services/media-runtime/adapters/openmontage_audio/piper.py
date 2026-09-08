"""Thin adapter for OpenMontage tools/audio/piper_tts.py.

Source: calesthio/OpenMontage @ 4eab34c5cfcccaa4f1970554928feccce73ee930.
Only command/parameter semantics are reused; execution remains local and
fail-closed in runtime.py.
"""
from dataclasses import dataclass
from pathlib import Path


# OpenMontage exposes Piper's numeric ``length_scale`` directly rather than
# defining a symbolic pace protocol. Keep only the upstream default here:
# platform-level SLOW/FAST labels have no source-backed numeric mapping and
# must remain fail-closed until a provider profile supplies one.
PIPER_PACE_LENGTH_SCALES: dict[str, float] = {
    "NATURAL": 1.0,
}


def length_scale_for_pace(pace: str) -> float:
    try:
        return PIPER_PACE_LENGTH_SCALES[pace]
    except KeyError as error:
        raise ValueError(f"Unsupported Piper pace: {pace}") from error

@dataclass(frozen=True)
class PiperConfig:
    model: Path
    # Piper reads the adjacent .onnx.json sidecar from --model.  Keep the
    # path in the private config for runtime availability checks, but do not
    # invent an upstream --config flag.
    config: Path | None = None
    speaker_id: int = 0
    length_scale: float = 1.0
    sentence_silence: float = 0.3

def build_piper_command(config: PiperConfig, output_path: Path) -> list[str]:
    """Build the OpenMontage Piper CLI arguments; narration text is stdin."""
    return [
        "--model", str(config.model),
        "--speaker", str(config.speaker_id),
        "--length-scale", str(config.length_scale),
        "--sentence-silence", str(config.sentence_silence),
        "--output_file", str(output_path),
    ]
