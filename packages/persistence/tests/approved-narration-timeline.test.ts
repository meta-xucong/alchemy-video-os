import assert from "node:assert/strict";
import test from "node:test";

import type { PlatformDatabase } from "../src/db.js";
import { findApprovedNarrationTimeline } from "../src/approved-narration-timeline.js";

const workspaceId = "ws_timeline_workspace";
const projectId = "prj_timeline_project";
const otherWorkspaceId = "ws_other_workspace";
const deliveryPlanRevisionId = "dpr_timeline_plan";
const timelineId = "tlp_timeline_ready";
const scriptId = "nsr_timeline_script";
const assetVersionId = "nav_timeline_asset";
const assetId = "ast_timeline_audio";
const sha256 = "a".repeat(64);
const timestamp = "2026-08-30T00:00:00.000Z";

const scriptRow = (overrides: Record<string, unknown> = {}) => ({
  id: scriptId,
  workspaceId,
  projectId,
  deliveryPlanRevisionId,
  status: "APPROVED",
  sourceScriptHash: sha256,
  displaySections: [{ id: "sec_1", text: "批准旁白" }],
  spokenSections: [{ id: "sec_1", display_text: "批准旁白", provider_text: "批准旁白", pronunciation_guides: [], delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 } }],
  language: "zh-CN",
  normalizationVersion: "c12.7b-local-v1",
  decisionReasons: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const timelineRow = (overrides: Record<string, unknown> = {}) => ({
  id: timelineId,
  workspaceId,
  projectId,
  deliveryPlanRevisionId,
  narrationScriptRevisionId: scriptId,
  narrationAssetVersionId: assetVersionId as string | null,
  effectiveDurationMs: 1_000,
  narrationSections: [{ section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY" }],
  visualSegments: [{ sequence: 1, start_ms: 0, end_ms: 1_000, provider_duration_seconds: 1 }],
  status: "READY",
  decisionReasons: [],
  createdAt: timestamp,
  ...overrides,
});

const assetVersionRow = (overrides: Record<string, unknown> = {}) => ({
  id: assetVersionId,
  workspaceId,
  projectId,
  narrationScriptRevisionId: scriptId,
  assetId,
  provider: "piper",
  voiceId: "zh-CN",
  providerSettings: {},
  durationMs: 1_000,
  sampleApproved: false,
  wordTimestampsAssetId: null,
  canonicalTranscriptCheck: { status: "CHECKED", transcript_asset_id: null, matches: true, accuracy: 1, issues: [] },
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const audioAssetRow = (overrides: Record<string, unknown> = {}) => ({
  id: assetId,
  workspaceId,
  projectId,
  kind: "AUDIO",
  origin: "DERIVED",
  status: "READY",
  objectKey: `${workspaceId}/${projectId}/${assetId}/narration.wav`,
  sha256,
  mimeType: "audio/wav",
  byteSize: 64,
  durationMs: 1_000,
  metadata: {},
  ...overrides,
});

type TableName = "timeline_plans" | "narration_script_revisions" | "narration_asset_versions" | "assets" | "outbox_events";

const fakeDatabase = (
  rows: Partial<Record<TableName, unknown[]>>,
  sequences: Partial<Record<TableName, unknown[][]>> = {},
) => {
  const symbols = Symbol.for("drizzle:Name");
  const calls = new Map<TableName, number>();
  const db = {
    select() {
      return {
        from(table: Record<symbol, unknown>) {
          const tableName = table[symbols] as TableName;
          return {
            where() {
              const query = {
                orderBy() { return query; },
                limit: async () => {
                  const sequence = sequences[tableName];
                  if (sequence) {
                    const index = calls.get(tableName) ?? 0;
                    calls.set(tableName, index + 1);
                    return sequence[Math.min(index, sequence.length - 1)] ?? [];
                  }
                  return rows[tableName] ?? [];
                },
              };
              return query;
            },
          };
        },
      };
    },
  };
  return db as unknown as PlatformDatabase;
};

test("approved timeline maps absolute cues and approved audio metadata", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow()],
    narration_script_revisions: [scriptRow()],
    narration_asset_versions: [assetVersionRow()],
    assets: [audioAssetRow()],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.deepEqual(result?.narrationSegments, [{
    text: "批准旁白",
    startMs: 0,
    pronunciationGuides: [],
    pauseBeforeMs: 0,
    pauseAfterMs: 0,
    pace: "NATURAL",
    energy: "NEUTRAL",
  }]);
  assert.deepEqual(result?.visualSegments, [{ sequence: 1, start_ms: 0, end_ms: 1_000, provider_duration_seconds: 1 }]);
  assert.equal(result?.narrationAsset?.durationMs, 1_000);
  assert.equal(result?.narrationAsset?.objectKey, `${workspaceId}/${projectId}/${assetId}/narration.wav`);
});

test("approved timeline preserves an explicit HOLD tail without treating it as spoken text", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({ narrationAssetVersionId: null,
      effectiveDurationMs: 2_000,
      narrationSections: [
        { section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY" },
        { section_id: "sec_1-tail-hold", start_ms: 1_000, end_ms: 2_000, visual_role: "HOLD" },
      ],
      visualSegments: [{ sequence: 1, start_ms: 0, end_ms: 2_000, provider_duration_seconds: 2 }],
    })],
    narration_script_revisions: [scriptRow()],
    narration_asset_versions: [assetVersionRow({ durationMs: 2_000 })],
    assets: [audioAssetRow({ durationMs: 2_000 })],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.deepEqual(result?.narrationSections, [
    { sectionId: "sec_1", startMs: 0, endMs: 1_000, visualRole: "PRIMARY" },
    { sectionId: "sec_1-tail-hold", startMs: 1_000, endMs: 2_000, visualRole: "HOLD" },
  ]);
  assert.deepEqual(result?.narrationSegments.map((segment) => segment.text), ["批准旁白"]);
});

test("cue-only timeline preserves three contiguous absolute windows without attaching an asset", async () => {
  const sections = ["sec_1", "sec_2", "sec_3"].map((id, index) => ({
    id,
    display_text: `第${index + 1}段`,
    provider_text: `第${index + 1}段`,
    pronunciation_guides: [],
    delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 },
  }));
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({ narrationAssetVersionId: null,
      effectiveDurationMs: 30_000,
      narrationSections: [0, 1, 2].map((index) => ({ section_id: `sec_${index + 1}`, start_ms: index * 10_000, end_ms: (index + 1) * 10_000, visual_role: "PRIMARY" })),
      visualSegments: [0, 1, 2].map((index) => ({ sequence: index + 1, start_ms: index * 10_000, end_ms: (index + 1) * 10_000, provider_duration_seconds: 10 })),
    })],
    narration_script_revisions: [scriptRow({ spokenSections: sections, displaySections: sections.map((section) => ({ id: section.id, text: section.display_text })) })],
    narration_asset_versions: [assetVersionRow({ durationMs: 30_000 })],
    assets: [audioAssetRow({ durationMs: 30_000 })],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.deepEqual(result?.visualSegments.map((segment) => segment.end_ms), [10_000, 20_000, 30_000]);
  assert.deepEqual(result?.narrationSegments.map((segment) => segment.startMs), [0, 10_000, 20_000]);
});

test("approved timeline maps measured formal narration assets no longer than each PRIMARY window", async () => {
  const sections = ["sec_1", "sec_2"].map((id, index) => ({
    id,
    display_text: `第${index + 1}段`,
    provider_text: `第${index + 1}段`,
    pronunciation_guides: [],
    delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 },
  }));
  const versionOne = assetVersionRow({ id: "nav_section_one", assetId: "ast_section_one", durationMs: 900 });
  const versionTwo = assetVersionRow({ id: "nav_section_two", assetId: "ast_section_two", durationMs: 900 });
  const assetOne = audioAssetRow({ id: "ast_section_one", objectKey: `${workspaceId}/${projectId}/ast_section_one/section-one.wav`, durationMs: 900 });
  const assetTwo = audioAssetRow({ id: "ast_section_two", objectKey: `${workspaceId}/${projectId}/ast_section_two/section-two.wav`, durationMs: 900 });
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({
      narrationAssetVersionId: null,
      effectiveDurationMs: 2_000,
      narrationSections: [
        { section_id: "sec_1", start_ms: 0, end_ms: 1_000, visual_role: "PRIMARY", narration_asset_version_id: "nav_section_one" },
        { section_id: "sec_2", start_ms: 1_000, end_ms: 2_000, visual_role: "PRIMARY", narration_asset_version_id: "nav_section_two" },
      ],
      visualSegments: [{ sequence: 1, start_ms: 0, end_ms: 2_000, provider_duration_seconds: 2 }],
    })],
    narration_script_revisions: [scriptRow({ spokenSections: sections, displaySections: sections.map((section) => ({ id: section.id, text: section.display_text })) })],
    outbox_events: [],
  }, {
    narration_asset_versions: [[versionOne], [versionTwo]],
    assets: [[assetOne], [assetTwo]],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.ok(result);
  assert.equal(result?.narrationAsset, undefined);
  assert.deepEqual(result?.narrationAssets?.map((asset) => ({ sectionId: asset.sectionId, assetVersionId: asset.assetVersionId, id: asset.id, durationMs: asset.durationMs })), [
    { sectionId: "sec_1", assetVersionId: "nav_section_one", id: "ast_section_one", durationMs: 900 },
    { sectionId: "sec_2", assetVersionId: "nav_section_two", id: "ast_section_two", durationMs: 900 },
  ]);
  assert.deepEqual(result?.narrationSections.map((section) => section.narrationAssetVersionId), ["nav_section_one", "nav_section_two"]);
});

test("formal full narration rejects multi-section windows until Runtime consumes OpenMontage full_mix facts", async () => {
  const sections = ["sec_1", "sec_2", "sec_3"].map((id, index) => ({
    id,
    display_text: `第${index + 1}段`,
    provider_text: `第${index + 1}段`,
    pronunciation_guides: [],
    delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 },
  }));
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({
      effectiveDurationMs: 30_000,
      narrationSections: [0, 1, 2].map((index) => ({ section_id: `sec_${index + 1}`, start_ms: index * 10_000, end_ms: (index + 1) * 10_000, visual_role: "PRIMARY" })),
      visualSegments: [0, 1, 2].map((index) => ({ sequence: index + 1, start_ms: index * 10_000, end_ms: (index + 1) * 10_000, provider_duration_seconds: 10 })),
    })],
    narration_script_revisions: [scriptRow({ spokenSections: sections, displaySections: sections.map((section) => ({ id: section.id, text: section.display_text })) })],
    narration_asset_versions: [assetVersionRow({ durationMs: 30_000 })],
    assets: [audioAssetRow({ durationMs: 30_000 })],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.equal(result, undefined);
});

test("historical sample rows are never loaded as formal narration", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow()],
    narration_script_revisions: [scriptRow()],
    narration_asset_versions: [assetVersionRow({ sampleApproved: true })],
    assets: [audioAssetRow()],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.equal(result, undefined);
});

test("formal version reusing the approved sample object is rejected by the loader", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow()],
    narration_script_revisions: [scriptRow()],
    narration_asset_versions: [assetVersionRow({ sampleApproved: false, assetId })],
    assets: [audioAssetRow()],
    outbox_events: [{ payload: { data: { sample_asset_id: assetId } } }],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.equal(result, undefined);
});

test("timeline without an asset version stays on cue synthesis and does not attach another sample", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({ narrationAssetVersionId: null })],
    narration_script_revisions: [scriptRow()],
    narration_asset_versions: [assetVersionRow()],
    assets: [audioAssetRow()],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.ok(result);
  assert.equal(result?.narrationAsset, undefined);
});

test("cross-workspace rows fail closed even when a misbehaving executor returns them", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({ workspaceId: otherWorkspaceId })],
    narration_script_revisions: [scriptRow({ workspaceId: otherWorkspaceId })],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.equal(result, undefined);
});

test("strict schema parsing rejects internal row fields and malformed timeline facts", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow({ narrationSections: [{ section_id: "sec_1", start_ms: "not-a-number", end_ms: 1_000, visual_role: "PRIMARY" }], internalOnly: true })],
    narration_script_revisions: [scriptRow({ internalOnly: true })],
    narration_asset_versions: [assetVersionRow()],
    assets: [audioAssetRow()],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.equal(result, undefined);
});

test("approved narration rejects asset metadata whose measured duration disagrees with the version", async () => {
  const result = await findApprovedNarrationTimeline(fakeDatabase({
    timeline_plans: [timelineRow()],
    narration_script_revisions: [scriptRow()],
    narration_asset_versions: [assetVersionRow({ durationMs: 1_000 })],
    assets: [audioAssetRow({ durationMs: 1_001 })],
  }), workspaceId, projectId, deliveryPlanRevisionId);

  assert.equal(result, undefined);
});

test("approved narration rejects invalid object key, hash, byte size, or MIME metadata", async () => {
  for (const overrides of [
    { objectKey: "other/scope/audio.wav" },
    { sha256: "not-a-sha" },
    { byteSize: 0 },
    { mimeType: "application/octet-stream" },
    { mimeType: "audio/flac" },
  ]) {
    const result = await findApprovedNarrationTimeline(fakeDatabase({
      timeline_plans: [timelineRow()],
      narration_script_revisions: [scriptRow()],
      narration_asset_versions: [assetVersionRow()],
      assets: [audioAssetRow(overrides)],
    }), workspaceId, projectId, deliveryPlanRevisionId);
    assert.equal(result, undefined);
  }
});

test("approved timeline rejects duplicate, overlapping, or uncovered windows", async () => {
  const invalidTimelines = [
    { narrationSections: [
      { section_id: "sec_1", start_ms: 0, end_ms: 600, visual_role: "PRIMARY" },
      { section_id: "sec_1", start_ms: 600, end_ms: 1_000, visual_role: "PRIMARY" },
    ] },
    { narrationSections: [
      { section_id: "sec_1", start_ms: 0, end_ms: 700, visual_role: "PRIMARY" },
      { section_id: "sec_2", start_ms: 600, end_ms: 1_000, visual_role: "PRIMARY" },
    ] },
    { narrationSections: [
      { section_id: "sec_1", start_ms: 0, end_ms: 1_001, visual_role: "PRIMARY" },
    ] },
    { visualSegments: [
      { sequence: 1, start_ms: 0, end_ms: 400, provider_duration_seconds: 1 },
      { sequence: 3, start_ms: 400, end_ms: 1_000, provider_duration_seconds: 1 },
    ] },
    { visualSegments: [
      { sequence: 1, start_ms: 0, end_ms: 600, provider_duration_seconds: 1 },
      { sequence: 2, start_ms: 500, end_ms: 1_000, provider_duration_seconds: 1 },
    ] },
    { visualSegments: [
      { sequence: 1, start_ms: 0, end_ms: 900, provider_duration_seconds: 1 },
    ] },
  ];
  for (const overrides of invalidTimelines) {
    const result = await findApprovedNarrationTimeline(fakeDatabase({
      timeline_plans: [timelineRow(overrides)],
      narration_script_revisions: [scriptRow({
        spokenSections: [
          { id: "sec_1", display_text: "批准旁白", provider_text: "批准旁白", pronunciation_guides: [], delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 } },
          { id: "sec_2", display_text: "第二句", provider_text: "第二句", pronunciation_guides: [], delivery: { pace: "NATURAL", energy: "NEUTRAL", emphasis: [], pause_before_ms: 0, pause_after_ms: 0 } },
        ],
      })],
      narration_asset_versions: [assetVersionRow()],
      assets: [audioAssetRow()],
    }), workspaceId, projectId, deliveryPlanRevisionId);
    assert.equal(result, undefined);
  }
});
