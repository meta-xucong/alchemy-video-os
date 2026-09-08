"""Thin adapter for OpenMontage ``tools/audio/pixabay_music.py``.

Source: calesthio/OpenMontage @ 4eab34c5cfcccaa4f1970554928feccce73ee930.
The page/bootstrap lookup, HTML fallback, duration filter, first-result
selection and MP3 download are copied from the source tool.  The Runtime
caller supplies a controlled temporary output path instead of accepting a
platform/browser filesystem path.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PixabayMusicResult:
    track: dict[str, Any]
    output_path: Path
    results_found: int
    results_after_filter: int


class PixabayMusic:
    """Source-aligned synchronous Pixabay Music scraper."""

    _USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )
    _BROWSER_HEADERS = {
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;"
            "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

    def execute(self, inputs: dict[str, Any]) -> PixabayMusicResult:
        # This is the source execute sequence: search, duration filter with
        # unfiltered fallback, first match, then download.
        tracks = self._search(inputs)
        if not tracks:
            raise RuntimeError(f"No music found on Pixabay for query: {inputs['query']}")
        min_duration = inputs.get("min_duration", 30)
        max_duration = inputs.get("max_duration", 120)
        filtered = [
            track for track in tracks
            if track.get("duration") is not None
            and min_duration <= track["duration"] <= max_duration
        ]
        if not filtered:
            filtered = tracks
        track = filtered[0]
        output_path = self._download(track, inputs)
        return PixabayMusicResult(
            track=track,
            output_path=output_path,
            results_found=len(tracks),
            results_after_filter=len(filtered),
        )

    def _build_opener(self) -> urllib.request.OpenerDirector:
        import http.cookiejar

        return urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def _search(self, inputs: dict[str, Any]) -> list[dict[str, Any]]:
        query = inputs["query"]
        slug = re.sub(r"\s+", "-", query.strip().lower())
        slug = urllib.parse.quote(slug, safe="-")
        search_url = f"https://pixabay.com/music/search/{slug}/"
        opener = self._build_opener()
        request = urllib.request.Request(search_url)
        request.add_header("User-Agent", self._USER_AGENT)
        for key, value in self._BROWSER_HEADERS.items():
            request.add_header(key, value)
        with opener.open(request, timeout=30) as response:
            html = response.read().decode("utf-8", errors="replace")
        tracks = self._parse_bootstrap(html, search_url, opener)
        return tracks if tracks else self._parse_tracks_html(html)

    def _parse_bootstrap(
        self,
        html: str,
        referer: str,
        opener: urllib.request.OpenerDirector,
    ) -> list[dict[str, Any]]:
        match = re.search(r'window\.__BOOTSTRAP_URL__\s*=\s*["\']([^"\']+)["\']', html)
        if not match or not match.group(1):
            return []
        bootstrap_path = match.group(1)
        bootstrap_url = f"https://pixabay.com{bootstrap_path}"
        request = urllib.request.Request(bootstrap_url)
        request.add_header("User-Agent", self._USER_AGENT)
        request.add_header("Accept", "application/json, text/plain, */*")
        request.add_header("Referer", referer)
        request.add_header("Sec-Fetch-Dest", "empty")
        request.add_header("Sec-Fetch-Mode", "cors")
        request.add_header("Sec-Fetch-Site", "same-origin")
        try:
            with opener.open(request, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
        except Exception:
            return []
        results = data.get("page", {}).get("results", [])
        tracks: list[dict[str, Any]] = []
        for item in results:
            sources = item.get("sources", {})
            audio_url = sources.get("src")
            if not audio_url:
                continue
            user = item.get("user", {}) or {}
            tracks.append({
                "title": item.get("name") or sources.get("filename", "Unknown"),
                "audio_url": audio_url,
                "duration": item.get("duration"),
                "artist": user.get("username", "Unknown"),
                "rating": item.get("rating"),
                "download_count": item.get("downloadCount"),
                "pixabay_id": item.get("id"),
            })
        return tracks

    def _parse_tracks_html(self, html: str) -> list[dict[str, Any]]:
        tracks: list[dict[str, Any]] = []
        mp3_urls = re.findall(
            r"(https?://cdn\.pixabay\.com/audio/[^\s\"'<>]+\.mp3[^\s\"'<>]*)",
            html,
        )
        seen: set[str] = set()
        for url in mp3_urls:
            if url in seen:
                continue
            seen.add(url)
            tracks.append({"title": "Unknown", "audio_url": url, "duration": None, "artist": "Unknown"})
        return tracks

    def _download(self, track: dict[str, Any], inputs: dict[str, Any]) -> Path:
        audio_url = track.get("audio_url")
        if not audio_url:
            raise RuntimeError("No audio URL found for the selected track.")
        if audio_url.startswith("//"):
            audio_url = "https:" + audio_url
        elif audio_url.startswith("/"):
            audio_url = "https://pixabay.com" + audio_url
        parsed_url = urllib.parse.urlparse(audio_url)
        if parsed_url.scheme != "https" or parsed_url.hostname != "cdn.pixabay.com":
            raise RuntimeError("Pixabay returned an unsupported audio URL.")
        track_title = track.get("title", "pixabay_music")
        safe_title = "".join(
            character if character.isalnum() or character in "._- " else "_"
            for character in str(track_title)
        )
        default_filename = f"pixabay_music_{safe_title[:60]}.mp3"
        output_path = Path(inputs.get("output_path", default_filename))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(
            audio_url,
            headers={"User-Agent": self._USER_AGENT, "Referer": "https://pixabay.com/music/"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.headers.get_content_type().lower() != "audio/mpeg":
                raise RuntimeError("Pixabay returned unsupported audio MIME.")
            output_path.write_bytes(response.read())
        return output_path
