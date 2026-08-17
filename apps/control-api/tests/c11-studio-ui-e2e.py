import argparse
import json
import re
import sys
from urllib.parse import urlparse

from playwright.sync_api import Page, sync_playwright


RESULT_PREFIX = "C11_STUDIO_UI_E2E_RESULT="


def assert_mobile_layout(page: Page, project_url: str, project_name: str) -> None:
    page.goto(project_url, wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    page.get_by_role("heading", name="正在制作视频", exact=True).first.wait_for(timeout=30_000)
    layout = page.evaluate(
        """() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll('button, input:not([type=file]), textarea')]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right, label: element.getAttribute('aria-label') || element.textContent?.trim() || element.id };
            }),
        })"""
    )
    if layout["scrollWidth"] > layout["width"]:
        raise AssertionError(f"C11 mobile layout has horizontal overflow: {layout}")
    for control in layout["controls"]:
        if control["left"] < 0 or control["right"] > layout["width"]:
            raise AssertionError(f"C11 mobile control overflows the viewport: {control}")


def create_and_confirm_plan(page: Page, studio_origin: str, project_name: str, browser) -> dict[str, object]:
    page.goto(f"{studio_origin}/projects", wait_until="domcontentloaded")
    page.get_by_role("heading", name="我的项目", exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="新建项目", exact=True).first.click()
    page.get_by_label("给这项创作起个名字", exact=True).fill(project_name)
    page.get_by_role("button", name="创建并进入", exact=True).click()
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)

    project_path = urlparse(page.url).path
    project_match = re.fullmatch(r"/projects/(prj_[0-9A-HJKMNP-TV-Z]{26})", project_path)
    if not project_match:
        raise AssertionError(f"C11 Studio project creation did not navigate to a project URL: {page.url}")
    project_id = project_match.group(1)

    post_paths: list[str] = []

    def record_request(request) -> None:
        if request.method != "POST":
            return
        parsed = urlparse(request.url)
        if parsed.netloc == urlparse(studio_origin).netloc and parsed.path.startswith("/api/v1/"):
            post_paths.append(parsed.path)

    page.on("request", record_request)
    page.get_by_label("把想法、故事或小说情节写在这里", exact=True).fill(
        "雨夜，创始人抵达工厂，发现交付期限只剩最后一晚。团队点亮车间，逐项完成产品检查。"
        "黎明前，客户收到承诺的成果，所有人走出厂房。"
    )
    page.locator("#story-duration").fill("45")
    page.locator("#story-resolution-480p").check()
    page.locator("#story-style").fill("真实纪录感，克制的暖色灯光")
    page.get_by_role("button", name="开始生成视频", exact=True).click()
    page.get_by_role("heading", name="正在制作视频", exact=True).first.wait_for(timeout=60_000)

    storyboard_projection = page.evaluate(
        """async (projectId) => {
          const response = await fetch(`/api/v1/projects/${projectId}/storyboard-revisions`);
          const payload = await response.json();
          return { status: response.status, data: payload.data };
        }""",
        project_id,
    )
    if storyboard_projection["status"] != 200:
        raise AssertionError(f"C11 Studio could not read public storyboard projection: {storyboard_projection}")
    approved_storyboards = [
        item for item in storyboard_projection["data"]
        if item.get("status") == "APPROVED"
    ]
    segment_count = len(approved_storyboards[0]["shot_specs"]) if approved_storyboards else 0
    if segment_count != 3:
        raise AssertionError(f"C11 45-second narrative should have three 15-second planned segments, got {segment_count}.")
    if page.locator("#story-duration").input_value() != "45":
        raise AssertionError("C11 Studio did not retain the selected total duration in its review UI.")
    if not page.locator("#story-resolution-480p").is_checked():
        raise AssertionError("C11 Studio did not retain the selected 480p resolution in its project draft.")

    page.reload(wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    page.get_by_role("heading", name="正在制作视频", exact=True).first.wait_for(timeout=30_000)
    if not page.locator("#story-resolution-480p").is_checked():
        raise AssertionError("C11 Studio did not restore the selected 480p resolution after refresh.")

    unexpected = [path for path in post_paths if "/shots" in path or "/generations" in path or "/task-runs" in path]
    if unexpected:
        raise AssertionError(f"C11 planning UI submitted execution commands: {unexpected}")
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
            raise AssertionError(f"C11 planning UI did not use its expected public command path: {expected}; seen={post_paths}")

    mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        assert_mobile_layout(mobile_page, page.url, project_name)
    finally:
        mobile_page.close()
    return {
        "project_id": project_id,
        "segment_count": segment_count,
        "post_paths": post_paths,
        "mobile_viewport": "390x844",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio-origin", required=True)
    parser.add_argument("--project-name", required=True)
    args = parser.parse_args()
    result: dict[str, object] = {"ok": False, "project_name": args.project_name}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                result = {"ok": True, **create_and_confirm_plan(page, args.studio_origin, args.project_name, browser)}
            finally:
                browser.close()
    except Exception as error:
        result = {"ok": False, "project_name": args.project_name, "error": str(error)}
    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
