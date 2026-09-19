import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


RESULT_PREFIX = "C10_STUDIO_UI_E2E_RESULT="


def install_command_uuid_seed(page: Page, seed: str) -> str:
    compact_seed = "".join(character for character in seed if character.isalnum())
    if len(compact_seed) < 8:
        raise AssertionError("C10 Studio UI E2E command seed is invalid.")
    prefix = compact_seed[:8]
    page.add_init_script(
        f"""() => {{
          let sequence = 0;
          globalThis.crypto.randomUUID = () => "{prefix}-0000-4000-8000-" + String(++sequence).padStart(12, "0");
        }}"""
    )
    return prefix


def open_project_home(page: Page, studio_origin: str) -> None:
    page.goto(f"{studio_origin}/projects", wait_until="domcontentloaded")
    page.get_by_role("heading", name="我的项目", exact=True).wait_for(timeout=30_000)


def open_project(page: Page, studio_origin: str, project_id: str, project_name: str) -> str:
    page.goto(f"{studio_origin}/projects/{project_id}", wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    return page.url


def assert_mobile_layout(page: Page, project_url: str, project_name: str) -> None:
    page.goto(project_url, wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="添加资料", exact=True).wait_for(state="visible", timeout=30_000)
    page.get_by_text("已准备好用于这次创作", exact=True).wait_for(timeout=30_000)
    layout = page.evaluate(
        """() => ({
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll('button, input:not([type=file])')]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right, label: element.getAttribute('aria-label') || element.textContent?.trim() || element.id };
            }),
        })"""
    )
    if layout["scrollWidth"] > layout["width"]:
        raise AssertionError(f"C10 mobile layout has horizontal overflow: {layout}")
    for control in layout["controls"]:
        if control["left"] < 0 or control["right"] > layout["width"]:
            raise AssertionError(f"C10 mobile control overflows the viewport: {control}")


def fail_conversion(page: Page, project_id: str, project_name: str, studio_origin: str, seed: str) -> dict[str, object]:
    prefix = install_command_uuid_seed(page, seed)
    project_url = open_project(page, studio_origin, project_id, project_name)
    page.get_by_text("这份资料暂时无法使用", exact=True).wait_for(timeout=60_000)
    retry = page.get_by_role("button", name="重新整理", exact=True)
    if not retry.is_enabled():
        raise AssertionError("C10 failed conversion did not expose an enabled explicit retry action.")
    return {"project_url": project_url, "command_seed_prefix": prefix}


def retry_and_verify(page: Page, project_id: str, project_name: str, secondary_project_id: str, secondary_project_name: str, studio_origin: str, seed: str, browser) -> dict[str, object]:
    prefix = install_command_uuid_seed(page, seed)
    open_project(page, studio_origin, project_id, project_name)
    page.get_by_text("这份资料暂时无法使用", exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="重新整理", exact=True).click()
    try:
        page.get_by_text("已准备好用于这次创作", exact=True).wait_for(timeout=60_000)
    except Exception as error:
        conversions = page.evaluate("""async (projectId) => {
          const response = await fetch(`/api/v1/projects/${projectId}/documents`);
          return { status: response.status, body: await response.text() };
        }""", project_id)
        raise AssertionError(f"C10 retry did not update the material card: {conversions}; page={page.locator('body').inner_text()}") from error
    documents = page.evaluate(
        """async (projectId) => {
          const response = await fetch(`/api/v1/projects/${projectId}/documents`);
          const body = await response.json();
          if (!response.ok) throw new Error(`document list failed: ${response.status} ${JSON.stringify(body)}`);
          return body.data;
        }""",
        project_id,
    )
    completed = next((item for item in documents if item.get("status") == "SUCCEEDED" and item.get("markdown_asset_id")), None)
    if not completed:
        raise AssertionError(f"C10 converted document did not expose a completed Markdown asset: {documents}")
    download_response = page.context.request.get(f"{studio_origin}/api/v1/assets/{completed['markdown_asset_id']}/download-url")
    if not download_response.ok:
        raise AssertionError(f"C10 Markdown download URL request failed with HTTP {download_response.status}.")
    download_payload = download_response.json()
    download_url = download_payload.get("data", {}).get("download_url")
    if not download_url:
        raise AssertionError("C10 Markdown download URL response did not contain a short-lived URL.")
    downloaded = page.context.request.get(download_url)
    if not downloaded.ok:
        raise AssertionError(f"C10 Markdown download failed with HTTP {downloaded.status}.")
    markdown = downloaded.text()
    if "C10 browser material fixture" not in markdown:
        raise AssertionError("C10 Markdown download did not contain the converted source content.")
    page.reload(wait_until="domcontentloaded")
    page.get_by_text("已准备好用于这次创作", exact=True).wait_for(timeout=30_000)

    secondary_url = open_project(page, studio_origin, secondary_project_id, secondary_project_name)
    page.get_by_text("已准备好用于这次创作", exact=True).wait_for(timeout=60_000)
    if page.locator(".material-item").count() != 1:
        raise AssertionError("C10 project B did not retain exactly its own converted material.")

    mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        assert_mobile_layout(mobile_page, secondary_url, secondary_project_name)
    finally:
        mobile_page.close()
    return {"command_seed_prefix": prefix, "mobile_viewport": "390x844", "markdown_bytes": len(markdown.encode("utf-8"))}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio-origin", required=True)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--secondary-project-name", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--secondary-project-id", required=True)
    parser.add_argument("--mode", choices=("failure", "retry"), required=True)
    parser.add_argument("--command-seed", required=True)
    args = parser.parse_args()
    fixture = Path(args.fixture).resolve()
    result: dict[str, object] = {"ok": False, "project_name": args.project_name}
    try:
        if not fixture.is_file():
            raise AssertionError("C10 Studio UI E2E requires a Markdown fixture.")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                if args.mode == "failure":
                    result = {"ok": True, "mode": args.mode, **fail_conversion(page, args.project_id, args.project_name, args.studio_origin, args.command_seed)}
                else:
                    result = {
                        "ok": True,
                        "mode": args.mode,
                        **retry_and_verify(page, args.project_id, args.project_name, args.secondary_project_id, args.secondary_project_name, args.studio_origin, args.command_seed, browser),
                    }
            finally:
                browser.close()
    except Exception as error:
        result = {"ok": False, "project_name": args.project_name, "error": str(error)}
    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
