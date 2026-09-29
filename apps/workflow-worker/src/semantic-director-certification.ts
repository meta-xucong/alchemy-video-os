import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  createCanonicalSourceBundle,
} from "@alchemy-video/creative-planning/semantic-director";
import {
  SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
  type CanonicalSourceBundle,
} from "@alchemy-video/contracts";
import { canonicalJson } from "@alchemy-video/domain";

import type {
  SemanticDirectorCertifiedModelProfile,
  SemanticDirectorResponseMode,
} from "./semantic-director-model-profiles.js";
import { semanticDirectorCertificationSurfaceHash } from "./semantic-director-contract-surface.js";

export const SEMANTIC_DIRECTOR_CERTIFICATION_REPORT_VERSION = 3 as const;
export const SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID = "semantic-director-certification-v1" as const;
const MAX_REPORT_BYTES = 64 * 1024;

const fixtureSource = [
  "🌙 冷白实验室中，两位研究员依次检查同一份护肤样本。",
  "林澈说：“先看真实证据。”",
  "Maya回答：“Show the verified result.”",
  "第一阶段保持银白样本瓶与实验台的真实结构；第二阶段展示两人完成检查后的可见状态，不添加功效承诺。",
].join("\n");
const fixtureStylePreferences = "冷白、克制、真实实验记录；禁止功效承诺和无来源结果";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const semanticDirectorCertificationExpectedDialogues = [
  "先看真实证据。",
  "Show the verified result.",
] as const;
export const semanticDirectorCertificationExpectedReferences = [
  "ast_cert_subject_001",
  "ast_cert_scene_001",
] as const;

export const semanticDirectorCertificationBundle: CanonicalSourceBundle = createCanonicalSourceBundle({
  sourceText: fixtureSource,
  stylePreferences: fixtureStylePreferences,
  targetDurationSeconds: 30,
  references: [
    {
      asset_id: semanticDirectorCertificationExpectedReferences[0],
      asset_sha256: sha256("synthetic-subject-reference"),
      mime_type: "image/png",
      position: 0,
      provider_role: "SUBJECT",
      objective_description: "银白色护肤样本瓶与其真实标签。",
    },
    {
      asset_id: semanticDirectorCertificationExpectedReferences[1],
      asset_sha256: sha256("synthetic-scene-reference"),
      mime_type: "image/png",
      position: 1,
      provider_role: "SCENE",
      objective_description: "冷白实验室工作台与照明结构。",
    },
  ],
  userDecisions: [
    {
      decisionId: "dec_cert_bgm_off_001",
      field: "music_plan.mode",
      value: "OFF",
    },
    {
      decisionId: "dec_cert_style_preferences_001",
      field: "style_preferences",
      value: fixtureStylePreferences,
    },
  ],
  providerCapability: {
    profile_id: "cert-video-profile-8-15",
    min_duration_seconds: 8,
    max_duration_seconds: 15,
    max_prompt_utf8_bytes: 4096,
    max_reference_images: 7,
    audio_owner: "NATIVE_PROVIDER",
  },
});

export const semanticDirectorCertificationValueHash = (value: unknown) =>
  sha256(canonicalJson(value));
export const SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_HASH =
  semanticDirectorCertificationValueHash(semanticDirectorCertificationBundle);
export const SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH = semanticDirectorCertificationSurfaceHash({
  fixtureId: SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID,
  fixtureHash: SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_HASH,
});

export type SemanticDirectorCertificationReport = Readonly<{
  report_version: typeof SEMANTIC_DIRECTOR_CERTIFICATION_REPORT_VERSION;
  status: "CANDIDATE_PASS";
  contract_version: typeof SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION;
  profile_id: string;
  provider: string;
  model: string;
  response_mode: SemanticDirectorResponseMode;
  strict_json: true;
  timeout_ms: number;
  max_input_utf8_bytes: number;
  max_output_tokens: number;
  fixture_id: typeof SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID;
  fixture_hash: string;
  certification_surface_hash: string;
  attempts: number;
  decision_hashes: readonly string[];
  segment_counts: readonly number[];
  dialogue_counts: readonly number[];
  reference_usage_counts: readonly number[];
}>;

export type SemanticDirectorCertificationReportErrorCode =
  | "CERTIFICATION_REPORT_PATH_INVALID"
  | "CERTIFICATION_REPORT_FILE_INVALID"
  | "CERTIFICATION_REPORT_SCHEMA_INVALID"
  | "CERTIFICATION_REPORT_INCOMPATIBLE";

export class SemanticDirectorCertificationReportError extends Error {
  constructor(readonly code: SemanticDirectorCertificationReportErrorCode) {
    super("Semantic Director local certification report is invalid.");
    this.name = "SemanticDirectorCertificationReportError";
  }
}

const reportKeys = [
  "report_version",
  "status",
  "contract_version",
  "profile_id",
  "provider",
  "model",
  "response_mode",
  "strict_json",
  "timeout_ms",
  "max_input_utf8_bytes",
  "max_output_tokens",
  "fixture_id",
  "fixture_hash",
  "certification_surface_hash",
  "attempts",
  "decision_hashes",
  "segment_counts",
  "dialogue_counts",
  "reference_usage_counts",
] as const;
const exactKeys = (value: Record<string, unknown>) => {
  const actual = Object.keys(value).sort();
  const expected = [...reportKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};
const isIntegerWithin = (value: unknown, minimum: number, maximum: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;
const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const isNonEmptyString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
const isResponseMode = (value: unknown): value is SemanticDirectorResponseMode =>
  value === "JSON_SCHEMA" || value === "JSON_OBJECT" || value === "PROMPT_ONLY";

export const parseSemanticDirectorCertificationReport = (
  input: unknown,
): SemanticDirectorCertificationReport => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SemanticDirectorCertificationReportError("CERTIFICATION_REPORT_SCHEMA_INVALID");
  }
  const value = input as Record<string, unknown>;
  if (!exactKeys(value)
    || value.report_version !== SEMANTIC_DIRECTOR_CERTIFICATION_REPORT_VERSION
    || value.status !== "CANDIDATE_PASS"
    || value.contract_version !== SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION
    || !isNonEmptyString(value.profile_id, 160)
    || !isNonEmptyString(value.provider, 160)
    || !isNonEmptyString(value.model, 256)
    || !isResponseMode(value.response_mode)
    || value.strict_json !== true
    || !isIntegerWithin(value.timeout_ms, 1, 300_000)
    || !isIntegerWithin(value.max_input_utf8_bytes, 1, 16_777_216)
    || !isIntegerWithin(value.max_output_tokens, 1, 65_536)
    || value.fixture_id !== SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID
    || value.fixture_hash !== SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_HASH
    || value.certification_surface_hash !== SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH
    || !isIntegerWithin(value.attempts, 3, 5)
    || !Array.isArray(value.decision_hashes)
    || !Array.isArray(value.segment_counts)
    || !Array.isArray(value.dialogue_counts)
    || !Array.isArray(value.reference_usage_counts)) {
    throw new SemanticDirectorCertificationReportError("CERTIFICATION_REPORT_INCOMPATIBLE");
  }
  const attempts = value.attempts as number;
  const decisionHashes = value.decision_hashes as unknown[];
  const segmentCounts = value.segment_counts as unknown[];
  const dialogueCounts = value.dialogue_counts as unknown[];
  const referenceUsageCounts = value.reference_usage_counts as unknown[];
  if (decisionHashes.length !== attempts
    || segmentCounts.length !== attempts
    || dialogueCounts.length !== attempts
    || referenceUsageCounts.length !== attempts
    || decisionHashes.some((item) => !isHash(item))
    || segmentCounts.some((item) => !isPositiveInteger(item))
    || dialogueCounts.some((item) => item !== semanticDirectorCertificationExpectedDialogues.length)
    || referenceUsageCounts.some((item) => item !== semanticDirectorCertificationExpectedReferences.length)) {
    throw new SemanticDirectorCertificationReportError("CERTIFICATION_REPORT_INCOMPATIBLE");
  }
  return value as SemanticDirectorCertificationReport;
};

export const loadSemanticDirectorCertificationReport = (
  path: string,
): SemanticDirectorCertificationReport => {
  if (!path.trim() || !isAbsolute(path)) {
    throw new SemanticDirectorCertificationReportError("CERTIFICATION_REPORT_PATH_INVALID");
  }
  try {
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size < 2 || stat.size > MAX_REPORT_BYTES) {
      throw new SemanticDirectorCertificationReportError("CERTIFICATION_REPORT_FILE_INVALID");
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseSemanticDirectorCertificationReport(parsed);
  } catch (error) {
    if (error instanceof SemanticDirectorCertificationReportError) throw error;
    throw new SemanticDirectorCertificationReportError("CERTIFICATION_REPORT_FILE_INVALID");
  }
};

export const certifiedProfileFromLocalReport = (
  report: SemanticDirectorCertificationReport,
): SemanticDirectorCertifiedModelProfile => ({
  profileId: report.profile_id,
  provider: report.provider,
  model: report.model,
  status: "CERTIFIED",
  responseMode: report.response_mode,
  strictJson: true,
  contractVersion: report.contract_version,
  timeoutMs: report.timeout_ms,
  maxInputUtf8Bytes: report.max_input_utf8_bytes,
  maxOutputTokens: report.max_output_tokens,
  fixtureId: report.fixture_id,
  certificationSurfaceHash: report.certification_surface_hash,
  certificationSource: "LOCAL_REPORT",
});
