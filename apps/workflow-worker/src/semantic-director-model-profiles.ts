export type SemanticDirectorResponseMode = "JSON_SCHEMA" | "JSON_OBJECT" | "PROMPT_ONLY";

const SAFE_SEMANTIC_DIRECTOR_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/u;

export const isSemanticDirectorSafeIdentifier = (value: string) =>
  SAFE_SEMANTIC_DIRECTOR_IDENTIFIER.test(value);

export type SemanticDirectorCertifiedModelProfile = Readonly<{
  profileId: string;
  provider: string;
  model: string;
  status: "CERTIFIED";
  responseMode: SemanticDirectorResponseMode;
  strictJson: true;
  contractVersion: "semantic-director-decision-v1";
  timeoutMs: number;
  maxInputUtf8Bytes: number;
  maxOutputTokens: number;
  fixtureId: string;
  certificationSurfaceHash: string;
  certificationSource?: "REGISTRY" | "LOCAL_REPORT";
}>;

export type SemanticDirectorUnavailableModelProfile = Readonly<{
  profileId: string;
  provider: string;
  model: string;
  status: "UNAVAILABLE";
  reasonCode:
    | "UPSTREAM_MODEL_REJECTED"
    | "TIMEOUT_OR_EMPTY_CONTENT"
    | "SEMANTIC_DECISION_V1_FIXTURE_FAILED"
    | "REFERENCE_VISION_ONLY";
}>;

export type SemanticDirectorModelProfile =
  | SemanticDirectorCertifiedModelProfile
  | SemanticDirectorUnavailableModelProfile;
export const semanticDirectorModelProfiles: readonly SemanticDirectorModelProfile[] = Object.freeze([
  {
    profileId: "aiself-claude-sonnet-5-candidate-v3",
    provider: "aiself-openai-compatible",
    model: "claude-sonnet-5",
    status: "CERTIFIED",
    responseMode: "JSON_SCHEMA",
    strictJson: true,
    contractVersion: "semantic-director-decision-v1",
    timeoutMs: 300_000,
    maxInputUtf8Bytes: 16_777_216,
    maxOutputTokens: 32_000,
    fixtureId: "semantic-director-certification-v1",
    certificationSurfaceHash: "b9a7ac3054686fdc0b0990c45efccd536c7e307ae315599bcb0543540b5fa9c1",
    certificationSource: "REGISTRY",
  },
  {
    profileId: "aiself-deepseek-v4-pro-observed-v1",
    provider: "aiself-openai-compatible",
    model: "deepseek-v4-pro",
    status: "UNAVAILABLE",
    reasonCode: "TIMEOUT_OR_EMPTY_CONTENT",
  },
  {
    profileId: "aiself-doubao-seed-2.0-pro-observed-v1",
    provider: "aiself-openai-compatible",
    model: "doubao-seed-2.0-pro",
    status: "UNAVAILABLE",
    reasonCode: "SEMANTIC_DECISION_V1_FIXTURE_FAILED",
  },
  {
    profileId: "aiself-doubao-seed-2-0-lite-260428-reference-vision-only",
    provider: "aiself-openai-compatible",
    model: "doubao-seed-2-0-lite-260428",
    status: "UNAVAILABLE",
    reasonCode: "REFERENCE_VISION_ONLY",
  },
]);
export type SemanticDirectorModelProfileErrorCode =
  | "PROFILE_NOT_FOUND"
  | "PROFILE_ID_CONFLICT"
  | "PROFILE_INVALID"
  | "PROFILE_MODEL_MISMATCH"
  | "PROFILE_UNAVAILABLE";

export class SemanticDirectorModelProfileError extends Error {
  constructor(
    readonly code: SemanticDirectorModelProfileErrorCode,
    message: string,
    readonly profileId?: string,
  ) {
    super(message);
    this.name = "SemanticDirectorModelProfileError";
  }
}

export const resolveCertifiedSemanticDirectorModelProfile = (
  input: Readonly<{ profileId: string; model: string }>,
  profiles: readonly SemanticDirectorModelProfile[] = semanticDirectorModelProfiles,
): SemanticDirectorCertifiedModelProfile => {
  const matches = profiles.filter((candidate) => candidate.profileId === input.profileId);
  if (matches.length === 0) {
    throw new SemanticDirectorModelProfileError("PROFILE_NOT_FOUND", "Semantic Director profile is not registered.", input.profileId);
  }
  if (matches.length !== 1) {
    throw new SemanticDirectorModelProfileError("PROFILE_ID_CONFLICT", "Semantic Director profile identity is ambiguous.", input.profileId);
  }
  const profile = matches[0]!;
  if (!isSemanticDirectorSafeIdentifier(profile.profileId)
    || !isSemanticDirectorSafeIdentifier(profile.provider)
    || !isSemanticDirectorSafeIdentifier(profile.model)) {
    throw new SemanticDirectorModelProfileError("PROFILE_INVALID", "Semantic Director profile identity is invalid.", input.profileId);
  }
  if (profile.model !== input.model) {
    throw new SemanticDirectorModelProfileError("PROFILE_MODEL_MISMATCH", "Semantic Director profile does not match the configured model.", input.profileId);
  }
  if (profile.status !== "CERTIFIED") {
    throw new SemanticDirectorModelProfileError("PROFILE_UNAVAILABLE", `Semantic Director profile is unavailable: ${profile.reasonCode}.`, input.profileId);
  }
  if (profile.strictJson !== true
    || profile.contractVersion !== "semantic-director-decision-v1"
    || !["JSON_SCHEMA", "JSON_OBJECT", "PROMPT_ONLY"].includes(profile.responseMode)
    || !Number.isSafeInteger(profile.timeoutMs)
    || profile.timeoutMs < 1
    || profile.timeoutMs > 300_000
    || !Number.isSafeInteger(profile.maxInputUtf8Bytes)
    || profile.maxInputUtf8Bytes < 1
    || profile.maxInputUtf8Bytes > 16_777_216
    || !Number.isSafeInteger(profile.maxOutputTokens)
    || profile.maxOutputTokens < 1
    || profile.maxOutputTokens > 65_536
    || !profile.fixtureId.trim()
    || !/^[a-f0-9]{64}$/u.test(profile.certificationSurfaceHash)
    || (profile.certificationSource !== undefined
      && profile.certificationSource !== "REGISTRY"
      && profile.certificationSource !== "LOCAL_REPORT")) {
    throw new SemanticDirectorModelProfileError("PROFILE_INVALID", "Semantic Director certified profile is malformed.", input.profileId);
  }
  return profile;
};
