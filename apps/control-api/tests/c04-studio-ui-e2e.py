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
                page = browser.new_page()
                page.goto(args.studio_origin, wait_until="domcontentloaded")
                page.get_by_text("Control API is available", exact=True).wait_for(timeout=30_000)

                page.get_by_label("New project", exact=True).fill(args.project_name)
                create_project = page.get_by_role("button", name="Create project", exact=True)
                if not create_project.is_enabled():
                    raise AssertionError("Studio create-project button stayed disabled after entering a project name.")
                create_project.click()
                page.get_by_role("tab", name=args.project_name, exact=True).wait_for(timeout=30_000)

                page.locator("#asset-file").set_input_files(str(fixture))
                upload = page.get_by_role("button", name="Upload", exact=True)
                if not upload.is_enabled():
                    raise AssertionError("Studio upload button stayed disabled after selecting the PNG fixture.")
                upload.click()
                page.get_by_text(fixture.name, exact=True).wait_for(timeout=30_000)
                asset_row = page.locator(".asset-item").filter(has_text=fixture.name)
                if "READY" not in asset_row.inner_text():
                    raise AssertionError("Studio did not render the confirmed asset as READY.")

                page.reload(wait_until="domcontentloaded")
                page.get_by_role("tab", name=args.project_name, exact=True).wait_for(timeout=30_000)
                asset_row = page.locator(".asset-item").filter(has_text=fixture.name)
                asset_row.get_by_role("button", name="Preview asset", exact=True).click()
                preview = asset_row.locator("img")
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
