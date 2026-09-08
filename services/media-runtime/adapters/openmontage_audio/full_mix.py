"""Source-faithful OpenMontage ``AudioMixer.full_mix`` adapter.

The filter graph and track scheduling below are intentionally kept equivalent
to ``upstream/openmontage/tools/audio/audio_mixer.py`` at the pinned source
commit.  The platform supplies only bounded temporary paths and a controlled
command runner; it does not expose OpenMontage's project/event filesystem.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


class OpenMontageFullMixError(ValueError):
    """A source ``full_mix`` precondition or FFmpeg execution failed."""


RunCommand = Callable[[str, list[str], int], str]


class OpenMontageAudioMixer:
    """Minimal adapter for the source ``AudioMixer._full_mix`` operation."""

    def __init__(self, *, run_command: RunCommand, ffprobe: str) -> None:
        self._run_command = run_command
        self._ffprobe = ffprobe

    def _track_filters(self, track: dict[str, Any]) -> list[str]:
        """Apply source-local fades before the source absolute delay."""
        filters: list[str] = []
        volume = track.get("volume", 1.0)
        delay_ms = int(track.get("start_seconds", 0) * 1000)
        fade_in = track.get("fade_in_seconds", 0)
        fade_out = track.get("fade_out_seconds", 0)

        if volume != 1.0:
            filters.append(f"volume={volume}")
        if fade_in > 0:
            filters.append(f"afade=t=in:d={fade_in}")
        if fade_out > 0:
            duration_cmd = [
                "-v", "error", "-show_entries", "format=duration",
                "-of", "csv=p=0", track["path"],
            ]
            duration = float(self._run_command(self._ffprobe, duration_cmd, 20).strip().split("\n")[0])
            fade_start = max(0.0, duration - float(fade_out))
            filters.append(f"afade=t=out:st={fade_start}:d={fade_out}")
        if delay_ms > 0:
            filters.append(f"adelay={delay_ms}|{delay_ms}")
        return filters

    @staticmethod
    def _loudnorm_filter(inputs: dict[str, Any], in_label: str, out_label: str) -> str:
        target = inputs.get("loudnorm_target", -16)
        try:
            target = float(target)
        except (TypeError, ValueError):
            target = -16.0
        target = max(-40.0, min(0.0, target))
        return f"[{in_label}]loudnorm=I={target}:LRA=11:TP=-1.5[{out_label}]"

    def full_mix(self, inputs: dict[str, Any]) -> Path:
        """Run the pinned source ``_full_mix`` filter graph."""
        tracks = inputs.get("tracks", [])
        if not tracks:
            raise OpenMontageFullMixError("No tracks provided for full_mix")

        output_path = Path(inputs["output_path"])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        normalize = inputs.get("normalize", True)
        ducking = inputs.get("ducking", {"enabled": True})
        target_duration = inputs.get("target_duration")
        target: float | None = None
        if target_duration is not None:
            try:
                target = float(target_duration)
            except (TypeError, ValueError) as error:
                raise OpenMontageFullMixError("target_duration must be a positive number") from error
            if target <= 0:
                raise OpenMontageFullMixError("target_duration must be greater than zero")

        speech_tracks = [t for t in tracks if t.get("role") in ("speech", "primary")]
        music_tracks = [t for t in tracks if t.get("role") in ("music", "secondary")]
        sfx_tracks = [t for t in tracks if t.get("role") == "sfx"]
        all_tracks = speech_tracks + music_tracks + sfx_tracks
        if not all_tracks:
            raise OpenMontageFullMixError("No valid tracks (need speech/music/sfx roles)")

        for track in all_tracks:
            if not Path(track["path"]).exists():
                raise OpenMontageFullMixError(f"Track not found: {track['path']}")

        input_args: list[str] = []
        filter_parts: list[str] = []
        for index, track in enumerate(all_tracks):
            input_args.extend(["-i", track["path"]])
            filters = self._track_filters(track)
            if filters:
                filter_parts.append(f"[{index}:a]{','.join(filters)}[a{index}]")
            else:
                filter_parts.append(f"[{index}:a]acopy[a{index}]")

        duck_enabled = ducking.get("enabled", True) if isinstance(ducking, dict) else bool(ducking)
        if duck_enabled and speech_tracks and music_tracks:
            speech_indices = list(range(len(speech_tracks)))
            speech_labels = "".join(f"[a{i}]" for i in speech_indices)
            if len(speech_tracks) > 1:
                filter_parts.append(f"{speech_labels}amix=inputs={len(speech_tracks)}:duration=longest[speech_all]")
            else:
                filter_parts.append(f"[a{speech_indices[0]}]acopy[speech_all]")
            if target is not None:
                filter_parts.append("[speech_all]asplit=2[speech_key_raw][speech_out]")
                filter_parts.append(
                    f"[speech_key_raw]apad=whole_dur={target},atrim=duration={target},asetpts=PTS-STARTPTS[speech_key]"
                )
            else:
                filter_parts.append("[speech_all]asplit=2[speech_key][speech_out]")

            music_start = len(speech_tracks)
            music_indices = list(range(music_start, music_start + len(music_tracks)))
            music_labels = "".join(f"[a{i}]" for i in music_indices)
            if len(music_tracks) > 1:
                filter_parts.append(f"{music_labels}amix=inputs={len(music_tracks)}:duration=longest[music_mix]")
                music_in = "[music_mix]"
            else:
                music_in = f"[a{music_indices[0]}]"

            duck_params = ducking if isinstance(ducking, dict) else {}
            attack = duck_params.get("attack_ms", 200) / 1000
            release = duck_params.get("release_ms", 500) / 1000
            music_vol = duck_params.get("music_volume_during_speech", 0.15)
            filter_parts.append(
                f"{music_in}[speech_key]sidechaincompress=threshold=0.02:ratio=9:attack={attack}:release={release}:"
                f"level_sc=1:mix=0.9[ducked_music];[ducked_music]volume={music_vol * 3}[music_out]"
            )
            mix_label = "[speech_out][music_out]amix=inputs=2:duration=longest[premix]"
            sfx_start = len(speech_tracks) + len(music_tracks)
            if sfx_tracks:
                sfx_labels = "".join(f"[a{i}]" for i in range(sfx_start, sfx_start + len(sfx_tracks)))
                filter_parts.append(mix_label.replace("[premix]", "[pressfx]"))
                filter_parts.append(f"[pressfx]{sfx_labels}amix=inputs={1 + len(sfx_tracks)}:duration=longest[premix]")
            else:
                filter_parts.append(mix_label)
        else:
            all_labels = "".join(f"[a{i}]" for i in range(len(all_tracks)))
            filter_parts.append(f"{all_labels}amix=inputs={len(all_tracks)}:duration=longest:dropout_transition=2[premix]")

        premix_label = "premix"
        if target is not None:
            filter_parts.append(f"[premix]apad=whole_dur={target},atrim=duration={target},asetpts=PTS-STARTPTS[premix_duration]")
            premix_label = "premix_duration"

        if normalize:
            filter_parts.append(self._loudnorm_filter(inputs, premix_label, "out"))
            out_label = "[out]"
        else:
            out_label = f"[{premix_label}]"

        command = ["-y", *input_args, "-filter_complex", ";".join(part for part in filter_parts if part), "-map", out_label]
        if target is not None:
            command.extend(["-t", str(target)])
        command.append(str(output_path))
        self._run_command(inputs["ffmpeg"], command, 90)
        return output_path
