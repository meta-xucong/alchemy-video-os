import {
  SemanticDirectorCertificationReportError,
  SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH,
  certifiedProfileFromLocalReport,
  loadSemanticDirectorCertificationReport,
} from "./semantic-director-certification.js";
import {
  SemanticDirectorModelProfileError,
  resolveCertifiedSemanticDirectorModelProfile,
  semanticDirectorModelProfiles,
  type SemanticDirectorCertifiedModelProfile,
  type SemanticDirectorModelProfile,
} from "./semantic-director-model-profiles.js";

export type SemanticDirectorRuntimeProfileResolutionErrorCode =
  | "LOCAL_CERTIFICATION_REPORT_FORBIDDEN"
  | "CERTIFICATION_REPORT_PATH_INVALID"
  | "CERTIFICATION_REPORT_PROFILE_MISMATCH"
  | "CERTIFICATION_SURFACE_MISMATCH"
  | SemanticDirectorCertificationReportError["code"]
  | SemanticDirectorModelProfileError["code"];

export class SemanticDirectorRuntimeProfileResolutionError extends Error {
  constructor(
    readonly code: SemanticDirectorRuntimeProfileResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SemanticDirectorRuntimeProfileResolutionError";
  }
}

const requireCurrentCertificationSurface = (
  profile: SemanticDirectorCertifiedModelProfile,
) => {
  if (profile.certificationSurfaceHash !== SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH) {
    throw new SemanticDirectorRuntimeProfileResolutionError(
      "CERTIFICATION_SURFACE_MISMATCH",
      "Semantic Director profile does not match the current request surface.",
    );
  }
  return profile;
};

export const resolveSemanticDirectorRuntimeProfile = (input: Readonly<{
  env: NodeJS.ProcessEnv;
  profileId: string;
  model: string;
  profiles?: readonly SemanticDirectorModelProfile[];
}>): SemanticDirectorCertifiedModelProfile => {
  let registryError: SemanticDirectorModelProfileError | undefined;
  try {
    return requireCurrentCertificationSurface(resolveCertifiedSemanticDirectorModelProfile(
      { profileId: input.profileId, model: input.model },
      input.profiles ?? semanticDirectorModelProfiles,
    ));
  } catch (error) {
    if (!(error instanceof SemanticDirectorModelProfileError)) throw error;
    registryError = error;
  }

  const allowLocalReport = input.env.SEMANTIC_PLANNER_ALLOW_LOCAL_CERTIFICATION_REPORT
    ?.trim().toLowerCase() === "true";
  if (!allowLocalReport) {
    throw new SemanticDirectorRuntimeProfileResolutionError(
      registryError.code,
      registryError.message,
    );
  }
  const nodeEnvironment = input.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnvironment !== "development" && nodeEnvironment !== "test") {
    throw new SemanticDirectorRuntimeProfileResolutionError(
      "LOCAL_CERTIFICATION_REPORT_FORBIDDEN",
      "Local Semantic Director certification reports are allowed only in explicit development or test environments.",
    );
  }
  const reportPath = input.env.SEMANTIC_PLANNER_CERTIFICATION_REPORT_PATH?.trim();
  if (!reportPath) {
    throw new SemanticDirectorRuntimeProfileResolutionError(
      "CERTIFICATION_REPORT_PATH_INVALID",
      "Local Semantic Director certification requires an absolute report path.",
    );
  }
  try {
    const report = loadSemanticDirectorCertificationReport(reportPath);
    if (report.profile_id !== input.profileId || report.model !== input.model) {
      throw new SemanticDirectorRuntimeProfileResolutionError(
        "CERTIFICATION_REPORT_PROFILE_MISMATCH",
        "Local Semantic Director certification report does not match the configured profile and model.",
      );
    }
    if (report.certification_surface_hash !== SEMANTIC_DIRECTOR_CERTIFICATION_SURFACE_HASH) {
      throw new SemanticDirectorRuntimeProfileResolutionError(
        "CERTIFICATION_SURFACE_MISMATCH",
        "Local Semantic Director certification report does not match the current request surface.",
      );
    }
    return requireCurrentCertificationSurface(resolveCertifiedSemanticDirectorModelProfile(
      { profileId: input.profileId, model: input.model },
      [certifiedProfileFromLocalReport(report)],
    ));
  } catch (error) {
    if (error instanceof SemanticDirectorRuntimeProfileResolutionError) throw error;
    if (error instanceof SemanticDirectorCertificationReportError
      || error instanceof SemanticDirectorModelProfileError) {
      throw new SemanticDirectorRuntimeProfileResolutionError(error.code, error.message);
    }
    throw error;
  }
};
