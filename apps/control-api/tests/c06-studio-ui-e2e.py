import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


RESULT_PREFIX = "C06_STUDIO_UI_E2E_RESULT="
CREATION_IDEA = "第一张参考图用于产品主体，第二张参考图用于晨光场景；为这件无品牌产品拍摄简短展示视频。"


def video_dimensions(video) -> dict[str, object]:
    return video.evaluate(
        """video => new Promise((resolve) => {
          const finish = () => resolve({
            ready_state: video.readyState,
            video_width: video.videoWidth,
            video_height: video.videoHeight,
            duration: video.duration,
            media_error: video.error ? { code: video.error.code } : null,
          });
          if (video.readyState >= 1) return finish();
          video.addEventListener('loadedmetadata', finish, { once: true });
          setTimeout(finish, 10000);
        })"""
    )


def image_dimensions(page: Page) -> dict[str, int]:
    return page.get_by_role("dialog").locator("img").evaluate(
        """image => new Promise((resolve) => {
          const finish = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          if (image.complete) return finish();
          image.addEventListener('load', finish, { once: true });
          setTimeout(finish, 10000);
        })"""
    )


def install_command_uuid_seed(page: Page, seed: str) -> str:
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


def open_project_home(page: Page, studio_origin: str) -> None:
    page.goto(f"{studio_origin}/projects", wait_until="domcontentloaded")
    page.get_by_role("heading", name="我的项目", exact=True).wait_for(timeout=30_000)


def create_project(page: Page, project_name: str) -> str:
    page.get_by_role("button", name="新建项目", exact=True).first.click()
    page.locator("#new-project-name").fill(project_name)
    page.get_by_role("button", name="创建并进入", exact=True).click()
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    return page.url


def rename_project_and_restore(page: Page, project_name: str) -> None:
    renamed = f"{project_name} 已编辑"
    page.get_by_role("button", name="编辑名称", exact=True).click()
    page.locator("#project-rename").fill(renamed)
    page.get_by_role("button", name="保存名称", exact=True).click()
    page.get_by_role("heading", name=renamed, exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="编辑名称", exact=True).click()
    page.locator("#project-rename").fill(project_name)
    page.get_by_role("button", name="保存名称", exact=True).click()
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)


def upload_and_preview_reference(page: Page, fixture: Path) -> dict[str, int]:
    network_failures: list[dict[str, object]] = []

    def capture_response(response) -> None:
        if response.status < 400:
            return
        try:
            body = response.text()[:1_000]
        except Exception:
            body = "<response body unavailable>"
        network_failures.append({
            "method": response.request.method,
            "url": response.url.split("?", 1)[0],
            "status": response.status,
            "body": body,
        })

    page.on("response", capture_response)
    file_input = page.locator("#reference-file")
    try:
        file_input.wait_for(state="attached", timeout=30_000)
    except Exception as error:
        visible_text = page.locator("body").inner_text(timeout=5_000)[-2_000:]
        raise AssertionError(f"Studio 项目页未挂载参考图上传控件：{visible_text}") from error
    file_input.set_input_files(str(fixture))
    page.get_by_role("button", name="添加参考图", exact=True).click()
    asset = page.locator(".reference-option").filter(has_text=fixture.name)
    try:
        asset.wait_for(timeout=30_000)
    except Exception as error:
        failures = page.locator(".field-error, [role=alert]").all_inner_texts()
        raise AssertionError(f"Studio 未将参考图上传并确认到当前项目：{failures}; network_failures={network_failures[-8:]}") from error
    finally:
        page.remove_listener("response", capture_response)
    reference_checkbox = asset.get_by_role("checkbox")
    if not reference_checkbox.is_checked():
        raise AssertionError("Studio 确认上传后没有默认将参考图用于本次创作。")
    page.get_by_text("本次会使用", exact=False).wait_for(timeout=30_000)
    asset.get_by_role("button", name=f"预览图片：{fixture.name}", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.wait_for(state="visible", timeout=30_000)
    dimensions = image_dimensions(page)
    if dimensions["width"] <= 0 or dimensions["height"] <= 0:
        raise AssertionError(f"Studio 未能解码已上传参考图：{dimensions}")
    dialog.get_by_role("button", name="关闭预览", exact=True).click()
    dialog.wait_for(state="hidden", timeout=30_000)
    return dimensions


def upload_and_preview_references(page: Page, fixtures: list[Path]) -> list[dict[str, int]]:
    dimensions = [upload_and_preview_reference(page, fixture) for fixture in fixtures]
    for fixture in fixtures:
        page.locator(".reference-option").filter(has_text=fixture.name).wait_for(timeout=30_000)
    if page.locator(".reference-option").count() < len(fixtures):
        raise AssertionError("Studio 未将两张已确认参考图都显示在当前项目素材列表。")
    return dimensions


def enter_chinese_creation(page: Page) -> None:
    page.locator("#story-source").fill(CREATION_IDEA)
    page.locator("#story-duration").fill("15")
    if page.locator("#story-duration").input_value() != "15":
        raise AssertionError("Studio 未保留用户选择的 15 秒规划时长。")
    page.locator("#story-resolution-480p").check()
    if not page.locator("#story-resolution-480p").is_checked():
        raise AssertionError("Studio 未保留用户选择的 480p 清晰度。")
    start = page.locator(".generation-panel").get_by_role("button", name="开始生成视频", exact=True)
    start.wait_for(timeout=30_000)
    if not start.is_enabled():
        raise AssertionError("填写创作需求后，第三步的生成入口应可用。")


def create_legacy_shot_and_generation(page: Page, project_url: str, project_name: str, command_seed: str) -> dict[str, str]:
    project_id = project_url.rstrip("/").split("/")[-1]
    result = page.evaluate(
        """async ({ projectId, prompt, seed }) => {
          const call = async (path, method, key, body) => {
            const response = await fetch(path, {
              method,
              headers: { "Content-Type": "application/json", "Idempotency-Key": key },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
            return payload.data;
          };
          const detailResponse = await fetch(`/api/v1/projects/${projectId}`);
          const detail = await detailResponse.json();
          if (!detailResponse.ok) throw new Error(`project detail failed (${detailResponse.status}): ${JSON.stringify(detail)}`);
          const references = detail.data.assets
            .filter((asset) => asset.kind === "IMAGE" && asset.origin === "USER_UPLOAD" && asset.status === "READY")
            .sort((left, right) => left.created_at.localeCompare(right.created_at))
            .slice(0, 2);
          if (references.length !== 2) throw new Error(`expected two ready reference images, got ${references.length}`);
          const shot = await call(`/api/v1/projects/${projectId}/shots`, "POST", `c06-${seed}-legacy-shot`, {
            position: 0,
            prompt,
            generation_settings: { video_settings: { duration_seconds: 8, resolution: "480p", ratio: "16:9" } },
            reference_bindings: references.map((asset, position) => ({
              asset_id: asset.id,
              role: position === 0 ? "SUBJECT" : "STYLE",
              position,
            })),
          });
          await call(`/api/v1/shots/${shot.id}`, "PATCH", `c06-${seed}-legacy-ready`, { status: "READY" });
          const task = await call(`/api/v1/shots/${shot.id}/generations`, "POST", `c06-${seed}-legacy-generation`, {});
          return { project_id: projectId, shot_id: shot.id, task_id: task.id };
        }""",
        {"projectId": project_id, "prompt": CREATION_IDEA, "seed": command_seed},
    )
    page.reload(wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    return result


def create_and_verify_isolated_project(page: Page, project_name: str) -> None:
    page.get_by_role("link", name="返回项目列表", exact=True).click()
    page.get_by_role("heading", name="我的项目", exact=True).wait_for(timeout=30_000)
    create_project(page, project_name)
    if page.locator("#story-source").input_value():
        raise AssertionError("项目 B 意外继承了项目 A 的创作草稿。")
    page.get_by_text("尚未选择用于本次视频的参考图；也可以直接生成文字创作。", exact=True).wait_for(timeout=30_000)
    start = page.locator(".generation-panel").get_by_role("button", name="开始生成视频", exact=True)
    if not start.is_disabled():
        raise AssertionError("空项目 B 的生成按钮不应可用。")
    delete_button = page.get_by_role("button", name="删除项目", exact=True)
    delete_button.click()
    page.get_by_text("软删除 · 活动制作中不可删除", exact=True).wait_for(timeout=30_000)
    if not page.get_by_role("button", name="确认删除项目", exact=True).is_disabled():
        raise AssertionError("未输入删除确认词时，删除确认按钮必须保持禁用。")
    page.get_by_role("button", name="归档项目", exact=True).click()
    page.get_by_text("已归档", exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="恢复项目", exact=True).click()
    page.get_by_text("进行中", exact=True).wait_for(timeout=30_000)


def assert_mobile_layout(page: Page, project_url: str, project_name: str, primary_action: str) -> None:
    page.goto(project_url, wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    for label in ("刷新项目", "编辑名称", primary_action, "添加参考图", "归档项目", "删除项目"):
        page.get_by_role("button", name=label, exact=True).first.wait_for(state="visible", timeout=30_000)
    page.locator("#story-duration").wait_for(state="visible", timeout=30_000)
    for selector in ("#story-resolution-480p", "#story-resolution-720p"):
        page.locator(selector).wait_for(state="visible", timeout=30_000)
    layout = page.evaluate(
        """() => {
          const width = window.innerWidth;
          const controls = [...document.querySelectorAll('button, select, textarea, input:not([type="file"])')]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return { label: element.getAttribute('aria-label') || element.textContent?.trim() || element.id, left: rect.left, right: rect.right };
            });
          return { viewport: { width, height: window.innerHeight }, scroll_width: document.documentElement.scrollWidth, controls };
        }"""
    )
    if layout["scroll_width"] > layout["viewport"]["width"]:
        raise AssertionError(f"手机布局存在水平溢出：{layout}")
    for control in layout["controls"]:
        if control["left"] < 0 or control["right"] > layout["viewport"]["width"]:
            raise AssertionError(f"手机布局控件越界：{control}")


def create_project_and_failed_generation(
    page: Page,
    fixtures: list[Path],
    project_name: str,
    secondary_project_name: str,
    studio_origin: str,
    command_seed: str,
    browser,
) -> dict[str, object]:
    command_seed_prefix = install_command_uuid_seed(page, command_seed)
    open_project_home(page, studio_origin)
    project_url = create_project(page, project_name)
    rename_project_and_restore(page, project_name)
    images = upload_and_preview_references(page, fixtures)
    enter_chinese_creation(page)
    legacy_generation = create_legacy_shot_and_generation(page, project_url, project_name, command_seed)
    try:
        page.get_by_text("本次创作未完成", exact=True).wait_for(timeout=60_000)
    except Exception as error:
        status = page.locator(".generation-status").inner_text()
        message = page.locator(".generation-message").inner_text()
        raise AssertionError(f"Studio 未在失败流程中显示公开失败状态：状态={status}；提示={message}") from error
    failure_text = page.locator(".generation-message").inner_text()
    if "本次创作尚未完成" not in failure_text:
        raise AssertionError(f"Studio 未显示公开失败提示：{failure_text}")
    failure_feedback = page.locator(".generation-feedback")
    failure_feedback.get_by_text("本次创作已进入生成阶段，但没有完成。请调整描述后生成新版本，或重试这次创作。", exact=True).wait_for(timeout=30_000)
    retry = page.get_by_role("button", name="重试生成", exact=True)
    retry.wait_for(timeout=30_000)
    if not retry.is_enabled():
        raise AssertionError("Studio 显示失败任务后没有启用显式重试命令。")
    new_version = page.get_by_role("button", name="调整后生成新版本", exact=True)
    new_version.wait_for(timeout=30_000)
    if not new_version.is_enabled():
        raise AssertionError("Studio 显示失败任务后没有启用新版本生成命令。")
    create_and_verify_isolated_project(page, secondary_project_name)
    mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
    try:
        assert_mobile_layout(mobile_page, project_url, project_name, "调整后生成新版本")
    finally:
        mobile_page.close()
    return {
        "command_seed_prefix": command_seed_prefix,
        "failure_text": failure_text,
        "retry_control_visible": True,
        "legacy_task_id": legacy_generation["task_id"],
        "reference_images": images,
        "mobile_viewport": "390x844",
    }


def retry_failed_generation(page: Page, project_name: str, studio_origin: str, command_seed: str) -> dict[str, object]:
    command_seed_prefix = install_command_uuid_seed(page, command_seed)
    open_project_home(page, studio_origin)
    page.get_by_role("link", name=f"进入项目：{project_name}", exact=True).click()
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    page.get_by_text("本次创作未完成", exact=True).wait_for(timeout=30_000)
    page.get_by_role("button", name="重试生成", exact=True).click()
    try:
        page.get_by_text("视频已生成", exact=True).wait_for(timeout=60_000)
    except Exception as error:
        body = page.locator("body").inner_text()[:4_000]
        project_id = page.url.rstrip("/").split("/")[-1]
        detail = page.evaluate(
            """async (projectId) => {
              const response = await fetch(`/api/v1/projects/${projectId}`);
              return { status: response.status, body: await response.text() };
            }""",
            project_id,
        )
        raise AssertionError(f"Studio 重试后未显示成功状态：{body}; project_detail={detail}") from error
    page.locator(".generation-feedback").get_by_text("本次创作已完成，可以预览当前结果。", exact=True).wait_for(timeout=30_000)
    page.reload(wait_until="domcontentloaded")
    page.get_by_role("heading", name=project_name, exact=True).wait_for(timeout=30_000)
    page.get_by_text("视频已生成", exact=True).wait_for(timeout=30_000)
    results_panel = page.locator(".project-results-panel")
    results_panel.get_by_role("heading", name="成片版本", exact=True).wait_for(timeout=30_000)
    result_button = results_panel.locator(".project-result-item").first
    result_button.wait_for(timeout=30_000)
    page.get_by_role("button", name="预览视频", exact=True).click()
    if result_button.get_attribute("aria-pressed") != "true":
        raise AssertionError("Studio 预览视频动作没有选中项目成果中的当前成片。")
    preview = results_panel.locator("video")
    preview.wait_for(state="visible", timeout=30_000)
    dimensions = video_dimensions(preview)
    if dimensions["video_width"] <= 0 or dimensions["video_height"] <= 0:
        raise AssertionError(f"Studio 预览视频未能解码画面：{dimensions}")
    if not dimensions["duration"] or dimensions["duration"] <= 0:
        raise AssertionError(f"Studio 预览视频没有时长：{dimensions}")
    return {**dimensions, "command_seed_prefix": command_seed_prefix, "desktop_viewport": "1280x720"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio-origin", required=True)
    parser.add_argument("--fixture", action="append", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--secondary-project-name", required=True)
    parser.add_argument("--mode", choices=("failure", "retry"), required=True)
    parser.add_argument("--command-seed", required=True)
    args = parser.parse_args()
    fixtures = [Path(value).resolve() for value in args.fixture]
    result: dict[str, object] = {"ok": False}
    try:
        if len(fixtures) != 2 or any(not fixture.is_file() for fixture in fixtures):
            raise AssertionError("C06 Studio UI E2E requires two valid PNG fixtures.")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                args=["--host-resolver-rules=MAP localhost [::1]"],
            )
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                if args.mode == "failure":
                    failure = create_project_and_failed_generation(
                        page, fixtures, args.project_name, args.secondary_project_name, args.studio_origin, args.command_seed, browser
                    )
                    result = {"ok": True, "mode": args.mode, "project_name": args.project_name, **failure}
                else:
                    retry = retry_failed_generation(page, args.project_name, args.studio_origin, args.command_seed)
                    result = {"ok": True, "mode": args.mode, "project_name": args.project_name, **retry}
            finally:
                browser.close()
    except Exception as error:
        result = {"ok": False, "project_name": args.project_name, "error": str(error)}
    print(f"{RESULT_PREFIX}{json.dumps(result, ensure_ascii=True)}")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
