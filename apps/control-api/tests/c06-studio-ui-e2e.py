import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


RESULT_PREFIX = "C06_STUDIO_UI_E2E_RESULT="
SHOT_PROMPT = "一个可确定性生成的本地视频分镜。"


def video_dimensions(page) -> dict[str, object]:
    return page.get_by_role("dialog").locator("video").evaluate(
        """video => new Promise((resolve) => {
          const finish = () => resolve({
            src: video.currentSrc,
            ready_state: video.readyState,
            network_state: video.networkState,
            video_width: video.videoWidth,
            video_height: video.videoHeight,
            duration: video.duration,
            media_error: video.error ? { code: video.error.code, message: video.error.message } : null,
          });
          if (video.readyState >= 1) return finish();
          video.addEventListener('loadedmetadata', finish, { once: true });
          setTimeout(finish, 10000);
        })"""
    )


def install_command_uuid_seed(page, seed: str) -> str:
    compact_seed = "".join(character for character in seed if character.isalnum())
    if len(compact_seed) < 8:
        raise AssertionError("C06 Studio UI E2E command seed is invalid.")
    prefix = compact_seed[:8]
    page.add_init_script(
        f"""() => {{
          let sequence = 0;
          globalThis.crypto.randomUUID = () => "{prefix}-0000-4000-8000-" + String(++sequence).padStart(12, "0");
        }}"""
    )
    return prefix


def create_project_and_failed_generation(page, fixture: Path, project_name: str) -> dict[str, object]:
    page.get_by_role("button", name="刷新工作台", exact=True).click()
    page.get_by_text("控制 API 正常", exact=True).wait_for(timeout=30_000)
    page.get_by_label("新建项目", exact=True).fill(project_name)
    page.get_by_role("button", name="创建项目", exact=True).click()
    project_tab = page.get_by_role("tab", name=project_name, exact=True)
    project_tab.wait_for(timeout=30_000)

    page.locator("#asset-file").set_input_files(str(fixture))
    page.get_by_role("button", name="上传", exact=True).click()
    page.locator(".asset-item, .field-error").first.wait_for(timeout=30_000)
    upload_error = page.locator(".field-error")
    if upload_error.count() and upload_error.is_visible():
        raise AssertionError(f"Studio 未能确认参考图片：{upload_error.inner_text()}")
    asset_row = page.locator(".asset-item").filter(has_text=fixture.name)
    asset_row.wait_for(timeout=30_000)
    if "已就绪" not in asset_row.inner_text():
        raise AssertionError("Studio 未将已上传的参考图片显示为已就绪。")

    page.get_by_label("分镜描述", exact=True).fill(SHOT_PROMPT)
    page.get_by_role("button", name="创建分镜", exact=True).click()
    shot = page.locator(".shot-item").filter(has_text=SHOT_PROMPT)
    shot.wait_for(timeout=30_000)
    shot.get_by_title("标记为可生成", exact=True).click()
    generate = shot.get_by_title("生成本地 Mock 视频", exact=True)
    generate.wait_for(timeout=30_000)
    generate.click()

    failed_status = shot.locator(".task-status.failed")
    failed_status.wait_for(timeout=60_000)
    failure_text = failed_status.inner_text()
    if "失败" not in failure_text:
        raise AssertionError(f"Studio 未显示失败的任务状态：{failure_text}")
    if "视频生成请求未被接受，请检查分镜后重试。" not in failure_text:
        raise AssertionError(f"Studio 未显示公开的失败提示：{failure_text}")
    retry = shot.get_by_title("重试失败任务", exact=True)
    retry.wait_for(timeout=30_000)
    if not retry.is_enabled():
        raise AssertionError("Studio 显示失败任务后没有启用重试命令。")
    page.locator(".run-activity").get_by_text("任务失败", exact=True).wait_for(timeout=30_000)
    return {"failure_text": failure_text}


def retry_failed_generation(page, project_name: str) -> dict[str, object]:
    project_tab = page.get_by_role("tab", name=project_name, exact=True)
    project_tab.wait_for(timeout=30_000)
    project_tab.click()
    shot = page.locator(".shot-item").filter(has_text=SHOT_PROMPT)
    shot.wait_for(timeout=30_000)
    failed_status = shot.locator(".task-status.failed")
    failed_status.wait_for(timeout=30_000)
    retry = shot.get_by_title("重试失败任务", exact=True)
    retry.wait_for(timeout=30_000)
    retry.click()
    shot.locator(".task-status.succeeded").wait_for(timeout=60_000)

    page.reload(wait_until="domcontentloaded")
    project_tab = page.get_by_role("tab", name=project_name, exact=True)
    project_tab.wait_for(timeout=30_000)
    project_tab.click()
    shot = page.locator(".shot-item").filter(has_text=SHOT_PROMPT)
    shot.locator(".task-status.succeeded").wait_for(timeout=30_000)
    shot.get_by_title("预览生成视频", exact=True).click()
    preview_dialog = page.get_by_role("dialog")
    preview_dialog.wait_for(state="visible", timeout=30_000)
    preview = preview_dialog.locator("video")
    preview.wait_for(state="visible", timeout=30_000)
    dimensions = video_dimensions(page)
    if dimensions["video_width"] <= 0 or dimensions["video_height"] <= 0:
        raise AssertionError(f"Studio 预览视频未能解码画面：{dimensions}")
    if not dimensions["duration"] or dimensions["duration"] <= 0:
        raise AssertionError(f"Studio 预览视频没有时长：{dimensions}")
    preview_dialog.get_by_role("button", name="关闭预览", exact=True).click()
    preview_dialog.wait_for(state="hidden", timeout=30_000)
    return dimensions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio-origin", required=True)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--mode", choices=("failure", "retry"), required=True)
    parser.add_argument("--command-seed", required=True)
    args = parser.parse_args()

    fixture = Path(args.fixture).resolve()
    result: dict[str, object] = {"ok": False}
    try:
        if not fixture.is_file():
            raise AssertionError("The C06 PNG fixture is missing.")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                command_seed_prefix = install_command_uuid_seed(page, args.command_seed)
                page.goto(args.studio_origin, wait_until="domcontentloaded")
                page.get_by_text("控制 API 正常", exact=True).wait_for(timeout=30_000)
                if args.mode == "failure":
                    failure = create_project_and_failed_generation(page, fixture, args.project_name)
                    result = {
                        "ok": True,
                        "mode": args.mode,
                        "project_name": args.project_name,
                        "failure_text": failure["failure_text"],
                        "retry_control_visible": True,
                        "command_seed_prefix": command_seed_prefix,
                    }
                elif args.mode == "retry":
                    dimensions = retry_failed_generation(page, args.project_name)
                    result = {
                        "ok": True,
                        "mode": args.mode,
                        "project_name": args.project_name,
                        "video_width": dimensions["video_width"],
                        "video_height": dimensions["video_height"],
                        "duration": dimensions["duration"],
                        "command_seed_prefix": command_seed_prefix,
                    }
            finally:
                browser.close()
    except Exception as error:
        result = {"ok": False, "project_name": args.project_name, "error": str(error)}

    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
