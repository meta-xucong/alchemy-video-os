"""Source-shaped HyperFrames timed-audio adapter.

The resolver mirrors the audio portion of OpenMontage's
``HyperFramesCompose._resolve_audio_refs`` and its HTML ``<audio>`` contract
at the pinned source commit.  OpenMontage normally stages missing files and
silently skips unresolved asset ids; the platform cannot do either: callers
must provide already-authorized, workspace-local files whose existing asset
facts (scope, MIME, size, SHA and duration) are verified before this adapter
is called.

This module deliberately stops at the source audio references and timing
attributes.  It does not implement the HyperFrames renderer, style bridge,
registry blocks or a second public composition protocol.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from html import escape
import math
from pathlib import Path
import re
from typing import Any, Callable


class OpenMontageHyperFramesAudioError(ValueError):
    """A source audio reference or platform ownership fact is invalid."""


ProbeDuration = Callable[[Path], float]
_AUDIO_MIME_TYPES = frozenset({"audio/mpeg", "audio/ogg", "audio/wav"})
_AUDIO_ROLES = frozenset({"MUSIC", "NARRATION_SAMPLE", "USER_SOURCE_AUDIO"})
_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


@dataclass(frozen=True)
class HyperFramesAudioResolution:
    """Resolved source refs plus the source-shaped HTML audio fragment."""

    refs: dict[str, Any]
    html: str


class OpenMontageHyperFramesAudio:
    """Resolve independent authorized audio files for a HyperFrames timeline."""

    def __init__(self, *, probe_duration: ProbeDuration) -> None:
        self._probe_duration = probe_duration
        self._duration_cache: dict[Path, float] = {}

    def resolve(
        self,
        audio: dict[str, Any] | None,
        assets: list[dict[str, Any]],
        workspace: Path,
        *,
        total_duration: float,
        workspace_id: str | None = None,
        project_id: str | None = None,
    ) -> HyperFramesAudioResolution:
        """Resolve source narration/music refs and emit timed-audio HTML.

        ``audio`` and ``assets`` retain the source field names.  The platform
        boundary requires every referenced file to be present inside the
        controlled workspace and to match its persisted asset facts.  Missing
        or out-of-scope references therefore fail closed instead of following
        OpenMontage's workspace-copy and silent-``continue`` behavior.
        """
        root = self._workspace_root(workspace)
        total = self._finite_number(total_duration, "total_duration")
        if total <= 0:
            raise OpenMontageHyperFramesAudioError("total_duration must be greater than zero")
        if audio is None:
            audio = {}
        if not isinstance(audio, dict) or set(audio) - {"narration", "music"}:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio metadata is invalid")
        if not isinstance(assets, list):
            raise OpenMontageHyperFramesAudioError("HyperFrames asset manifest is invalid")

        asset_lookup: dict[str, dict[str, Any]] = {}
        for asset in assets:
            if not isinstance(asset, dict):
                raise OpenMontageHyperFramesAudioError("HyperFrames asset manifest is invalid")
            asset_id = asset.get("id")
            if not isinstance(asset_id, str) or not asset_id or asset_id in asset_lookup:
                raise OpenMontageHyperFramesAudioError("HyperFrames asset identity is invalid")
            asset_lookup[asset_id] = asset

        narration_refs = self._resolve_narration(
            audio.get("narration"),
            asset_lookup,
            root,
            total,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        music_ref = self._resolve_music(
            audio.get("music"),
            asset_lookup,
            root,
            total,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        refs: dict[str, Any] = {"narration": narration_refs, "music": music_ref}
        return HyperFramesAudioResolution(
            refs=refs,
            html=self.audio_html(refs, root, total_duration=total),
        )

    def _resolve_narration(
        self,
        narration: Any,
        asset_lookup: dict[str, dict[str, Any]],
        workspace: Path,
        total_duration: float,
        *,
        workspace_id: str | None,
        project_id: str | None,
    ) -> list[dict[str, Any]]:
        if narration is None:
            return []
        if not isinstance(narration, dict) or set(narration) - {"segments"}:
            raise OpenMontageHyperFramesAudioError("HyperFrames narration metadata is invalid")
        segments = narration.get("segments")
        if segments is None:
            return []
        if not isinstance(segments, list):
            raise OpenMontageHyperFramesAudioError("HyperFrames narration segments are invalid")

        refs: list[dict[str, Any]] = []
        for segment in segments:
            if not isinstance(segment, dict) or set(segment) - {"asset_id", "start_seconds", "end_seconds"}:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration segment is invalid")
            asset_id = segment.get("asset_id")
            if not isinstance(asset_id, str) or not asset_id:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration asset id is invalid")
            asset = asset_lookup.get(asset_id)
            if asset is None:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration asset is missing")
            path, duration = self._validate_asset(
                asset,
                workspace,
                expected_role="NARRATION",
                workspace_id=workspace_id,
                project_id=project_id,
            )
            start = self._finite_number(segment.get("start_seconds", 0), "narration start_seconds")
            raw_end = segment.get("end_seconds")
            if raw_end is None:
                end = None
            else:
                end_value = self._finite_number(raw_end, "narration end_seconds")
                # Source uses ``float(value or 0) or None``; preserve its
                # explicit-zero fallback to the composition duration.
                end = None if end_value == 0 else end_value
            if start < 0 or start >= total_duration:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration window is invalid")
            # OpenMontage derives a missing end from the composition duration;
            # retain that exact source behavior while still requiring a
            # positive, bounded resulting data-duration.
            resolved_end = total_duration if end is None else end
            if resolved_end <= start or resolved_end > total_duration:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration window is invalid")
            if duration < resolved_end - start:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration asset is shorter than its window")
            refs.append({
                "src": str(path),
                "start_seconds": start,
                "end_seconds": end,
            })
        return refs

    def _resolve_music(
        self,
        music: Any,
        asset_lookup: dict[str, dict[str, Any]],
        workspace: Path,
        total_duration: float,
        *,
        workspace_id: str | None,
        project_id: str | None,
    ) -> dict[str, Any] | None:
        if music is None:
            return None
        if not isinstance(music, dict) or set(music) - {"asset_id", "volume", "fade_in_seconds", "fade_out_seconds"}:
            raise OpenMontageHyperFramesAudioError("HyperFrames music metadata is invalid")
        asset_id = music.get("asset_id")
        if asset_id is None:
            return None
        if not isinstance(asset_id, str) or not asset_id:
            raise OpenMontageHyperFramesAudioError("HyperFrames music asset id is invalid")
        asset = asset_lookup.get(asset_id)
        if asset is None:
            raise OpenMontageHyperFramesAudioError("HyperFrames music asset is missing")
        path, duration = self._validate_asset(
            asset,
            workspace,
            expected_role="MUSIC",
            workspace_id=workspace_id,
            project_id=project_id,
        )
        # The source defaults use ``value or default``.  Preserve that detail,
        # including the source's 0-volume fallback to 0.15.
        volume = self._finite_number(music.get("volume") or 0.15, "music volume")
        fade_in = self._finite_number(music.get("fade_in_seconds") or 0, "music fade_in_seconds")
        fade_out = self._finite_number(music.get("fade_out_seconds") or 0, "music fade_out_seconds")
        # The existing platform MusicMix contract bounds authored volume to
        # [0, 1]; keep that boundary around the source's unbounded float.
        if volume < 0 or volume > 1 or fade_in < 0 or fade_out < 0 or duration < total_duration:
            raise OpenMontageHyperFramesAudioError("HyperFrames music metadata is invalid")
        return {
            "src": str(path),
            "volume": volume,
            "fade_in_seconds": fade_in,
            "fade_out_seconds": fade_out,
        }

    def _validate_asset(
        self,
        asset: dict[str, Any],
        workspace: Path,
        *,
        expected_role: str,
        workspace_id: str | None,
        project_id: str | None,
    ) -> tuple[Path, float]:
        if workspace_id is not None and asset.get("workspace_id") != workspace_id:
            raise OpenMontageHyperFramesAudioError("HyperFrames asset workspace is invalid")
        if project_id is not None and asset.get("project_id") != project_id:
            raise OpenMontageHyperFramesAudioError("HyperFrames asset project is invalid")
        role = asset.get("audio_role")
        if role is not None and (not isinstance(role, str) or role not in _AUDIO_ROLES):
            raise OpenMontageHyperFramesAudioError("HyperFrames audio role is invalid")
        if expected_role == "MUSIC":
            if role != "MUSIC":
                raise OpenMontageHyperFramesAudioError("HyperFrames music requires a server-owned MUSIC asset")
        elif role is not None:
            # Formal narration assets are intentionally unclassified in the
            # existing Asset.audio_role union; samples and user source audio
            # cannot be promoted by a HyperFrames reference.
            raise OpenMontageHyperFramesAudioError("HyperFrames narration cannot consume non-formal audio")

        raw_path = asset.get("path")
        if not isinstance(raw_path, (str, Path)) or not str(raw_path):
            raise OpenMontageHyperFramesAudioError("HyperFrames asset path is invalid")
        path = Path(raw_path)
        try:
            resolved = path.resolve(strict=True)
            resolved.relative_to(workspace.resolve())
        except (OSError, ValueError) as error:
            raise OpenMontageHyperFramesAudioError("HyperFrames asset path is outside the workspace") from error
        if not resolved.is_file():
            raise OpenMontageHyperFramesAudioError("HyperFrames asset file is missing")

        mime_type = asset.get("mime_type")
        if not isinstance(mime_type, str) or mime_type.lower() not in _AUDIO_MIME_TYPES:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio MIME is invalid")
        byte_size = asset.get("byte_size")
        if isinstance(byte_size, bool) or not isinstance(byte_size, int) or byte_size <= 0:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio byte size is invalid")
        digest = asset.get("sha256")
        if not isinstance(digest, str) or not _SHA256_PATTERN.fullmatch(digest):
            raise OpenMontageHyperFramesAudioError("HyperFrames audio SHA-256 is invalid")
        if resolved.stat().st_size != byte_size:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio byte size does not match")
        hasher = sha256()
        with resolved.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(chunk)
        if hasher.hexdigest() != digest:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio SHA-256 does not match")

        declared_duration_ms = asset.get("duration_ms")
        if isinstance(declared_duration_ms, bool) or not isinstance(declared_duration_ms, int) or declared_duration_ms <= 0:
            raw_duration = asset.get("duration_seconds")
            declared_duration = self._finite_number(raw_duration, "audio duration_seconds")
            if declared_duration <= 0:
                raise OpenMontageHyperFramesAudioError("HyperFrames audio duration is invalid")
            declared_duration_ms = round(declared_duration * 1000)
        probed = self._duration_for(resolved)
        if round(probed * 1000) != declared_duration_ms:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio ffprobe duration does not match")
        return resolved, probed

    def _duration_for(self, path: Path) -> float:
        if path not in self._duration_cache:
            try:
                value = float(self._probe_duration(path))
            except (OSError, TypeError, ValueError) as error:
                raise OpenMontageHyperFramesAudioError("HyperFrames audio duration probe failed") from error
            if not math.isfinite(value) or value <= 0:
                raise OpenMontageHyperFramesAudioError("HyperFrames audio duration probe is invalid")
            self._duration_cache[path] = value
        return self._duration_cache[path]

    @staticmethod
    def audio_html(refs: dict[str, Any], workspace: Path, *, total_duration: float) -> str:
        """Emit only the source HyperFrames root/audio timing attributes."""
        total = float(total_duration)
        if not math.isfinite(total) or total <= 0:
            raise OpenMontageHyperFramesAudioError("HyperFrames total duration is invalid")
        root = Path(workspace).resolve()
        tags: list[str] = []
        for index, narration in enumerate(refs.get("narration") or []):
            start = float(narration["start_seconds"])
            end = narration.get("end_seconds")
            duration = (float(end) - start) if end is not None and float(end) > start else total - start
            if not math.isfinite(start) or not math.isfinite(duration) or start < 0 or duration <= 0 or start + duration > total:
                raise OpenMontageHyperFramesAudioError("HyperFrames narration timing is invalid")
            src = OpenMontageHyperFramesAudio._relative_source(narration["src"], root)
            tags.append(
                f'<audio id="nar-{index}" data-start="{OpenMontageHyperFramesAudio._format(start)}" '
                f'data-duration="{OpenMontageHyperFramesAudio._format(duration)}" data-track-index="2" '
                f'src="{escape(src, quote=True)}" data-volume="1"></audio>'
            )
        music = refs.get("music")
        if music:
            volume = float(music["volume"])
            if not math.isfinite(volume):
                raise OpenMontageHyperFramesAudioError("HyperFrames music volume is invalid")
            src = OpenMontageHyperFramesAudio._relative_source(music["src"], root)
            tags.append(
                f'<audio id="music" data-start="0" data-duration="{OpenMontageHyperFramesAudio._format(total)}" '
                f'data-track-index="3" src="{escape(src, quote=True)}" '
                f'data-volume="{OpenMontageHyperFramesAudio._format(volume)}"></audio>'
            )
        return (
            f'<div data-composition-id="root" data-start="0" '
            f'data-duration="{OpenMontageHyperFramesAudio._format(total)}">'
            + "".join(tags)
            + "</div>"
        )

    @staticmethod
    def _relative_source(raw_path: str | Path, workspace: Path) -> str:
        try:
            resolved = Path(raw_path).resolve(strict=True)
            relative = resolved.relative_to(workspace)
        except (OSError, ValueError) as error:
            raise OpenMontageHyperFramesAudioError("HyperFrames audio source is outside the workspace") from error
        if not resolved.is_file():
            raise OpenMontageHyperFramesAudioError("HyperFrames audio source is missing")
        return relative.as_posix()

    @staticmethod
    def _workspace_root(workspace: Path) -> Path:
        try:
            root = Path(workspace).resolve(strict=True)
        except OSError as error:
            raise OpenMontageHyperFramesAudioError("HyperFrames workspace is unavailable") from error
        if not root.is_dir():
            raise OpenMontageHyperFramesAudioError("HyperFrames workspace is invalid")
        return root

    @staticmethod
    def _finite_number(value: Any, field: str) -> float:
        if isinstance(value, bool):
            raise OpenMontageHyperFramesAudioError(f"{field} is invalid")
        try:
            number = float(value)
        except (TypeError, ValueError) as error:
            raise OpenMontageHyperFramesAudioError(f"{field} is invalid") from error
        if not math.isfinite(number):
            raise OpenMontageHyperFramesAudioError(f"{field} is invalid")
        return number

    @staticmethod
    def _format(value: float) -> str:
        return f"{float(value):.3f}".rstrip("0").rstrip(".")


__all__ = [
    "HyperFramesAudioResolution",
    "OpenMontageHyperFramesAudio",
    "OpenMontageHyperFramesAudioError",
]
