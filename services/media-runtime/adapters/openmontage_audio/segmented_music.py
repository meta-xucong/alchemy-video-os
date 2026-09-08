"""Source-faithful OpenMontage ``AudioMixer._segmented_music`` adapter.

The filter graph and FFmpeg argument order mirror
``upstream/openmontage/tools/audio/audio_mixer.py`` at commit
``4eab34c5cfcccaa4f1970554928feccce73ee930`` (``_segmented_music``, lines
669-775).  The platform supplies service-owned temporary paths and a
controlled command runner.  This module is intentionally a separate
operation; it is not a second input shape for ``_full_mix``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Callable


class OpenMontageSegmentedMusicError(ValueError):
    """A segmented-music precondition, probe, or FFmpeg execution failed."""


RunCommand = Callable[[str, list[str], int], str]


class OpenMontageSegmentedMusicMixer:
    """Minimal adapter for the source ``AudioMixer._segmented_music`` operation."""

    def __init__(self, *, run_command: RunCommand, ffprobe: str) -> None:
        self._run_command = run_command
        self._ffprobe = ffprobe

    def segmented_music(self, inputs: dict[str, Any]) -> Path:
        """Mix music into a video only during the declared source windows.

        ``video_path``, ``music_path``, ``music_volume``, ``segments``,
        ``fade_duration`` and ``output_path`` retain the source operation's
        names.  The caller owns workspace/storage/MIME/SHA authorization; this
        adapter only accepts existing service-owned paths and does not discover
        or fetch media.
        """

        video_path = self._existing_file(inputs.get("video_path"), "video")
        music_path = self._existing_file(inputs.get("music_path"), "music")
        output_path = self._output_path(inputs.get("output_path", "segmented_music_output.mp4"))

        raw_segments = inputs.get("segments", [])
        segments = self._validate_segments(raw_segments)
        music_volume = self._finite_number(inputs.get("music_volume", 0.20), "music_volume")
        if not 0 <= music_volume <= 1:
            raise OpenMontageSegmentedMusicError("music_volume is outside the supported range")

        fade_duration = self._finite_number(inputs.get("fade_duration", 0.5), "fade_duration")
        if fade_duration <= 0:
            # The source expression divides by fade_duration.  A zero value
            # therefore cannot be represented safely by this operation.
            raise OpenMontageSegmentedMusicError("fade_duration must be greater than zero")

        total_duration = self._probe_video_duration(video_path)
        ordered_segments = self._validate_segment_bounds(segments, total_duration)
        ffmpeg = inputs.get("ffmpeg", "ffmpeg")
        if not isinstance(ffmpeg, str) or not ffmpeg.strip():
            raise OpenMontageSegmentedMusicError("ffmpeg is invalid")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        volume_expression = self._volume_expression(
            ordered_segments,
            music_volume=music_volume,
            fade_duration=fade_duration,
        )
        filter_complex = (
            f"[1:a]atrim=0:{total_duration},asetpts=PTS-STARTPTS,"
            f"volume='{volume_expression}':eval=frame[music_shaped];"
            f"[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[speech];"
            f"[music_shaped]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[music_fmt];"
            "[speech][music_fmt]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"
        )
        command = [
            "-y",
            "-i", str(video_path),
            "-stream_loop", "-1",
            "-i", str(music_path),
            "-filter_complex", filter_complex,
            "-map", "0:v",
            "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            str(output_path),
        ]

        try:
            self._run_command(ffmpeg, command, 90)
        except OpenMontageSegmentedMusicError:
            raise
        except Exception as error:
            raise OpenMontageSegmentedMusicError("segmented music execution failed") from error

        try:
            output_size = output_path.stat().st_size if output_path.is_file() else 0
        except OSError as error:
            raise OpenMontageSegmentedMusicError("segmented music produced no output") from error
        if output_size <= 0:
            raise OpenMontageSegmentedMusicError("segmented music produced no output")
        return output_path

    @staticmethod
    def _existing_file(value: Any, label: str) -> Path:
        if not isinstance(value, (str, Path)) or not str(value).strip():
            raise OpenMontageSegmentedMusicError(f"{label} path is required")
        path = Path(value)
        if not path.is_file():
            raise OpenMontageSegmentedMusicError(f"{label} path is unavailable")
        return path

    @staticmethod
    def _output_path(value: Any) -> Path:
        if not isinstance(value, (str, Path)) or not str(value).strip():
            raise OpenMontageSegmentedMusicError("output path is required")
        return Path(value)

    @staticmethod
    def _finite_number(value: Any, label: str) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise OpenMontageSegmentedMusicError(f"{label} is invalid")
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise OpenMontageSegmentedMusicError(f"{label} is invalid") from error
        if not math.isfinite(number):
            raise OpenMontageSegmentedMusicError(f"{label} is invalid")
        return number

    @classmethod
    def _validate_segments(cls, value: Any) -> list[dict[str, float]]:
        if not isinstance(value, (list, tuple)) or not value:
            raise OpenMontageSegmentedMusicError("no segments specified")

        segments: list[dict[str, float]] = []
        for segment in value:
            if not isinstance(segment, Mapping):
                raise OpenMontageSegmentedMusicError("segment is invalid")
            if "start" not in segment or "end" not in segment:
                raise OpenMontageSegmentedMusicError("segment is invalid")
            start = cls._finite_number(segment["start"], "segment start")
            end = cls._finite_number(segment["end"], "segment end")
            if start < 0 or end <= start:
                raise OpenMontageSegmentedMusicError("segment range is invalid")
            segments.append({"start": start, "end": end})
        return segments

    @classmethod
    def _validate_segment_bounds(
        cls,
        segments: list[dict[str, float]],
        total_duration: float,
    ) -> list[dict[str, float]]:
        ordered = sorted(segments, key=lambda segment: segment["start"])
        for segment in ordered:
            if segment["end"] > total_duration:
                raise OpenMontageSegmentedMusicError("segment is outside the video duration")
        # OpenMontage's source operation intentionally joins each window's
        # volume expression with ``+``.  Preserve that additive behavior,
        # including overlapping windows; any stricter platform composition
        # invariant belongs at the Runtime plan boundary, not in this source
        # adapter.
        return ordered

    def _probe_video_duration(self, video_path: Path) -> float:
        command = [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            str(video_path),
        ]
        try:
            result = self._run_command(self._ffprobe, command, 20)
        except Exception as error:
            raise OpenMontageSegmentedMusicError("video duration probe failed") from error

        output = result
        if not isinstance(output, str) and hasattr(result, "stdout"):
            output = result.stdout
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        if not isinstance(output, str):
            raise OpenMontageSegmentedMusicError("video duration probe failed")
        try:
            duration = float(output.strip().splitlines()[0])
        except (IndexError, TypeError, ValueError, OverflowError) as error:
            raise OpenMontageSegmentedMusicError("video duration probe failed") from error
        if not math.isfinite(duration) or duration <= 0:
            raise OpenMontageSegmentedMusicError("video duration probe failed")
        return duration

    @staticmethod
    def _volume_expression(
        segments: list[dict[str, float]],
        *,
        music_volume: float,
        fade_duration: float,
    ) -> str:
        parts: list[str] = []
        for segment in segments:
            start = segment["start"]
            end = segment["end"]
            fade_in_end = start + fade_duration
            fade_out_start = end - fade_duration
            parts.append(
                f"if(lt(t,{start}),0,"
                f"if(lt(t,{fade_in_end}),{music_volume}*(t-{start})/{fade_duration},"
                f"if(lt(t,{fade_out_start}),{music_volume},"
                f"if(lt(t,{end}),{music_volume}*({end}-t)/{fade_duration},"
                "0))))"
            )
        return "+".join(f"({part})" for part in parts) if len(parts) > 1 else parts[0]


__all__ = ["OpenMontageSegmentedMusicError", "OpenMontageSegmentedMusicMixer"]
