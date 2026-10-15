"""Test-only media binary selection; no Runtime media behavior lives here."""

import os
from pathlib import Path
import platform
import shutil
import sys
import unittest


def media_tool_paths(
    root: Path,
    *,
    ffmpeg_override: str | None = None,
    ffprobe_override: str | None = None,
) -> tuple[Path, Path]:
    """Resolve the lockfile-installed media binaries on the current platform."""
    suffix = ".exe" if sys.platform == "win32" else ""
    package_store = root / "node_modules" / ".pnpm"
    ffmpeg_candidates = sorted(package_store.glob("ffmpeg-static@*/node_modules/ffmpeg-static/ffmpeg*"))
    # ffprobe-static 3.1.0/index.js selects bin/<os.platform>/<os.arch>.
    # Its npm archive contains other platforms too; never pick their binaries.
    machine = platform.machine().lower()
    node_arch = {
        "x86_64": "x64", "amd64": "x64", "aarch64": "arm64",
        "i386": "ia32", "i686": "ia32", "armv7l": "arm", "armv6l": "arm",
    }.get(machine, machine)
    ffprobe_candidates = sorted(package_store.glob(
        f"ffprobe-static@*/node_modules/ffprobe-static/bin/{sys.platform}/{node_arch}/ffprobe*"
    ))
    ffmpeg = Path(ffmpeg_override) if ffmpeg_override is not None else next(
        (path for path in ffmpeg_candidates if path.name == f"ffmpeg{suffix}" and path.is_file()), None
    )
    ffprobe = Path(ffprobe_override) if ffprobe_override is not None else next(
        (path for path in ffprobe_candidates if path.name == f"ffprobe{suffix}" and path.is_file()), None
    )
    if ffmpeg is None:
        found = shutil.which("ffmpeg")
        ffmpeg = Path(found) if found else None
    if ffprobe is None:
        found = shutil.which("ffprobe")
        ffprobe = Path(found) if found else None
    if ffmpeg is None or ffprobe is None:
        message = "FFmpeg/ffprobe are required for media integration fixtures."
        if os.environ.get("CI", "").lower() == "true":
            raise AssertionError(message)
        raise unittest.SkipTest(message)
    return ffmpeg, ffprobe
