import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("M2 composes existing public creation commands with a fresh key per command", () => {
  const workspace = read("app/pages/projects/[project_id].vue");

  for (const component of ["StoryPlanningPanel", "ReferenceShelf", "GenerationPanel", "ProjectMaterials", "MediaPreviewDialog", "ProjectResultsPanel"]) {
    const typeImport = component === "GenerationPanel"
      ? ", { type GenerationFeedback }"
      : component === "ProjectMaterials"
        ? ", { type ProjectMaterialItem }"
        : "";
    if (component === "ProjectResultsPanel") {
      assert.match(workspace, /import ProjectResultsPanel, \{ type ProjectResultItem \} from "\.\.\/\.\.\/components\/studio\/ProjectResultsPanel\.vue";/);
    } else {
      assert.match(workspace, new RegExp(`import ${component}${typeImport} from "\\.\\./\\.\\./components/studio/${component}\\.vue";`));
    }
  }

  for (const symbol of ["createCreativeBriefRevision", "requestCreativePlan", "storyboardRevisions", "approveStoryboardRevision", "createProductionRun", "createUploadRequest", "confirmAssetUpload"]) {
    assert.match(workspace, new RegExp(symbol));
  }

  assert.match(workspace, /async function generateVideo\(\)/);
  assert.match(workspace, /await startAutomatedProduction\(current\.project\.id\)/);
  assert.match(workspace, /commandKey\("studio-auto-brief"\)/);
  assert.match(workspace, /commandKey\("studio-auto-plan"\)/);
  assert.match(workspace, /commandKey\("studio-auto-approve"\)/);
  assert.match(workspace, /commandKey\("studio-auto-production"\)/);
  assert.doesNotMatch(workspace, /await createGeneration\(shot\.id, commandKey\("studio-generation"\)\)/);
});

test("M2 separates project-local visual controls from internal platform names", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const composer = read("app/components/studio/StoryPlanningPanel.vue");
  const references = read("app/components/studio/ReferenceShelf.vue");
  const generation = read("app/components/studio/GenerationPanel.vue");
  const preview = read("app/components/studio/MediaPreviewDialog.vue");
  const source = `${workspace}\n${composer}\n${references}\n${generation}\n${preview}`;

  for (const label of ["告诉 AI 你想生成什么", "一键创作", "参考图可选", "系统会看图识别人物、场景和风格", "将按描述匹配职责", "开始生成视频", "调整后生成新版本", "预览视频", "第一张是场景，第二张是人物"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(composer, /AI 会在后台完成所有准备和制作/);
  assert.match(composer, /成片清晰度/);
  assert.match(composer, /标准清晰/);
  assert.match(composer, /720p，推荐/);
  assert.match(composer, /预计生成 \{\{ estimatedSegments\.length \}\} 段视频/);
  assert.match(composer, /以实际生成为准/);
  assert.match(composer, /segmentEstimateExplanation/);
  assert.match(composer, /aria-label="预计生成片段"/);
  assert.doesNotMatch(source, /确认故事计划|确认完整制作计划|生成故事计划|从故事开始|描述你的想法|分镜拆解|制作计划/);

  assert.doesNotMatch(source, /\/internal\//);
  assert.doesNotMatch(source, /\b(?:provider_request_id|object_key|veyra|minio|bullmq|outbox|SSE)\b/i);
  assert.doesNotMatch(source, /本地 Mock|模型参数|任务队列/);
});

test("M2 public workspace events refresh only the current project projection", () => {
  const events = read("app/composables/useProjectEvents.ts");
  const workspace = read("app/pages/projects/[project_id].vue");

  assert.match(events, /new EventSource\(`\/api\/v1\/events\?workspace_id=/);
  assert.match(events, /payload\.project_id !== selectedProjectId\.value/);
  assert.match(events, /scheduleCurrentProjectRefresh/);
  assert.match(events, /setTimeout/);
  assert.match(events, /eventSource\?\.close\(\)/);
  assert.match(workspace, /useProjectEvents/);
  assert.match(workspace, /refreshCurrentProject/);
  assert.match(workspace, /let projectRefreshInFlight: Promise<void> \| undefined;/);
  assert.match(workspace, /const response = await project\(expectedProjectId\);/);
  assert.doesNotMatch(workspace, /async function refreshCurrentProject\(\) \{[\s\S]*await loadProject/);
});

test("C12 public media events refresh project production progress and completed versions", () => {
  const events = read("app/composables/useProjectEvents.ts");

  for (const eventType of [
    "production_run.progressed",
    "production_run.blocked",
    "qc_report.completed",
    "video_version.succeeded",
    "video_version.failed",
  ]) {
    assert.match(events, new RegExp(eventType));
  }
});

test("M2 preview URLs, uploads, and references remain current-project scoped", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const session = read("app/composables/useProjectSession.ts");

  assert.match(workspace, /projectIdAtStart !== selectedProjectId\.value/);
  assert.match(workspace, /assetDownloadUrl/);
  assert.match(workspace, /releasePreview/);
  assert.match(session, /uploadFiles\.value = \[\]/);
  assert.match(session, /selectedReferenceIds\.value = \[\]/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
});

test("Studio keeps completed videos in a project-local V3-style results area", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const results = read("app/components/studio/ProjectResultsPanel.vue");
  const styles = read("app/assets/studio.css");
  const source = `${workspace}\n${results}`;

  assert.match(workspace, /const finalVideoResults = computed<ProjectResultItem\[]>\(\(\) =>/);
  assert.match(workspace, /projectVideoVersions\.value/);
  assert.match(workspace, /videoVersions\(expectedProjectId\)/);
  assert.match(workspace, /productionRuns\(expectedProjectId\)/);
  assert.match(workspace, /const projectClipResults = computed<ProjectResultItem\[]>\(\(\) =>/);
  assert.match(workspace, /task\.status === "SUCCEEDED"/);
  assert.match(workspace, /pair\.asset\.kind === "VIDEO"/);
  assert.match(workspace, /pair\.asset\.origin === "GENERATED"/);
  assert.match(workspace, /pair\.asset\.status === "READY"/);
  assert.match(workspace, /pair\.asset\.project_id === current\.project\.id/);
  assert.match(workspace, /const displayedProjectResults = computed<ProjectResultItem\[]>\(\(\) =>/);
  assert.match(workspace, /finalVideoResults\.value\.length/);
  assert.match(workspace, /projectClipResults\.value\.map/);
  assert.match(workspace, /历史成片/);
  assert.match(workspace, /来自这个项目此前完成的视频/);
  assert.match(workspace, /:items="displayedProjectResults"/);
  assert.match(workspace, /const selectedResultAssetId = ref\(""\);/);
  assert.match(workspace, /let resultPreviewRequest = 0;/);
  assert.match(workspace, /projectIdAtStart !== selectedProjectId\.value/);
  assert.match(workspace, /function releaseProjectResultPreview\(\)/);
  assert.match(workspace, /function syncProjectResultPreview\(\)/);
  assert.doesNotMatch(workspace, /if \(latest && !selectedResultAssetId\.value\)/);
  assert.match(workspace, /@download="downloadProjectResult"/);
  assert.match(workspace, /window\.location\.assign\(response\.data\.download_url\)/);
  assert.doesNotMatch(workspace, /link\.click\(\)/);
  assert.match(workspace, /查看历史生成片段/);
  assert.match(workspace, /retryProductionSegmentCommand/);
  assert.match(workspace, /@retry="retryProductionSegment"/);
  assert.match(results, /下载成片/);
  assert.match(workspace, /document\.getElementById\("project-results-title"\)/);
  for (const label of ["项目成果", "成片版本", "查看成片", "完成的成片会一直保留在这个项目里。"] ) {
    assert.match(results, new RegExp(label));
  }
  assert.match(results, /<video/);
  assert.match(results, /controls/);
  assert.match(results, /playsinline/);
  assert.doesNotMatch(results, /\bautoplay\b/);
  assert.match(styles, /\.project-studio-layout/);
  assert.match(styles, /\.project-results-panel/);
  assert.match(styles, /\.project-results-column\s*\{[\s\S]*position:\s*sticky/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1\.06fr\)\s+minmax\(420px,\s*0\.94fr\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|provider_request_id|object_key|veyra|minio|bullmq|outbox/i);
});

test("M2 lets a confirmed reference upload be followed by a distinct file selection", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const references = read("app/components/studio/ReferenceShelf.vue");

  assert.match(workspace, /uploadFiles\.value = \[\]/);
  assert.match(workspace, /uploadInputVersion\.value \+= 1/);
  assert.match(references, /:key="inputVersion"/);
  assert.match(references, /multiple/);
  assert.match(references, /@change="onFileChange"/);
  assert.match(references, /"update:files"/);
  assert.match(workspace, /for \(const file of files\)/);
  assert.match(workspace, /uploadFiles\.value = uploadFiles\.value\.filter/);
  assert.match(workspace, /最多还能添加/);
});

test("M2 exposes idempotent removal controls for mistaken user-uploaded materials", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const references = read("app/components/studio/ReferenceShelf.vue");
  const materials = read("app/components/studio/ProjectMaterials.vue");
  const api = read("app/composables/useControlApi.ts");

  assert.match(api, /deleteAsset/);
  assert.match(workspace, /@remove="removeProjectAsset"/);
  assert.match(workspace, /deleteAsset\(assetId, commandKey\("studio-asset-delete"\)\)/);
  assert.match(workspace, /planningDraft\.sourceAssetIds = planningDraft\.sourceAssetIds\.filter/);
  assert.match(references, /删除图片/);
  assert.match(materials, /删除资料/);
  assert.match(materials, /remove: \[assetId: string\]/);
  assert.doesNotMatch(workspace, /DELETE FROM|object_key/);
});

test("Studio hydrates selected references from the current brief instead of generated handoff bindings", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const hydrateBlock = workspace.match(/function hydrateCreation\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(workspace, /function eligibleReferenceImageIds\(ids: string\[\]\)/);
  assert.match(workspace, /function defaultSelectedReferenceIds\(\)/);
  assert.match(workspace, /\? eligibleReferenceImageIds\(brief\.source_asset_ids\)/);
  assert.match(workspace, /: readyReferenceImages\.value\.map\(\(asset\) => asset\.id\);/);
  assert.match(hydrateBlock, /selectedReferenceIds\.value = defaultSelectedReferenceIds\(\);/);
  assert.match(hydrateBlock, /syncPlanningReferenceSourceIds\(selectedReferenceIds\.value\);/);
  assert.doesNotMatch(hydrateBlock, /reference_bindings|currentCreation\.value/);
});

test("Studio keeps one visible input and hides story planning orchestration", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const composer = read("app/components/studio/StoryPlanningPanel.vue");
  const generation = read("app/components/studio/GenerationPanel.vue");

  assert.match(composer, /把想法、故事或小说情节写在这里/);
  assert.match(composer, /AI 会在后台处理后续步骤/);
  assert.match(composer, /预计生成 \{\{ estimatedSegments\.length \}\} 段视频/);
  assert.match(composer, /约 \{\{ segment\.durationSeconds \}\} 秒/);
  assert.match(composer, /story-resolution-480p/);
  assert.match(composer, /story-resolution-720p/);
  assert.doesNotMatch(composer, /story-source-assets|可用于本次创作的素材/);
  assert.doesNotMatch(workspace, /<IdeaComposer/);
  assert.doesNotMatch(workspace, /@plan="requestStoryPlan"|@approve="approveStoryPlan"|@confirm-production="confirmProductionPlan"/);
  assert.equal((workspace.match(/@generate="generateVideo"/g) ?? []).length, 1);
  assert.match(generation, /@click="emit\('generate'\)"/);
  assert.match(generation, /开始生成视频/);
  assert.match(workspace, /async function startAutomatedProduction/);
  assert.match(workspace, /waitForAutoStoryboard/);
  assert.match(workspace, /approveStoryboardRevision/);
  assert.match(workspace, /createProductionRun/);
});

test("Studio keeps composition preferences compact and uses one vertical creation flow", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const styles = read("app/assets/studio.css");

  assert.match(workspace, /readyPlanningDocumentIds/);
  assert.doesNotMatch(workspace, /planningSourceAssets|selected-source-asset-ids/);
  assert.match(styles, /\.creation-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /\.story-settings\s*\{/);
  assert.match(styles, /\.quality-options\s*\{/);
  assert.match(styles, /\.project-studio-layout\s*\{[\s\S]*minmax\(420px,\s*0\.94fr\)/);
});

test("FAILED keeps explicit retry while enabling a separate new-version generation command", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const generation = read("app/components/studio/GenerationPanel.vue");

  assert.match(workspace, /const newVersionTaskStatuses = new Set<TaskRun\["status"\]>\(\["SUCCEEDED", "FAILED"\]\);/);
  assert.match(workspace, /hasProjectResult\.value/);
  assert.match(workspace, /const failedProductionSegment = computed/);
  assert.match(workspace, /const canRetry = computed/);
  assert.match(workspace, /retryTaskRun\(latestTask\.value\.id, commandKey\("studio-task-retry"\)\)/);
  assert.match(workspace, /:creates-new-version="createsNewVersion"/);
  assert.doesNotMatch(workspace, /"BILLING_FAILED"/);
  assert.match(generation, /调整后生成新版本/);
  assert.match(generation, /@click="emit\('retry'\)"/);
});

test("Studio projects public production progress into safe Chinese autopilot progress", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const progress = read("app/composables/useCreationProgress.ts");
  const generation = read("app/components/studio/GenerationPanel.vue");
  const visibleSource = `${progress}\n${generation}`;

  assert.match(progress, /export function creationProgressFor/);
  assert.match(progress, /export function productionProgressFor/);
  for (const status of [
    "CREATED",
    "QUEUED",
    "RUNNING",
    "PROCESSING",
    "DOWNLOADING",
    "BILLING_PENDING",
    "SUCCEEDED",
    "FAILED",
    "BILLING_FAILED",
    "RETRY_SCHEDULED",
    "ABANDONED",
  ]) {
    assert.match(progress, new RegExp(`"${status}"`));
  }
  for (const status of ["CONFIRMED", "GENERATING", "REVIEWING", "RENDERING", "SUCCEEDED", "BLOCKED", "FAILED"]) {
    assert.match(progress, new RegExp(`"${status}"`));
  }
  for (const label of ["理解创作需求", "准备视频内容", "生成视频", "整理成片", "完整成片已生成", "本次制作未完成"]) {
    assert.match(visibleSource, new RegExp(label));
  }
  for (const label of ["正在检查片段衔接", "正在优化片段衔接", "衔接检查需要留意"]) {
    assert.match(visibleSource, new RegExp(label));
  }
  for (const status of ["CHECKING", "AUTO_REPAIRING", "NEEDS_ATTENTION"]) {
    assert.match(progress, new RegExp(`"${status}"`));
  }

  assert.match(workspace, /productionProgressFor\(currentProductionProgress\.value,\s*Boolean\(planningDraft\.sourceText\.trim\(\)\),\s*creationBusy\.value \|\| planningBusy\.value \|\| productionBusy\.value\)/);
  assert.match(workspace, /:progress="creationProgress"/);
  assert.doesNotMatch(visibleSource, /\b(?:provider_request_id|provider|queue|bullmq|outbox|sse|model|object_key)\b/i);
});

test("Studio production details keep the backend failure reason and use a stable two-row segment layout", () => {
  const panel = read("app/components/studio/ProductionProgressPanel.vue");
  const styles = read("app/assets/studio.css");

  assert.match(panel, /class="production-segment-copy"/);
  assert.match(panel, /class="production-segment-reason"/);
  assert.match(panel, /class="production-segment-actions"/);
  assert.match(panel, /return segment\.safe_summary \|\|/);
  assert.doesNotMatch(panel, /if \(segment\.status === "FAILED"\) return segment\.retryable \?/);
  assert.match(styles, /\.production-segment-list li\s*\{[\s\S]*grid-template-areas:[\s\S]*"number copy status"[\s\S]*"number actions actions"/);
  assert.match(styles, /\.production-segment-reason\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
});

test("Studio acknowledges automated generation before waiting for later project refreshes", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const generation = read("app/components/studio/GenerationPanel.vue");

  assert.match(workspace, /planningMessage\.value = "AI 正在理解你的描述。"/);
  assert.match(workspace, /planningMessage\.value = "AI 正在准备视频内容。"/);
  assert.match(workspace, /planningMessage\.value = "AI 已开始制作视频。"/);
  assert.match(workspace, /applyCreativeBriefRevision\(briefResponse\.data\);/);
  assert.match(workspace, /applyStoryboardRevision\(approved\.data\);/);
  assert.match(workspace, /applyProductionRun\(production\.data\);/);
  assert.match(workspace, /PRODUCTION_RUN_ACTIVE_CONFLICT: "这个项目已有视频正在制作，请稍后查看。"/);
  assert.match(generation, /generation-feedback/);
});

test("Studio lets visual-only descriptions use the existing production path while gating explicit dialogue", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const narrationGate = workspace.match(/if \(!hasApprovedNarration\) \{[\s\S]*?\n  \}\n\n  planningMessage\.value = "AI 已开始制作视频。"/u)?.[0] ?? "";

  assert.match(narrationGate, /if \(quotedNarrationSections\.length > 0\) \{/);
  assert.match(narrationGate, /createNarrationScriptRevision\(/);
  assert.match(narrationGate, /NARRATION_APPROVAL_REQUIRED/);
  assert.doesNotMatch(narrationGate, /if \(quotedSections\.length === 0\)/);
  assert.match(narrationGate, /Visual-only descriptions have no source transcript/);
  assert.match(workspace, /const quotedNarrationSections =/);
  assert.match(workspace, /const captionPolicy = ref<"OFF" \| "REQUIRED">\("OFF"\);/);
  assert.match(workspace, /value="OFF"/);
  assert.match(workspace, /value="REQUIRED"/);
  assert.match(workspace, /caption_policy: captionPolicy\.value/);
  assert.doesNotMatch(workspace, /caption_policy: quotedNarrationSections\.length > 0 \? "REQUIRED" : "OFF"/);
  assert.match(workspace, /字幕来自已检查的音频转写，文字需人工复核/);
  assert.match(workspace, /DELIVERY_PLAN_STATE_INVALID: "旁白脚本还未完成样音审批和时间轴确认，请完成审批后再开始制作。"/);
});

test("Studio native-provider branch does not require a user-uploaded narration asset", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  assert.match(workspace, /const providerNativeAudioAvailable = computed\(\(\) => providerNativeAudioCapability\.value\?\.status === "AVAILABLE"\)/);
  assert.match(workspace, /async function startAutomatedProduction\(projectId: string\) \{[\s\S]*?await refreshAudioCapabilities\(projectId\);/);
  assert.match(workspace, /if \(!providerNativeAudioAvailable\.value\) \{/);
  const nativeBranch = workspace.slice(workspace.indexOf("// A speech-bearing delivery uses the source-owned native provider track"), workspace.indexOf("if (!providerNativeAudioAvailable.value)"));
  assert.doesNotMatch(nativeBranch, /upload|createUploadRequest|confirmAssetUpload|narrationAudio/i);
  assert.match(nativeBranch, /do not[\r\n]+\s*\/\/ create a platform narration script/);
});

test("Studio labels local demo output and never treats it as an automatic playback action", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const generation = read("app/components/studio/GenerationPanel.vue");
  const results = read("app/components/studio/ProjectResultsPanel.vue");
  const config = read("nuxt.config.ts");
  const localRunner = read("../../infrastructure/local/start-full-local-stack.ps1");

  assert.match(config, /localDemoMode = process\.env\.STUDIO_LOCAL_DEMO_MODE === "true"/);
  assert.match(localRunner, /STUDIO_LOCAL_DEMO_MODE = if \(\$VideoProvider -eq "mock"\) \{ "true" \} else \{ "false" \}/);
  assert.match(localRunner, /\[ValidateSet\("mock", "sub2api"\)\]/);
  assert.match(workspace, /const isLocalDemoMode = computed/);
  assert.match(workspace, /:demo-mode="isLocalDemoMode"/);
  assert.match(generation, /本地演示运行/);
  assert.match(results, /演示结果仅用于检查制作流程/);
});

test("Local real-provider credentials are scoped to the Task Worker", () => {
  const localRunner = read("../../infrastructure/local/start-full-local-stack.ps1");
  const environmentBlock = localRunner.match(/\$localEnvironment = \[ordered\]@\{[\s\S]*?\n\}/u)?.[0] ?? "";
  const taskWorkerBlock = localRunner.match(/try \{[\s\S]*?\$services \+= Start-LocalService -Name "Task Worker"[\s\S]*?\n\} finally \{[\s\S]*?\n\}/u)?.[0] ?? "";
  const productionWorkerStart = localRunner.indexOf('$services += Start-LocalService -Name "Production Worker"');
  const taskWorkerEnd = localRunner.indexOf("\n$services += Start-LocalService -Name \"Production Worker\"");

  assert.doesNotMatch(environmentBlock, /SUB2API_VIDEO_(?:BASE_URL|API_KEY)/u);
  assert.match(localRunner, /SetEnvironmentVariable\("SUB2API_VIDEO_BASE_URL", \$null, "Process"\)/u);
  assert.match(localRunner, /SetEnvironmentVariable\("SUB2API_VIDEO_API_KEY", \$null, "Process"\)/u);
  assert.match(taskWorkerBlock, /SetEnvironmentVariable\("SUB2API_VIDEO_BASE_URL", \$sub2ApiVideoBaseUrl, "Process"\)/u);
  assert.match(taskWorkerBlock, /SetEnvironmentVariable\("SUB2API_VIDEO_API_KEY", \$sub2ApiVideoApiKey, "Process"\)/u);
  assert.ok(taskWorkerEnd > -1 && productionWorkerStart === taskWorkerEnd + 1, "Production Worker must start after Task Worker cleanup.");
});

test("local browser downloads sign against localhost while server storage stays on loopback", () => {
  const localRunner = read("../../infrastructure/local/start-full-local-stack.ps1");
  assert.match(localRunner, /S3_ENDPOINT = "http:\/\/127\.0\.0\.1:9002"/u);
  assert.match(localRunner, /S3_PUBLIC_ENDPOINT = "http:\/\/localhost:9002"/u);
});

test("Studio defaults every selected image to reference material without exposing model mode choices", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const references = read("app/components/studio/ReferenceShelf.vue");
  const api = read("app/composables/useControlApi.ts");
  const source = `${workspace}\n${references}\n${api}`;

  for (const label of ["描述中明确写出的图片职责会优先使用", "最多选择 7 张参考图"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(references, /const limit = 7;/);
  assert.match(workspace, /syncPlanningReferenceSourceIds\(next\);/);
  assert.match(workspace, /source_asset_ids: eligiblePlanningSourceIds\(planningDraft\.sourceAssetIds\)/);
  assert.doesNotMatch(source, /作为开场画面|开场画面只能选择一张图片|最多选择 3 张|referenceInputMode|reference_asset_ids:\s*selectedReferenceIds/);
});

test("Studio defaults confirmed and legacy-ready images to persistent reference material", () => {
  const workspace = read("app/pages/projects/[project_id].vue");
  const references = read("app/components/studio/ReferenceShelf.vue");

  assert.match(workspace, /const selectedIds = uniqueReferenceIds\(\[\.\.\.selectedReferenceIds\.value, request\.data\.asset_id\]\);/);
  assert.match(workspace, /planningDraft\.sourceAssetIds = uniqueReferenceIds\(\[\.\.\.planningDraft\.sourceAssetIds, request\.data\.asset_id\]\);/);
  assert.match(workspace, /: readyReferenceImages\.value\.map\(\(asset\) => asset\.id\);/);
  assert.match(workspace, /@update:selected-ids="updateSelectedReferenceIds"/);
  assert.doesNotMatch(workspace, /@update:mode="updateReferenceInputMode"|persistReferenceBindings|updateReferenceInputMode/);
  assert.match(references, /本次会使用 \{\{ selectedIds\.length \}\} 张参考图。/);
  assert.match(references, /尚未选择用于本次视频的参考图/);
  assert.doesNotMatch(references, /还没有参考图/);
});

test("Studio never lets derived handoff images return to a new story reference set", () => {
  const workspace = read("app/pages/projects/[project_id].vue");

  assert.match(workspace, /function eligiblePlanningSourceIds\(ids: string\[\]\)/);
  assert.match(workspace, /readyPlanningDocumentIds\.value/);
  assert.match(workspace, /asset\.origin === "USER_UPLOAD" && asset\.kind === "DOCUMENT"/);
  assert.match(workspace, /planningDraft\.sourceAssetIds = eligiblePlanningSourceIds\(brief\.source_asset_ids\);/);
  assert.match(workspace, /planningDraft\.sourceAssetIds = eligiblePlanningSourceIds\(\[\.\.\.readyPlanningDocumentIds\.value, \.\.\.ids\]\);/);
});

test("Studio presents safe corrective guidance for a persisted provider rejection", () => {
  const workspace = read("app/pages/projects/[project_id].vue");

  assert.match(workspace, /function taskFailureMessage\(task: TaskRun\)/);
  assert.match(workspace, /task\.error\?\.code === "PROVIDER_REJECTED"/);
  assert.match(workspace, /本次创作已进入生成阶段，但没有完成/);
  assert.match(workspace, /PROVIDER_REJECTED: "本次创作已进入生成阶段，但没有完成/);
});
