"""Thin metadata/command adapters from OpenMontage audio tools."""

from .piper import PIPER_PACE_LENGTH_SCALES, PiperConfig, build_piper_command, length_scale_for_pace
from .selector import select_provider
from .hyperframes_audio import HyperFramesAudioResolution, OpenMontageHyperFramesAudio, OpenMontageHyperFramesAudioError
from .segmented_music import OpenMontageSegmentedMusicError, OpenMontageSegmentedMusicMixer

__all__ = [
    "PIPER_PACE_LENGTH_SCALES",
    "PiperConfig",
    "HyperFramesAudioResolution",
    "OpenMontageHyperFramesAudio",
    "OpenMontageHyperFramesAudioError",
    "OpenMontageSegmentedMusicError",
    "OpenMontageSegmentedMusicMixer",
    "build_piper_command",
    "length_scale_for_pace",
    "select_provider",
]
