import { and, desc, eq } from "drizzle-orm";

import {
  MediaRuntimeAudioInspectionSchema,
  NarrationAssetVersionSchema,
  NarrationScriptRevisionSchema,
  TimelinePlanSchema,
} from "@alchemy-video/contracts";

import type { PlatformDatabase } from "./db.js";
import { assets, narrationAssetVersions, narrationScriptRevisions, outboxEvents, timelinePlans } from "./schema.js";

/**
 * Private composition snapshot assembled from the C12.7B approval facts.
 * Consumers receive object metadata only; the worker reads bytes through its
 * StoragePort and never receives a public URL or database row.
 */
export type ApprovedNarrationTimeline = {
  /** Private absolute timing facts copied from the approved TimelinePlan. */
  narrationSections: Array<{
    sectionId: string;
    startMs: number;
    endMs: number;
    visualRole: "PRIMARY" | "BROLL" | "HOLD";
    /** Source OpenMontage section asset mapping; omitted for legacy full-track plans. */
    narrationAssetVersionId?: string;
  }>;
  narrationSegments: Array<{
    text: string;
    startMs: number;
    pronunciationGuides: Array<{ source: string; spoken: string; reason: string }>;
    pauseBeforeMs: number;
    pauseAfterMs: number;
    pace: "SLOW" | "NATURAL" | "FAST";
    energy: "CALM" | "NEUTRAL" | "EMPHATIC";
  }>;
  visualSegments: Array<{ sequence: number; start_ms: number; end_ms: number; provider_duration_seconds: number }>;
  effectiveDurationMs: number;
  narrationAsset?: {
    id: string;
    workspaceId: string;
    projectId: string;
    objectKey: string;
    sha256: string;
    byteSize: number;
    mimeType: string;
    durationMs: number;
    /** Optional persisted AudioTrackPlan mix facts; absence is not a default. */
    gainDb?: string;
    fadeInMs?: number;
    fadeOutMs?: number;
  };
  /** Independently measured formal narration assets, one per PRIMARY section. */
  narrationAssets?: Array<{
    sectionId: string;
    assetVersionId: string;
    id: string;
    workspaceId: string;
    projectId: string;
    objectKey: string;
    sha256: string;
    byteSize: number;
    mimeType: string;
    durationMs: number;
    gainDb?: string;
    fadeInMs?: number;
    fadeOutMs?: number;
  }>;
  transcriptTimingAssetId?: string;
  narrationScriptText: string;
};

const sampleAssetIdFromApprovalPayload = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const sampleAssetId = (data as { sample_asset_id?: unknown }).sample_asset_id;
  return typeof sampleAssetId === "string" && sampleAssetId.length > 0 ? sampleAssetId : undefined;
};

// OpenMontage binds each narration file to an absolute visual window and
// requires narration not to exceed that window.  Shorter speech is resolved
// later by the Runtime/Worker only when declared MUSIC or HOLD/BROLL coverage
// exists; the persistence loader must not invent a second duration rule.
const sectionDurationMatchesMeasuredAsset = (sectionDurationMs: number, measuredDurationMs: number) =>
  measuredDurationMs <= sectionDurationMs;

// Keep the persistence consumer aligned with the existing Runtime inspection
// contract.  A generic `audio/*` row could otherwise reach composition and
// fail only after the Worker has claimed the run.
const isSupportedNarrationMimeType = (value: unknown): value is "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/pcm" =>
  typeof value === "string" && MediaRuntimeAudioInspectionSchema.shape.mime_type.safeParse(value).success;

// OpenMontage scene-director permits only a short breathing pause; without
// an explicit HOLD/BROLL/ambient role, a gap over one second is not an
// approved narration window and must fail closed.
const MAX_UNDECLARED_NARRATION_GAP_MS = 1_000;

/**
 * Load only a READY TimelinePlan whose script/sample/audio facts are approved
 * in the same workspace and project. A plan without an asset-version id is
 * intentionally the cue-synthesis branch; it must not silently attach some
 * other sample from the script revision.
 */
export async function findApprovedNarrationTimeline(
  db: PlatformDatabase,
  workspaceId: string,
  projectId: string,
  deliveryPlanRevisionId: string,
): Promise<ApprovedNarrationTimeline | undefined> {
  const [timeline] = await db.select().from(timelinePlans).where(and(
    eq(timelinePlans.workspaceId, workspaceId),
    eq(timelinePlans.projectId, projectId),
    eq(timelinePlans.deliveryPlanRevisionId, deliveryPlanRevisionId),
    eq(timelinePlans.status, "READY"),
  )).orderBy(desc(timelinePlans.createdAt)).limit(1);
  if (!timeline
    || timeline.workspaceId !== workspaceId
    || timeline.projectId !== projectId
    || timeline.deliveryPlanRevisionId !== deliveryPlanRevisionId) return undefined;

  const [script] = await db.select().from(narrationScriptRevisions).where(and(
    eq(narrationScriptRevisions.workspaceId, workspaceId),
    eq(narrationScriptRevisions.projectId, projectId),
    eq(narrationScriptRevisions.id, timeline.narrationScriptRevisionId),
    eq(narrationScriptRevisions.status, "APPROVED"),
  )).limit(1);
  if (!script
    || script.workspaceId !== workspaceId
    || script.projectId !== projectId
    || script.deliveryPlanRevisionId !== timeline.deliveryPlanRevisionId
    || script.id !== timeline.narrationScriptRevisionId) return undefined;

  const [assetVersion] = timeline.narrationAssetVersionId
    ? await db.select().from(narrationAssetVersions).where(and(
      eq(narrationAssetVersions.workspaceId, workspaceId),
      eq(narrationAssetVersions.projectId, projectId),
      eq(narrationAssetVersions.id, timeline.narrationAssetVersionId),
      // A sample approval row is a preview fact, not a consumable full
      // narration asset.  Only the formal version path (sample flag unset)
      // may feed the production composition snapshot.
      eq(narrationAssetVersions.sampleApproved, false),
    )).limit(1)
    : [];
  if (timeline.narrationAssetVersionId && (!assetVersion
    || assetVersion.workspaceId !== workspaceId
    || assetVersion.projectId !== projectId
    || assetVersion.id !== timeline.narrationAssetVersionId)) return undefined;
  if (assetVersion && assetVersion.narrationScriptRevisionId !== script.id) return undefined;
  // Re-check the role after the database predicate as well.  The loader is a
  // safety boundary and must fail closed even if a custom executor ignores a
  // filter or returns a historical sample row.
  if (assetVersion?.sampleApproved) return undefined;
  // The approval event is the durable sample fact for the current command
  // surface.  A formal version that reuses that exact object is still the
  // sample bytes and must not become the production narration track.
  const [approvalEvent] = await db.select({ payload: outboxEvents.payload }).from(outboxEvents).where(and(
    eq(outboxEvents.workspaceId, workspaceId),
    eq(outboxEvents.projectId, projectId),
    eq(outboxEvents.aggregateType, "narration_plan_revision"),
    eq(outboxEvents.aggregateId, script.id),
    eq(outboxEvents.eventType, "narration_script.approved"),
  )).orderBy(desc(outboxEvents.occurredAt)).limit(1);
  if (assetVersion) {
    const payload = approvalEvent?.payload;
    const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined;
    const sampleAssetId = data && typeof data === "object" ? (data as { sample_asset_id?: unknown }).sample_asset_id : undefined;
    if (typeof sampleAssetId === "string" && sampleAssetId === assetVersion.assetId) return undefined;
  }

  const [asset] = assetVersion
    ? await db.select().from(assets).where(and(
      eq(assets.workspaceId, workspaceId),
      eq(assets.projectId, projectId),
      eq(assets.id, assetVersion.assetId),
      eq(assets.status, "READY"),
      eq(assets.kind, "AUDIO"),
    )).limit(1)
    : [];
  if (timeline.narrationAssetVersionId && (!asset
    || asset.workspaceId !== workspaceId
    || asset.projectId !== projectId
    || typeof asset.objectKey !== "string" || asset.objectKey.trim().length === 0
    || !asset.objectKey.startsWith(`${workspaceId}/${projectId}/${asset.id}/`)
    || asset.objectKey.length <= `${workspaceId}/${projectId}/${asset.id}/`.length
    || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(asset.sha256)
    || typeof asset.byteSize !== "number" || !Number.isInteger(asset.byteSize) || asset.byteSize <= 0)) return undefined;
  if (timeline.narrationAssetVersionId && asset
    && (!isSupportedNarrationMimeType(asset.mimeType)
      || (asset.durationMs !== null && asset.durationMs !== undefined
        && (typeof asset.durationMs !== "number" || !Number.isInteger(asset.durationMs)
          || asset.durationMs <= 0 || asset.durationMs !== assetVersion?.durationMs)))) return undefined;

  let parsedTimeline;
  let parsedScript;
  try {
    // Drizzle rows are camelCase and contain internal columns; construct the
    // strict contract shape explicitly instead of spreading unknown fields.
    parsedTimeline = TimelinePlanSchema.parse({
      id: timeline.id,
      workspace_id: timeline.workspaceId,
      project_id: timeline.projectId,
      delivery_plan_revision_id: timeline.deliveryPlanRevisionId,
      narration_script_revision_id: timeline.narrationScriptRevisionId,
      narration_asset_version_id: timeline.narrationAssetVersionId,
      effective_duration_ms: timeline.effectiveDurationMs,
      narration_sections: timeline.narrationSections,
      visual_segments: timeline.visualSegments,
      status: timeline.status,
      decision_reasons: timeline.decisionReasons,
      created_at: String(timeline.createdAt),
    });
    parsedScript = NarrationScriptRevisionSchema.parse({
      id: script.id,
      workspace_id: script.workspaceId,
      project_id: script.projectId,
      delivery_plan_revision_id: script.deliveryPlanRevisionId,
      status: script.status,
      source_script_hash: script.sourceScriptHash,
      display_sections: script.displaySections,
      spoken_sections: script.spokenSections,
      language: script.language,
      normalization_version: script.normalizationVersion,
      decision_reasons: script.decisionReasons,
      created_at: String(script.createdAt),
      updated_at: String(script.updatedAt),
    });
    if (assetVersion) {
      NarrationAssetVersionSchema.parse({
        id: assetVersion.id,
        workspace_id: assetVersion.workspaceId,
        project_id: assetVersion.projectId,
        narration_script_revision_id: assetVersion.narrationScriptRevisionId,
        asset_id: assetVersion.assetId,
        provider: assetVersion.provider,
        voice_id: assetVersion.voiceId,
        provider_settings: assetVersion.providerSettings,
        duration_ms: assetVersion.durationMs,
        sample_approved: assetVersion.sampleApproved,
        word_timestamps_asset_id: assetVersion.wordTimestampsAssetId,
        canonical_transcript_check: assetVersion.canonicalTranscriptCheck,
        created_at: String(assetVersion.createdAt),
        updated_at: String(assetVersion.updatedAt),
      });
    }
  } catch {
    return undefined;
  }

  // Normalization is a one-to-one mapping: display and spoken sections must
  // carry the same unique ids in the same order, and the approved timeline
  // must account for each spoken section exactly once.  Otherwise a malformed
  // plan could silently duplicate/omit speech while the canonical script text
  // still includes every spoken section.
  const displayIds = parsedScript.display_sections.map((section) => section.id);
  const spokenIds = parsedScript.spoken_sections.map((section) => section.id);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(displayIds) || !unique(spokenIds)
    || displayIds.length !== spokenIds.length
    || displayIds.some((id, index) => id !== spokenIds[index])) return undefined;

  // TimelinePlanSchema validates each row independently.  Composition needs
  // the source edit-director invariant as well: narration windows are sorted
  // and non-overlapping, while visual windows form one continuous 0..effective
  // coverage with unique consecutive sequence numbers.  Reject malformed
  // snapshots here rather than letting an approved full asset bypass cue
  // validation in the Runtime.
  const narrationIds = new Set<string>();
  let previousNarrationEnd = 0;
  for (const section of parsedTimeline.narration_sections) {
    if (narrationIds.has(section.section_id)
      || section.start_ms < previousNarrationEnd
      || (section.start_ms - previousNarrationEnd > MAX_UNDECLARED_NARRATION_GAP_MS
        && section.visual_role !== "HOLD" && section.visual_role !== "BROLL")
      || section.end_ms > parsedTimeline.effective_duration_ms) return undefined;
    narrationIds.add(section.section_id);
    previousNarrationEnd = section.end_ms;
  }
  if (parsedTimeline.narration_sections.at(-1)?.end_ms !== parsedTimeline.effective_duration_ms) return undefined;
  let previousVisualEnd = 0;
  for (const [index, segment] of parsedTimeline.visual_segments.entries()) {
    if (segment.sequence !== index + 1
      || segment.start_ms !== previousVisualEnd
      || segment.end_ms > parsedTimeline.effective_duration_ms) return undefined;
    previousVisualEnd = segment.end_ms;
  }
  if (previousVisualEnd !== parsedTimeline.effective_duration_ms) return undefined;

  const primarySections = parsedTimeline.narration_sections.filter((section) => section.visual_role === "PRIMARY");
  const sectionAssetVersionIds = primarySections
    .map((section) => section.narration_asset_version_id)
    .filter((value): value is string => typeof value === "string");
  const hasSectionAssets = sectionAssetVersionIds.length > 0;
  // A section-level source mapping is all-or-nothing.  Mixing a full-track
  // asset with independent section assets would create two competing audio
  // authorities, so reject it instead of guessing which one wins.
  if (hasSectionAssets && (sectionAssetVersionIds.length !== primarySections.length || assetVersion)) return undefined;

  const narrationAssets: NonNullable<ApprovedNarrationTimeline["narrationAssets"]> = [];
  if (hasSectionAssets) {
    if (new Set(sectionAssetVersionIds).size !== sectionAssetVersionIds.length) return undefined;
    for (const section of primarySections) {
      const assetVersionId = section.narration_asset_version_id;
      if (!assetVersionId) return undefined;
      const [sectionVersion] = await db.select().from(narrationAssetVersions).where(and(
        eq(narrationAssetVersions.workspaceId, workspaceId),
        eq(narrationAssetVersions.projectId, projectId),
        eq(narrationAssetVersions.id, assetVersionId),
        eq(narrationAssetVersions.narrationScriptRevisionId, script.id),
        eq(narrationAssetVersions.sampleApproved, false),
      )).limit(1);
      if (!sectionVersion
        || sectionVersion.workspaceId !== workspaceId
        || sectionVersion.projectId !== projectId
        || sectionVersion.narrationScriptRevisionId !== script.id
        || sectionVersion.sampleApproved
        || sampleAssetIdFromApprovalPayload(approvalEvent?.payload) === sectionVersion.assetId
        || !sectionDurationMatchesMeasuredAsset(section.end_ms - section.start_ms, sectionVersion.durationMs)) return undefined;
      const [sectionAsset] = await db.select().from(assets).where(and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, projectId),
        eq(assets.id, sectionVersion.assetId),
        eq(assets.status, "READY"),
        eq(assets.kind, "AUDIO"),
      )).limit(1);
      if (!sectionAsset
        || typeof sectionAsset.objectKey !== "string"
        || sectionAsset.objectKey.length === 0
        || !sectionAsset.objectKey.startsWith(`${workspaceId}/${projectId}/${sectionAsset.id}/`)
        || typeof sectionAsset.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sectionAsset.sha256)
        || typeof sectionAsset.byteSize !== "number" || !Number.isInteger(sectionAsset.byteSize) || sectionAsset.byteSize <= 0
        || !isSupportedNarrationMimeType(sectionAsset.mimeType)
        || (sectionAsset.durationMs !== null && sectionAsset.durationMs !== undefined
          && (typeof sectionAsset.durationMs !== "number" || sectionAsset.durationMs !== sectionVersion.durationMs))) return undefined;
      try {
        NarrationAssetVersionSchema.parse({
          id: sectionVersion.id,
          workspace_id: sectionVersion.workspaceId,
          project_id: sectionVersion.projectId,
          narration_script_revision_id: sectionVersion.narrationScriptRevisionId,
          asset_id: sectionVersion.assetId,
          provider: sectionVersion.provider,
          voice_id: sectionVersion.voiceId,
          provider_settings: sectionVersion.providerSettings,
          duration_ms: sectionVersion.durationMs,
          sample_approved: sectionVersion.sampleApproved,
          word_timestamps_asset_id: sectionVersion.wordTimestampsAssetId,
          canonical_transcript_check: sectionVersion.canonicalTranscriptCheck,
          created_at: String(sectionVersion.createdAt),
          updated_at: String(sectionVersion.updatedAt),
        });
      } catch {
        return undefined;
      }
      const metadata = sectionAsset.metadata ?? {};
      narrationAssets.push({
        sectionId: section.section_id,
        assetVersionId: sectionVersion.id,
        id: sectionAsset.id,
        workspaceId,
        projectId,
        objectKey: sectionAsset.objectKey,
        sha256: sectionAsset.sha256,
        byteSize: sectionAsset.byteSize,
        mimeType: sectionAsset.mimeType,
        durationMs: sectionVersion.durationMs,
        ...(typeof metadata.audio_gain_db === "string" ? { gainDb: metadata.audio_gain_db } : {}),
        ...(typeof metadata.audio_fade_in_ms === "number" && Number.isInteger(metadata.audio_fade_in_ms) ? { fadeInMs: metadata.audio_fade_in_ms } : {}),
        ...(typeof metadata.audio_fade_out_ms === "number" && Number.isInteger(metadata.audio_fade_out_ms) ? { fadeOutMs: metadata.audio_fade_out_ms } : {}),
      });
    }
  }

  // The legacy full-track path remains restricted to one contiguous PRIMARY
  // window.  Multi-section placement is only enabled when every PRIMARY
  // window has an independently measured section asset above.
  if (assetVersion && !hasSectionAssets) {
    const [section] = parsedTimeline.narration_sections;
    if (parsedTimeline.narration_sections.length !== 1
      || !section
      || section.visual_role !== "PRIMARY"
      || section.start_ms !== 0
      || section.end_ms !== parsedTimeline.effective_duration_ms) return undefined;
  }

  const spokenTimelineSections = parsedTimeline.narration_sections.filter((section) => section.visual_role === "PRIMARY");
  const timelineSectionIds = spokenTimelineSections.map((section) => section.section_id);
  if (timelineSectionIds.length !== spokenIds.length
    || timelineSectionIds.some((id, index) => id !== spokenIds[index])
    || parsedTimeline.narration_sections.some((section) => section.visual_role === "PRIMARY" && !spokenIds.includes(section.section_id))) return undefined;

  const sectionById = new Map(parsedScript.spoken_sections.map((section) => [section.id, section]));
  const narrationSegments = spokenTimelineSections
    .map((section) => {
      const spoken = sectionById.get(section.section_id);
      if (!spoken) return undefined;
      return {
        text: spoken.provider_text,
        startMs: section.start_ms,
        pronunciationGuides: spoken.pronunciation_guides,
        pauseBeforeMs: spoken.delivery.pause_before_ms,
        pauseAfterMs: spoken.delivery.pause_after_ms,
        pace: spoken.delivery.pace,
        energy: spoken.delivery.energy,
      };
    })
    .filter((section): section is {
      text: string;
      startMs: number;
      pronunciationGuides: Array<{ source: string; spoken: string; reason: string }>;
      pauseBeforeMs: number;
      pauseAfterMs: number;
      pace: "SLOW" | "NATURAL" | "FAST";
      energy: "CALM" | "NEUTRAL" | "EMPHATIC";
    } => section !== undefined && section.text.length > 0);
  if (narrationSegments.length !== spokenTimelineSections.length) return undefined;

  return {
    narrationSections: parsedTimeline.narration_sections.map((section) => ({
      sectionId: section.section_id,
      startMs: section.start_ms,
      endMs: section.end_ms,
      visualRole: section.visual_role,
      ...(section.narration_asset_version_id ? { narrationAssetVersionId: section.narration_asset_version_id } : {}),
    })),
    narrationSegments,
    visualSegments: parsedTimeline.visual_segments,
    effectiveDurationMs: parsedTimeline.effective_duration_ms,
    narrationScriptText: parsedScript.spoken_sections.map((section) => section.provider_text).join(" "),
    ...(assetVersion?.wordTimestampsAssetId ? { transcriptTimingAssetId: assetVersion.wordTimestampsAssetId } : {}),
    ...(asset && assetVersion ? {
      narrationAsset: {
        id: asset.id,
        workspaceId: asset.workspaceId,
        projectId: asset.projectId,
        objectKey: asset.objectKey!,
        sha256: asset.sha256!,
        byteSize: asset.byteSize!,
        mimeType: asset.mimeType!,
        durationMs: assetVersion.durationMs,
        ...(typeof asset.metadata?.audio_gain_db === "string" ? { gainDb: asset.metadata.audio_gain_db } : {}),
        ...(typeof asset.metadata?.audio_fade_in_ms === "number" && Number.isInteger(asset.metadata.audio_fade_in_ms) ? { fadeInMs: asset.metadata.audio_fade_in_ms } : {}),
        ...(typeof asset.metadata?.audio_fade_out_ms === "number" && Number.isInteger(asset.metadata.audio_fade_out_ms) ? { fadeOutMs: asset.metadata.audio_fade_out_ms } : {}),
      },
    } : {}),
    ...(narrationAssets.length > 0 ? { narrationAssets } : {}),
  };
}
