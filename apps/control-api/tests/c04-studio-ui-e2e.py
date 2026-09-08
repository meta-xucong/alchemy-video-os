import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


RESULT_PREFIX = "C04_STUDIO_UI_E2E_RESULT="


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio-origin", required=True)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--screenshot-path", required=True)
    args = parser.parse_args()

    fixture = Path(args.fixture).resolve()
    screenshot_path = Path(args.screenshot_path).resolve()
    result: dict[str, object] = {"ok": False}

    try:
        if not fixture.is_file():
            raise AssertionError("The C04 PNG fixture is missing.")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                page.goto(f"{args.studio_origin}/projects", wait_until="domcontentloaded")
                page.get_by_role("heading", name="我的项目", exact=True).wait_for(timeout=30_000)

                page.get_by_role("button", name="新建项目", exact=True).first.click()
                page.locator("#new-project-name").fill(args.project_name)
                create_project = page.get_by_role("button", name="创建并进入", exact=True)
                if not create_project.is_enabled():
                    raise AssertionError("Studio 创建项目按钮在填写名称后仍不可用。")
                create_project.click()
                page.get_by_role("heading", name=args.project_name, exact=True).wait_for(timeout=30_000)

                page.locator("#reference-file").set_input_files(str(fixture))
                upload = page.get_by_role("button", name="添加参考图", exact=True)
                if not upload.is_enabled():
                    raise AssertionError("Studio 添加参考图按钮在选择 PNG 后仍不可用。")
                upload.click()
                asset_row = page.locator(".reference-option").filter(has_text=fixture.name)
                asset_row.wait_for(timeout=30_000)
                if not asset_row.get_by_role("checkbox").is_checked():
                    raise AssertionError("Studio 未将已确认的参考图默认选入本次创作。")

                page.reload(wait_until="domcontentloaded")
                page.get_by_role("heading", name=args.project_name, exact=True).wait_for(timeout=30_000)
                asset_row = page.locator(".reference-option").filter(has_text=fixture.name)
                asset_row.get_by_role("button", name=f"预览图片：{fixture.name}", exact=True).click()
                preview = page.get_by_role("dialog").locator("img")
                preview.wait_for(state="visible", timeout=30_000)
                dimensions = preview.evaluate(
                    "image => ({ complete: image.complete, natural_width: image.naturalWidth, natural_height: image.naturalHeight })"
                )
                if not dimensions["complete"] or dimensions["natural_width"] <= 0 or dimensions["natural_height"] <= 0:
                    raise AssertionError("Studio Preview asset did not decode the confirmed PNG.")

                screenshot_path.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(screenshot_path), full_page=True)
                result = {"ok": True, **dimensions, "screenshot_path": str(screenshot_path)}
            finally:
                browser.close()
    except Exception as error:  # The Node supervisor still receives a structured result for cleanup/reporting.
        result = {"ok": False, "error": str(error), "screenshot_path": str(screenshot_path)}

    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
