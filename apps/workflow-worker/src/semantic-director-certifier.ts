import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type SemanticDirectorPort,
  SemanticDecisionVerificationError,
} from "@alchemy-video/creative-planning/semantic-director";
import {
  SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
  type SemanticDirectorDecision,
} from "@alchemy-video/contracts";

import {
  OpenAiCompatibleSemanticDirector,
  SemanticDirectorClientError,
} from "./semantic-director-client.js";
import {
  isSemanticDirectorSafeIdentifier,
  resolveCertifiedSemanticDirectorModelProfile,
  type SemanticDirectorCertifiedModelProfile,
  type SemanticDirectorResponseMode,
} from "./semantic-director-model-profiles.js";
import {
  canonicalizeSemanticPlan,
  SemanticDirectorCanonicalizationError,
} from "./semantic-director-canonicalizer.js";
import {
  SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_HASH,
  SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID,
  SEMANTIC_DIRECTOR_CERTIFICATION_REPORT_VERSION,
  SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH,
  semanticDirectorCertificationBundle,
  semanticDirectorCertificationExpectedDialogues as expectedDialogues,
  semanticDirectorCertificationExpectedReferences as expectedReferences,
  semanticDirectorCertificationValueHash,
  type SemanticDirectorCertificationReport,
} from "./semantic-director-certification.js";

export type SemanticDirectorCertificationFailure = Readonly<{
  status: "FAILED";
  profile_id: string;
  model: string;
  stage: string;
  code: string;
  retryable: boolean;
  attempt: number;
  validation_issue_codes?: readonly string[];
  validation_issue_paths?: readonly string[];
}>;

export type SemanticDirectorCertificationOptions = Readonly<{
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
}>;

const parsePositiveInteger = (
  name: string,
  value: string | undefined,
  maximum: number,
  minimum = 1,
) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};
const parseResponseMode = (value: string | undefined): SemanticDirectorResponseMode => {
  if (value === "JSON_SCHEMA" || value === "JSON_OBJECT" || value === "PROMPT_ONLY") return value;
  throw new Error("SEMANTIC_PLANNER_RESPONSE_MODE must be JSON_SCHEMA, JSON_OBJECT, or PROMPT_ONLY.");
};

const safeOutputIdentifier = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "unconfigured";
  return isSemanticDirectorSafeIdentifier(normalized) ? normalized : "invalid";
};

const certificationReportPath = (env: NodeJS.ProcessEnv) => {
  const path = env.SEMANTIC_PLANNER_CERTIFICATION_REPORT_PATH?.trim();
  if (!path) return undefined;
  if (!isAbsolute(path)) throw new Error("CERTIFICATION_REPORT_PATH_INVALID");
  return path;
};
const prepareCertificationReportPath = async (path: string) => {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true });
};
const writeCertificationReport = async (
  path: string,
  report: SemanticDirectorCertificationReport,
) => {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

const safeValidationDetails = (error: unknown): Pick<
  SemanticDirectorCertificationFailure,
  "validation_issue_codes" | "validation_issue_paths"
> => {
  if (!error || typeof error !== "object" || !Array.isArray((error as { issues?: unknown }).issues)) {
    return {};
  }
  const issues = (error as {
    issues: Array<{ code?: unknown; path?: unknown }>;
  }).issues;
  const codes = issues
    .map((issue) => typeof issue.code === "string" ? issue.code : "UNKNOWN")
    .filter((code, index, values) => values.indexOf(code) === index)
    .slice(0, 8);
  const paths = issues
    .map((issue) => Array.isArray(issue.path)
      ? issue.path
        .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
        .slice(0, 8)
        .map(String)
        .join(".")
      : "")
    .filter((path, index, values) => path.length > 0 && values.indexOf(path) === index)
    .slice(0, 8);
  return {
    ...(codes.length > 0 ? { validation_issue_codes: codes } : {}),
    ...(paths.length > 0 ? { validation_issue_paths: paths } : {}),
  };
};

const readCandidateProfile = (env: NodeJS.ProcessEnv): {
  baseUrl: string;
  apiKey: string;
  profile: SemanticDirectorCertifiedModelProfile;
  attempts: number;
} => {
  const baseUrl = env.SEMANTIC_PLANNER_BASE_URL?.trim();
  const apiKey = env.SEMANTIC_PLANNER_API_KEY?.trim();
  const model = env.SEMANTIC_PLANNER_MODEL?.trim();
  const profileId = env.SEMANTIC_PLANNER_PROFILE_ID?.trim();
  const provider = env.SEMANTIC_PLANNER_PROVIDER?.trim();
  if (!baseUrl || !apiKey || !model || !profileId || !provider) {
    throw new Error("Semantic Director certification requires explicit base URL, API key, provider, model, and profile ID.");
  }
  const responseMode = parseResponseMode(env.SEMANTIC_PLANNER_RESPONSE_MODE?.trim());
  const timeoutMs = parsePositiveInteger("SEMANTIC_PLANNER_TIMEOUT_MS", env.SEMANTIC_PLANNER_TIMEOUT_MS, 300_000);
  const maxInputUtf8Bytes = parsePositiveInteger("SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES", env.SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES, 16_777_216);
  const maxOutputTokens = parsePositiveInteger("SEMANTIC_PLANNER_MAX_TOKENS", env.SEMANTIC_PLANNER_MAX_TOKENS, 65_536);
  const attempts = parsePositiveInteger("SEMANTIC_PLANNER_CERTIFY_ATTEMPTS", env.SEMANTIC_PLANNER_CERTIFY_ATTEMPTS, 5, 3);
  const profile: SemanticDirectorCertifiedModelProfile = {
    profileId,
    provider,
    model,
    status: "CERTIFIED",
    responseMode,
    strictJson: true,
    contractVersion: SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
    timeoutMs,
    maxInputUtf8Bytes,
    maxOutputTokens,
    fixtureId: SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID,
    certificationSurfaceHash: SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH,
  };
  return {
    baseUrl,
    apiKey,
    attempts,
    profile: resolveCertifiedSemanticDirectorModelProfile({ profileId, model }, [profile]),
  };
};
const assertCertificationCoverage = (decision: SemanticDirectorDecision) => {
  const dialogueTexts = decision.dialogues.map((item) => item.exact_text);
  if (JSON.stringify(dialogueTexts) !== JSON.stringify(expectedDialogues)) {
    throw new Error("CERTIFICATION_DIALOGUE_COVERAGE_FAILED");
  }
  const usageIds = decision.reference_usages.map((item) => item.asset_id);
  if (JSON.stringify(usageIds) !== JSON.stringify(expectedReferences)) {
    throw new Error("CERTIFICATION_REFERENCE_COVERAGE_FAILED");
  }
  const segmentReferenceIds = new Set(decision.segments.flatMap((segment) => segment.reference_asset_ids));
  if (expectedReferences.some((assetId) => !segmentReferenceIds.has(assetId))) {
    throw new Error("CERTIFICATION_SEGMENT_REFERENCE_COVERAGE_FAILED");
  }
  const expectedReferenceOrder = new Map<string, number>(expectedReferences.map((assetId, index) => [assetId, index]));
  for (const segment of decision.segments) {
    const positions = segment.reference_asset_ids.map((assetId) => expectedReferenceOrder.get(assetId));
    if (positions.some((position) => position === undefined)
      || positions.some((position, index) => index > 0 && position! <= positions[index - 1]!)) {
      throw new Error("CERTIFICATION_SEGMENT_REFERENCE_ORDER_FAILED");
    }
  }
  const evidenceRefs = [
    ...decision.dialogues.map((dialogue) => dialogue.evidence),
    ...decision.reference_usages.flatMap((usage) => usage.evidence_refs),
    ...decision.segments.flatMap((segment) => segment.evidence_refs),
    ...decision.unresolved_items.flatMap((item) => item.evidence_refs),
  ];
  for (const expectedUserDecision of semanticDirectorCertificationBundle.user_decisions) {
    if (!evidenceRefs.some((evidence) => evidence.kind === "USER_DECISION"
      && evidence.decision_id === expectedUserDecision.decision_id
      && evidence.field === expectedUserDecision.field
      && evidence.value_hash === expectedUserDecision.value_hash)) {
      throw new Error("CERTIFICATION_USER_DECISION_COVERAGE_FAILED");
    }
  }
  if (decision.segments.some((segment) => segment.bgm_intent !== undefined)) {
    throw new Error("CERTIFICATION_BGM_OFF_FAILED");
  }
  if (decision.execution_status !== "READY" || decision.unresolved_items.some((item) => item.blocking)) {
    throw new Error("CERTIFICATION_UNRESOLVED_BLOCKING_FAILED");
  }
  if (decision.segments.reduce((total, segment) => total + segment.duration_seconds, 0)
    !== decision.target_duration_seconds) {
    throw new Error("CERTIFICATION_SEGMENT_DURATION_TOTAL_FAILED");
  }
  // The certification fixture is intentionally a 30-second source.  Segment
  // count is not a platform rule: the canonicalizer derives it from the
  // source storyboard duration boundary and the exact total-duration check.
  if (decision.target_duration_seconds !== 30) {
    throw new Error("CERTIFICATION_FIXTURE_TARGET_FAILED");
  }
};

/**
 * Independent calls may choose different valid editorial partitions. The hash
 * therefore covers only facts that must remain invariant across calls; segment
 * count, durations, placement and wording are validated per decision instead.
 */
const semanticDirectorInvariantHash = (decision: SemanticDirectorDecision) => {
  return semanticDirectorCertificationValueHash({
    execution_status: decision.execution_status,
    source_hash: decision.source_hash,
    target_duration_seconds: decision.target_duration_seconds,
    dialogues: decision.dialogues.map((dialogue) => ({
      dialogue_id: dialogue.dialogue_id,
      exact_text: dialogue.exact_text,
    })),
    reference_usages: decision.reference_usages.map((usage) => ({
      asset_id: usage.asset_id,
      provider_role: usage.provider_role,
      usage: usage.usage,
    })),
  });
};

const failureFrom = (
  error: unknown,
  input: Readonly<{ profileId: string; model: string; attempt: number }>,
): SemanticDirectorCertificationFailure => {
  if (error instanceof SemanticDirectorClientError) {
    return {
      status: "FAILED",
      profile_id: input.profileId,
      model: input.model,
      stage: error.diagnostic?.stage ?? "CLIENT",
      code: error.code,
      retryable: error.retryable,
      attempt: input.attempt,
    };
  }
  if (error instanceof SemanticDecisionVerificationError) {
    return {
      status: "FAILED",
      profile_id: input.profileId,
      model: input.model,
      stage: "VERIFICATION",
      code: error.code,
      retryable: false,
      attempt: input.attempt,
    };
  }
  if (error instanceof SemanticDirectorCanonicalizationError) {
    return {
      status: "FAILED",
      profile_id: input.profileId,
      model: input.model,
      stage: "CANONICALIZATION",
      code: error.code,
      retryable: false,
      attempt: input.attempt,
    };
  }
  const validationDetails = safeValidationDetails(error);
  if (Object.keys(validationDetails).length > 0) {
    return {
      status: "FAILED",
      profile_id: input.profileId,
      model: input.model,
      stage: "SCHEMA",
      code: "CERTIFICATION_DECISION_SCHEMA_FAILED",
      retryable: false,
      attempt: input.attempt,
      ...validationDetails,
    };
  }
  return {
    status: "FAILED",
    profile_id: input.profileId,
    model: input.model,
    stage: "CERTIFICATION",
    code: error instanceof Error && /^CERTIFICATION_[A-Z_]+$/.test(error.message)
      ? error.message
      : "CERTIFICATION_FAILED",
    retryable: false,
    attempt: input.attempt,
  };
};

export const runSemanticDirectorCertification = async (
  options: SemanticDirectorCertificationOptions = {},
): Promise<SemanticDirectorCertificationReport | SemanticDirectorCertificationFailure> => {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const writeOutput = options.writeOutput ?? ((line: string) => console.info(line));
  const writeError = options.writeError ?? ((line: string) => console.error(line));
  if (argv.length !== 1 || argv[0] !== "--live" || env.SEMANTIC_PLANNER_CERTIFY_LIVE !== "true") {
    const failure: SemanticDirectorCertificationFailure = {
      status: "FAILED",
      profile_id: safeOutputIdentifier(env.SEMANTIC_PLANNER_PROFILE_ID),
      model: safeOutputIdentifier(env.SEMANTIC_PLANNER_MODEL),
      stage: "GUARD",
      code: "LIVE_GUARD",
      retryable: false,
      attempt: 0,
    };
    writeError(JSON.stringify(failure));
    return failure;
  }

  let candidate: ReturnType<typeof readCandidateProfile>;
  let reportPath: string | undefined;
  try {
    candidate = readCandidateProfile(env);
    reportPath = certificationReportPath(env);
    if (reportPath) await prepareCertificationReportPath(reportPath);
  } catch {
    const failure: SemanticDirectorCertificationFailure = {
      status: "FAILED",
      profile_id: safeOutputIdentifier(env.SEMANTIC_PLANNER_PROFILE_ID),
      model: safeOutputIdentifier(env.SEMANTIC_PLANNER_MODEL),
      stage: "CONFIGURATION",
      code: "CONFIGURATION_INVALID",
      retryable: false,
      attempt: 0,
    };
    writeError(JSON.stringify(failure));
    return failure;
  }
  const client = new OpenAiCompatibleSemanticDirector({
    baseUrl: candidate.baseUrl,
    apiKey: candidate.apiKey,
    profile: candidate.profile,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });
  const director: SemanticDirectorPort = client;
  const decisionHashes: string[] = [];
  const segmentCounts: number[] = [];
  const dialogueCounts: number[] = [];
  const referenceUsageCounts: number[] = [];

  for (let attempt = 1; attempt <= candidate.attempts; attempt += 1) {
    try {
      const rawPlan = await director.decide(semanticDirectorCertificationBundle);
      const decision = canonicalizeSemanticPlan(rawPlan, semanticDirectorCertificationBundle);
      assertCertificationCoverage(decision);
      decisionHashes.push(semanticDirectorInvariantHash(decision));
      segmentCounts.push(decision.segments.length);
      dialogueCounts.push(decision.dialogues.length);
      referenceUsageCounts.push(decision.reference_usages.length);
    } catch (error) {
      const failure = failureFrom(error, {
        profileId: candidate.profile.profileId,
        model: candidate.profile.model,
        attempt,
      });
      writeError(JSON.stringify(failure));
      return failure;
    }
  }

  const report: SemanticDirectorCertificationReport = {
    report_version: SEMANTIC_DIRECTOR_CERTIFICATION_REPORT_VERSION,
    status: "CANDIDATE_PASS",
    contract_version: SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
    profile_id: candidate.profile.profileId,
    provider: candidate.profile.provider,
    model: candidate.profile.model,
    response_mode: candidate.profile.responseMode,
    strict_json: true,
    timeout_ms: candidate.profile.timeoutMs,
    max_input_utf8_bytes: candidate.profile.maxInputUtf8Bytes,
    max_output_tokens: candidate.profile.maxOutputTokens,
    fixture_id: SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_ID,
    fixture_hash: SEMANTIC_DIRECTOR_CERTIFICATION_FIXTURE_HASH,
    certification_surface_hash: SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH,
    attempts: candidate.attempts,
    decision_hashes: decisionHashes,
    segment_counts: segmentCounts,
    dialogue_counts: dialogueCounts,
    reference_usage_counts: referenceUsageCounts,
  };
  try {
    if (reportPath) await writeCertificationReport(reportPath, report);
  } catch {
    const failure: SemanticDirectorCertificationFailure = {
      status: "FAILED",
      profile_id: candidate.profile.profileId,
      model: candidate.profile.model,
      stage: "CERTIFICATION",
      code: "CERTIFICATION_REPORT_WRITE_FAILED",
      retryable: false,
      attempt: candidate.attempts,
    };
    writeError(JSON.stringify(failure));
    return failure;
  }
  writeOutput(JSON.stringify(report));
  return report;
};

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const result = await runSemanticDirectorCertification();
  process.exitCode = result.status === "CANDIDATE_PASS" ? 0 : 1;
}
