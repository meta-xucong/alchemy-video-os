import argparse
import json
import math
import re
import struct
import sys
import tempfile
import wave
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


RESULT_PREFIX = "C12_STUDIO_UI_E2E_RESULT="


def create_music_fixture(directory: str) -> Path:
    """Create the existing local MUSIC upload fixture without a network source."""
    path = Path(directory) / "c12-music.wav"
    sample_rate = 8_000
    duration_seconds = 30
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        frames = b"".join(
            struct.pack("<h", int(6_000 * math.sin(2 * math.pi * 440 * index / sample_rate)))
            for index in range(sample_rate * duration_seconds)
        )
        output.writeframes(frames)
    return path


def wait_for_final_video(page):
    try:
        # The source-aligned OpenMontage final-review path may run the
        # controlled local transcriber on CPU.  Keep the browser assertion
        # within the Runtime client's bounded request window instead of
        # treating that legitimate review latency as a UI failure.
        page.get_by_role("heading", name="完整成片已准备好", exact=True).wait_for(timeout=120_000)
    except Exception as error:
        diagnostic = page.evaluate(
            """async () => {
              const projectId = location.pathname.split('/').at(-1);
              const response = await fetch(`/api/v1/projects/${projectId}/production-runs`);
              return { status: response.status, body: await response.text(), text: document.body.innerText.slice(0, 3000) };
            }"""
        )
        raise AssertionError(f"C12 final-video view did not refresh: {diagnostic}") from error


def assert_mobile_layout(page, project_url, project_name):
    page.goto(project_url, wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    wait_for_final_video(page)
    layout = page.evaluate(
        """() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll('button, input:not([type=file]), textarea')]
            .filter((element) => !element.closest('details:not([open])'))
            .filter((element) => {
              const style = getComputedStyle(element);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            })
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right, label: element.getAttribute('aria-label') || element.textContent?.trim() || element.id };
            }),
        })"""
    )
    if layout["scrollWidth"] > layout["width"]:
        raise AssertionError(f"C12 mobile layout has horizontal overflow: {layout}")
    for control in layout["controls"]:
        if control["left"] < 0 or control["right"] > layout["width"]:
            raise AssertionError(f"C12 mobile control overflows the viewport: layout={layout}, control={control}")


def create_plan_and_verify_final_video(page, studio_origin, project_name, browser):
    page.goto(f"{studio_origin}/projects", wait_until="domcontentloaded")
    page.get_by_role("heading", name="我的项目", exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="新建项目", exact=True).first.click()
    page.get_by_label("给这项创作起个名字", exact=True).fill(project_name)
    page.get_by_role("button", name="创建并进入", exact=True).click()
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)

    project_path = urlparse(page.url).path
    project_match = re.fullmatch(r"/projects/(prj_[0-9A-HJKMNP-TV-Z]{26})", project_path)
    if not project_match:
        raise AssertionError(f"C12 Studio project creation did not navigate to a project URL: {page.url}")
    project_id = project_match.group(1)
    post_paths = []

    def record_request(request):
        if request.method != "POST":
            return
        parsed = urlparse(request.url)
        if parsed.netloc == urlparse(studio_origin).netloc and parsed.path.startswith("/api/v1/"):
            post_paths.append(parsed.path)

    page.on("request", record_request)
    page.get_by_label("把想法、故事或小说情节写在这里", exact=True).fill(
        "".join([f"第{index}个叙事事件推动故事向前。" for index in range(1, 19)])
    )
    page.locator("#story-duration").fill("30")
    page.locator("#story-resolution-480p").check()
    page.locator("#story-style").fill("真实纪录感，克制的暖色灯光")
    page.get_by_text("预计生成 2 段视频", exact=True).wait_for(timeout=10_000)
    estimate_items = page.locator('ol[aria-label="预计生成片段"] > li')
    if estimate_items.count() != 2:
        raise AssertionError("C12 Studio did not show the expected two pre-generation video segments for a 30-second story.")
    for index in range(2):
        estimate_text = estimate_items.nth(index).inner_text()
        if f"第 {index + 1} 段" not in estimate_text or "约 15 秒" not in estimate_text:
            raise AssertionError(f"C12 Studio showed an unexpected pre-generation segment estimate: {estimate_text!r}")
    # The Mock video fixture is intentionally video-only.  Upload the
    # existing server-owned MUSIC path so the final-review audio gate is
    # exercised without weakening the no-audio/explicit-OFF contract.
    with tempfile.TemporaryDirectory(prefix="alchemy-c12-music-") as directory:
        music_fixture = create_music_fixture(directory)
        page.locator('input[type="file"][accept="audio/mpeg,audio/wav,audio/ogg"]').set_input_files(str(music_fixture))
        page.wait_for_function(
            "() => { const input = document.querySelector('input[type=\"radio\"][value=\"MANUAL\"]'); return input && !input.disabled && input.checked; }",
            timeout=60_000,
        )
    page.get_by_role("button", name="开始生成视频", exact=True).click()
    wait_for_final_video(page)
    if not page.locator("#story-resolution-480p").is_checked():
        raise AssertionError("C12 Studio did not retain the selected 480p resolution for the completed production.")
    if page.locator('ol[aria-label="制作细节"] > li').count() != 2:
        raise AssertionError("C12 18-beat / 30-second narrative did not create two executable generation segments.")

    result_button = page.get_by_role("button", name="查看完整成片 01", exact=True)
    result_button.wait_for(timeout=30_000)
    result_button.click()
    video = page.locator(".project-results-panel video")
    video.wait_for(timeout=30_000)
    if video.get_attribute("autoplay") is not None:
        raise AssertionError("C12 final-video player unexpectedly starts playback after a project refresh.")
    ready_state = video.evaluate("element => element.readyState")
    if ready_state < 1:
        raise AssertionError("C12 final-video player did not load metadata.")
    page.locator("details.clip-history").evaluate("element => { element.open = true; element.scrollIntoView({ block: 'start' }); }")
    overlap = page.evaluate(
        """() => {
          const player = document.querySelector('.project-result-player')?.getBoundingClientRect();
          const history = document.querySelector('.clip-history summary')?.getBoundingClientRect();
          if (!player || !history) return { missing: true };
          return {
            missing: false,
            overlaps: player.left < history.right && player.right > history.left && player.top < history.bottom && player.bottom > history.top,
          };
        }"""
    )
    if overlap["missing"] or overlap["overlaps"]:
        raise AssertionError(f"C12 clip history is obscured by the project result player: {overlap}")
    with page.expect_download(timeout=30_000) as download_info:
        page.get_by_role("button", name="下载成片", exact=True).click()
    if not download_info.value.suggested_filename:
        raise AssertionError("C12 final-video download did not return a filename.")

    required = [
        f"/api/v1/projects/{project_id}/creative-brief-revisions",
        "/api/v1/creative-brief-revisions/",
        "/plan",
        "/api/v1/storyboard-revisions/",
        "/approve",
        f"/api/v1/projects/{project_id}/production-runs",
    ]
    for expected in required:
        if not any(expected in path for path in post_paths):
            raise AssertionError(f"C12 Studio did not use expected public command {expected}; seen={post_paths}")

    # A distinct browser context prevents desktop viewport state leaking into the mobile audit.
    mobile_context = browser.new_context(viewport={"width": 390, "height": 844})
    mobile_page = mobile_context.new_page()
    try:
        assert_mobile_layout(mobile_page, page.url, project_name)
    finally:
        mobile_context.close()
    return {"project_id": project_id, "segment_count": 2, "mobile_viewport": "390x844"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio-origin", required=True)
    parser.add_argument("--project-name", required=True)
    args = parser.parse_args()
    result = {"ok": False, "project_name": args.project_name}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                result = {"ok": True, **create_plan_and_verify_final_video(page, args.studio_origin, args.project_name, browser)}
            finally:
                browser.close()
    except Exception as error:
        result = {"ok": False, "project_name": args.project_name, "error": str(error)}
    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
