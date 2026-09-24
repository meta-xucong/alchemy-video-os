import {
  createCanonicalSourceBundle,
  projectSemanticDialogues,
  projectSemanticReferences,
  semanticValueHash,
  type VerifiedSemanticDirector,
} from "@alchemy-video/creative-planning/semantic-director";
import type {
  CanonicalReferenceSource,
  SemanticDialogueProjection,
  SemanticReferenceProjection,
  VideoAudioOwner,
} from "@alchemy-video/contracts";
import { createPrefixedId } from "@alchemy-video/domain";
import type {
  ControlCreativeBriefRevision,
  CreativePlanningDraft,
  CreativePlanningEvent,
  CreativePlanningStore,
} from "@alchemy-video/persistence";
import {
  compileVideoPrompt,
  type VideoProviderRuntimeProfile,
} from "@alchemy-video/provider-video";

import type { BoundedDocumentContextReader } from "./document-context-reader.js";

const SEMANTIC_PROJECTOR_VERSION = "semantic-director-pure-projector-v1";
const PROVIDER_MIN_DURATION_SECONDS = 1;
const PROVIDER_MAX_DURATION_SECONDS = 15;
const PROVIDER_MAX_REFERENCE_IMAGES = 7;

const realAudioOwner = (profile: VideoProviderRuntimeProfile): VideoAudioOwner =>
  profile.audioOwner ?? "LEGACY_PRESERVE";

const providerRole = (role: SemanticReferenceProjection["references"][number]["provider_role"]) => role;

const idFactory = (prefix: "scr" | "sbr" | "ssp" | "ppk") => createPrefixedId(prefix);

type SemanticPlanningStore = Pick<CreativePlanningStore, "completeCreativePlan">
  & Partial<Pick<CreativePlanningStore, "resolveCanonicalReferenceSources">>;

/**
 * Real-provider creative planning path.
 *
 * Semantic understanding has exactly one owner: VerifiedSemanticDirector.
 * This executor only freezes source material, verifies evidence, projects the
 * verified decision, compiles provider fields, and persists immutable output.
 */
export class SemanticCreativePlanningExecutor {
  constructor(
    private readonly store: SemanticPlanningStore,
    private readonly director: VerifiedSemanticDirector,
    private readonly profile: VideoProviderRuntimeProfile,
    private readonly documentContextReader?: Pick<BoundedDocumentContextReader, "read">,
    private readonly makeId: typeof idFactory = idFactory,
  ) {
    if (profile.mode === "mock") {
      throw new Error("SemanticCreativePlanningExecutor is reserved for real-provider mode.");
    }
    if (!Number.isInteger(profile.providerPromptMaxUtf8Bytes)
      || (profile.providerPromptMaxUtf8Bytes ?? 0) < 1) {
      throw new Error("Real semantic planning requires a certified provider prompt ceiling.");
    }
  }

  async execute(input: { brief: ControlCreativeBriefRevision; event: CreativePlanningEvent }) {
    const documents = input.brief.documentContexts.length > 0
      ? await this.readDocuments(input.brief)
      : [];
    const references = await this.readReferences(input.brief);
    const bundle = createCanonicalSourceBundle({
      sourceText: input.brief.sourceText,
      stylePreferences: input.brief.stylePreferences,
      targetDurationSeconds: input.brief.targetDurationSeconds,
      documents: documents.map((document) => ({
        documentId: document.documentId,
        conversionId: document.conversionId,
        content: document.content,
      })),
      references,
      userDecisions: [{
        decisionId: "dec_target_resolution",
        field: "target_resolution",
        value: input.brief.targetResolution,
      }],
      providerCapability: {
        profile_id: `${this.profile.provider}:${this.profile.model}`,
        min_duration_seconds: PROVIDER_MIN_DURATION_SECONDS,
        max_duration_seconds: PROVIDER_MAX_DURATION_SECONDS,
        max_prompt_utf8_bytes: this.profile.providerPromptMaxUtf8Bytes!,
        max_reference_images: PROVIDER_MAX_REFERENCE_IMAGES,
        audio_owner: realAudioOwner(this.profile),
      },
    });
    const decision = await this.director.requireExecutable(bundle);
    const decisionHash = semanticValueHash(decision);
    const draft = this.buildDraft(input.brief, decision, decisionHash);
    return this.store.completeCreativePlan({
      workspaceId: input.brief.workspaceId,
      creativeBriefRevisionId: input.brief.id,
      draft,
      event: input.event,
    });
  }

  private async readDocuments(brief: ControlCreativeBriefRevision) {
    if (!this.documentContextReader) {
      throw new Error("Real semantic planning has no bounded Markdown reader for frozen document evidence.");
    }
    return this.documentContextReader.read(brief.documentContexts);
  }

  private async readReferences(brief: ControlCreativeBriefRevision): Promise<CanonicalReferenceSource[]> {
    if (!this.store.resolveCanonicalReferenceSources) {
      if (brief.sourceAssetIds.length === 0) return [];
      throw new Error("Real semantic planning cannot resolve canonical reference sources.");
    }
    const references = await this.store.resolveCanonicalReferenceSources(
      brief.workspaceId,
      brief.projectId,
      brief.sourceAssetIds,
    );
    if (!references) throw new Error("Canonical reference facts are unavailable or invalid.");
    return references;
  }

  private buildDraft(
    brief: ControlCreativeBriefRevision,
    decision: Awaited<ReturnType<VerifiedSemanticDirector["requireExecutable"]>>,
    decisionHash: string,
  ): CreativePlanningDraft {
    const shotSpecs = decision.segments.map((segment) => ({
      id: this.makeId("ssp"),
      sequence: segment.sequence,
      title: `片段 ${segment.sequence}`,
      durationSeconds: segment.duration_seconds,
      narrativeGoal: segment.visual_decision,
      referencePolicy: segment.reference_asset_ids.length > 0 ? "REFERENCE_SET" as const : "TEXT_TRANSITION" as const,
      dependsOnSequences: [],
      narrativeBeatSequences: [segment.sequence],
    }));
    const promptPackages = shotSpecs.map((shotSpec, index) => {
      const segment = decision.segments[index]!;
      const dialogueProjection = projectSemanticDialogues(decision, segment.segment_id);
      const referenceProjection = projectSemanticReferences(decision, segment.segment_id);
      const compiled = this.compileSegment(brief, segment.visual_decision, segment.duration_seconds, dialogueProjection, referenceProjection);
      return {
        id: this.makeId("ppk"),
        shotSpecId: shotSpec.id,
        compilerVersion: SEMANTIC_PROJECTOR_VERSION,
        prompt: compiled.prompt,
        visualConstraints: {
          semantic_segment_id: segment.segment_id,
          semantic_decision_hash: decisionHash,
          evidence_ids: segment.evidence_refs.map((evidence) => evidence.evidence_id),
        },
        referenceMap: {
          reference_policy: shotSpec.referencePolicy,
          semantic_reference_projection: referenceProjection,
        },
        capabilitySnapshot: {
          semantic_segment_id: segment.segment_id,
          semantic_decision_hash: decisionHash,
          semantic_dialogue_projection: dialogueProjection,
          source_prompt: compiled.sourcePrompt,
          generated_prompt_parts: compiled.generatedPromptParts,
          audio_owner: realAudioOwner(this.profile),
          max_duration_seconds: PROVIDER_MAX_DURATION_SECONDS,
          max_reference_images: PROVIDER_MAX_REFERENCE_IMAGES,
          ...(segment.bgm_intent ? { bgm_prompt: segment.bgm_intent } : {}),
        },
      };
    });
    return {
      scriptRevisionId: this.makeId("scr"),
      storyboardRevisionId: this.makeId("sbr"),
      beats: decision.segments.map((segment) => ({
        sequence: segment.sequence,
        title: `片段 ${segment.sequence}`,
        summary: `已验证语义片段 ${segment.sequence}，证据 ${segment.evidence_refs.length} 项。`,
        narrative_goal: segment.visual_decision,
        visible_facts: segment.evidence_refs.slice(0, 20).map((evidence) => evidence.evidence_id),
        generation_segment_sequence: segment.sequence,
      })),
      title: "语义导演计划",
      summary: `已验证 ${decision.segments.length} 个生成片段，总时长 ${decision.target_duration_seconds} 秒。`,
      totalDurationSeconds: decision.target_duration_seconds,
      continuityLevel: "STANDARD",
      continuityNote: "未声明平台推断的跨片段连续性；每段仅执行已验证语义决定。",
      shotSpecs,
      durationPolicy: {
        minDurationSeconds: PROVIDER_MIN_DURATION_SECONDS,
        maxDurationSeconds: PROVIDER_MAX_DURATION_SECONDS,
      },
      narrativeBeatCount: decision.segments.length,
      generationSegmentCount: decision.segments.length,
      promptPackages,
    };
  }

  private compileSegment(
    brief: ControlCreativeBriefRevision,
    visualDecision: string,
    durationSeconds: number,
    dialogueProjection: SemanticDialogueProjection,
    referenceProjection: SemanticReferenceProjection,
  ) {
    return compileVideoPrompt({
      sourcePrompt: visualDecision,
      dialogueLines: dialogueProjection.dialogues.map((dialogue) => dialogue.exact_text),
      referenceRoles: referenceProjection.references.map((reference) => providerRole(reference.provider_role)),
      generationSettings: {
        video_settings: {
          duration_seconds: durationSeconds,
          resolution: brief.targetResolution,
          ratio: "16:9",
        },
      },
      profile: this.profile,
    });
  }
}

export { SEMANTIC_PROJECTOR_VERSION };
