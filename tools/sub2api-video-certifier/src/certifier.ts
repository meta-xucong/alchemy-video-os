import {
  Sub2ApiVideoProvider,
  VideoProviderFailure,
  VideoProviderProtocolError,
  type Sub2ApiTransport,
  type ProviderFailureCode,
  type ProviderStatus,
  type VideoProviderFailureStage,
  type VideoProviderPort,
  validateMp4Bytes,
} from "@alchemy-video/provider-video";

import {
  CERTIFIER_INPUT,
  CERTIFIER_MAX_POLL_ATTEMPTS,
  CERTIFIER_MAX_RESUME_GET_ATTEMPTS,
  CERTIFIER_POLL_INTERVAL_MS,
  CERTIFIER_PROFILE,
  isExactLiveAuthorization,
  type CertifierArguments,
} from "./config.js";
import type { LiveEnvironment } from "./live-transport.js";
import {
  claimRecoveryState,
  createCertifierPaths,
  hasRecoveryState,
  hasSubmissionReservation,
  inspectRecoveryState,
  reserveSubmission,
  writeRecoveryState,
  type CertifierPaths,
} from "./recovery-state.js";
import {
  hashProviderRequestId,
  hasRecordedSubmission,
  safeFieldNames,
  writeCertificationReport,
  type CertificationProviderFailure,
  type CertificationProviderState,
  type CertificationReport,
} from "./report.js";

export type CertificationResult = Readonly<{
  outcome: "LIVE_CALLS_SKIPPED" | "SUBMITTED_STOPPED" | "SUCCEEDED" | "FAILED";
  reason?: "LIVE_GUARD" | "SUBMISSION_LIMIT" | "RECOVERY_MISSING" | "RECOVERY_EXPIRED" | "RECOVERY_INVALID" | "RECOVERY_BUSY" | "RECOVERY_RETRY_PENDING";
  providerRequestIdHash?: string;
}>;

export type CertifierDependencies = Readonly<{
  paths: CertifierPaths;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  readLiveEnvironment: () => LiveEnvironment;
  createTransport: (environment: LiveEnvironment) => Sub2ApiTransport;
}>;

const noOpSleep = async () => undefined;

export const createDefaultDependencies = (projectRoot: string): Omit<CertifierDependencies, "readLiveEnvironment" | "createTransport"> => ({
  paths: createCertifierPaths(projectRoot),
  now: () => new Date(),
  sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

const skipped = (reason: NonNullable<CertificationResult["reason"]>): CertificationResult => ({
  outcome: "LIVE_CALLS_SKIPPED",
  reason,
});

const reportBase = (now: Date, outcome: CertificationReport["outcome"], submitted: boolean): Omit<CertificationReport, "providerRequestIdHash" | "responseFieldNames" | "providerState" | "providerFailure" | "terminalStatus" | "downloadValidation" | "cleanup"> => ({
  version: 1,
  evidenceId: `cert_${now.toISOString().replace(/[-:.TZ]/g, "")}`,
  caseId: "LIVE-GROK-001",
  profile: CERTIFIER_PROFILE,
  model: CERTIFIER_PROFILE,
  recordedAt: now.toISOString(),
  outcome,
  submitted,
  requestFieldNames: ["duration", "model", "ratio", "reference_asset_ids", "resolution"],
  redactions: ["credentials", "network-locators", "provider-identifiers", "request-content", "response-content"],
});

const readStream = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      length += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

class RecoveryExpiredError extends Error {}
class RecoveryClaimLostError extends Error {}

const classifyProviderFailure = (code: ProviderFailureCode): CertificationProviderFailure["classification"] => {
  switch (code) {
    case "PROVIDER_REJECTED":
      return "REJECTED";
    case "PROVIDER_UNAVAILABLE":
      return "UNAVAILABLE";
    case "PROVIDER_PROTOCOL_INVALID":
      return "PROTOCOL_DRIFT";
    case "DOWNLOAD_INVALID":
      return "DOWNLOAD_INVALID";
  }
};

const safeProviderFailure = (
  error: unknown,
  fallbackStage: VideoProviderFailureStage,
): CertificationProviderFailure | undefined => {
  if (error instanceof VideoProviderFailure) {
    return {
      classification: classifyProviderFailure(error.code),
      code: error.code,
      stage: error.stage,
      retryable: error.retryable,
    };
  }
  if (error instanceof VideoProviderProtocolError) {
    return {
      classification: "PROTOCOL_DRIFT",
      code: "PROVIDER_PROTOCOL_INVALID",
      stage: fallbackStage,
      retryable: false,
    };
  }
  return undefined;
};

const ensureRecoveryClaim = async (expiresAt: string, claim: { renew(now: Date): Promise<boolean> }, now: () => Date) => {
  const current = now();
  if (Date.parse(expiresAt) <= current.getTime()) throw new RecoveryExpiredError();
  if (!await claim.renew(current)) throw new RecoveryClaimLostError();
};

type ValidatedDownload = Readonly<{
  validated: Awaited<ReturnType<typeof validateMp4Bytes>>;
  contentLength?: number;
}>;

const downloadAndValidate = async (
  provider: VideoProviderPort,
  providerRequestId: string,
  dependencies: CertifierDependencies,
  expiresAt: string,
  claim: { renew(now: Date): Promise<boolean> },
): Promise<ValidatedDownload> => {
  let download;
  try {
    download = await provider.download({ providerRequestId });
  } catch (error) {
    if (error instanceof VideoProviderFailure) throw error;
    throw new VideoProviderFailure(
      "DOWNLOAD_INVALID",
      false,
      "DOWNLOAD",
      "The provider download response was invalid.",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readStream(download.stream);
  } catch {
    throw new VideoProviderFailure(
      "PROVIDER_UNAVAILABLE",
      true,
      "DOWNLOAD",
      "The provider download stream was interrupted.",
    );
  }

  await ensureRecoveryClaim(expiresAt, claim, dependencies.now);
  if (download.contentLength !== undefined && download.contentLength !== bytes.byteLength) {
    throw new VideoProviderFailure(
      "DOWNLOAD_INVALID",
      false,
      "DOWNLOAD",
      "The provider download length was invalid.",
    );
  }

  try {
    return {
      validated: await validateMp4Bytes(bytes, download.mimeType),
      ...(download.contentLength === undefined ? {} : { contentLength: download.contentLength }),
    };
  } catch (error) {
    if (error instanceof VideoProviderFailure) throw error;
    throw new VideoProviderFailure(
      "DOWNLOAD_INVALID",
      false,
      "DOWNLOAD",
      "The provider download failed media validation.",
    );
  }
};

const pollToTerminal = async (
  provider: VideoProviderPort,
  providerRequestId: string,
  dependencies: CertifierDependencies,
  expiresAt: string,
  claim: { renew(now: Date): Promise<boolean> },
  observeProviderState: (state: CertificationProviderState) => void,
) => {
  for (let attempt = 0; attempt < CERTIFIER_MAX_POLL_ATTEMPTS; attempt += 1) {
    await ensureRecoveryClaim(expiresAt, claim, dependencies.now);
    const status = await provider.getStatus({ providerRequestId });
    observeProviderState(status.state);
    if (status.state === "FAILED" && status.retryable) {
      throw new VideoProviderFailure(status.code, true, "PROVIDER", status.message);
    }
    if (status.state !== "PROCESSING") return status;
    await dependencies.sleep(CERTIFIER_POLL_INTERVAL_MS);
  }
  throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "The certification poll did not reach a terminal state.");
};

const writeFailureReport = async (
  dependencies: CertifierDependencies,
  providerRequestId: string | undefined,
  responseFields: readonly string[],
  cleanup: CertificationReport["cleanup"],
  submitted: boolean,
  evidence: Readonly<{
    providerState?: CertificationProviderState;
    error?: unknown;
    fallbackStage: VideoProviderFailureStage;
  }>,
) => {
  const now = dependencies.now();
  try {
    await writeCertificationReport(dependencies.paths, {
      ...reportBase(now, "FAILED", submitted),
      ...(providerRequestId ? { providerRequestIdHash: hashProviderRequestId(providerRequestId) } : {}),
      responseFieldNames: responseFields,
      ...(evidence.providerState ? { providerState: evidence.providerState } : {}),
      ...(evidence.error ? { providerFailure: safeProviderFailure(evidence.error, evidence.fallbackStage) } : {}),
      terminalStatus: "FAILED",
      cleanup,
    });
  } catch {
    // The prior reservation still permanently prevents a second POST.
  }
};

const writeRetryPendingReport = async (
  dependencies: CertifierDependencies,
  providerRequestId: string,
  responseFields: readonly string[],
  providerState: CertificationProviderState | undefined,
  failure: VideoProviderFailure,
) => {
  try {
    await writeCertificationReport(dependencies.paths, {
      ...reportBase(dependencies.now(), "LIVE_CALLS_SKIPPED", true),
      providerRequestIdHash: hashProviderRequestId(providerRequestId),
      responseFieldNames: responseFields,
      ...(providerState ? { providerState } : {}),
      providerFailure: safeProviderFailure(failure, failure.stage),
      cleanup: "RECOVERY_RETAINED",
    });
  } catch {
    // The recovery state and reservation are the fail-closed source of truth.
  }
};

const withGetOnlyRetries = async <T>(
  operation: () => Promise<T>,
  dependencies: CertifierDependencies,
  expiresAt: string,
  claim: { renew(now: Date): Promise<boolean> },
): Promise<
  | Readonly<{ kind: "completed"; value: T }>
  | Readonly<{ kind: "pending"; failure: VideoProviderFailure }>
  | Readonly<{ kind: "expired" }>
  | Readonly<{ kind: "busy" }>
> => {
  for (let attempt = 0; attempt < CERTIFIER_MAX_RESUME_GET_ATTEMPTS; attempt += 1) {
    try {
      await ensureRecoveryClaim(expiresAt, claim, dependencies.now);
      return { kind: "completed", value: await operation() };
    } catch (error) {
      if (error instanceof RecoveryExpiredError) return { kind: "expired" };
      if (error instanceof RecoveryClaimLostError) return { kind: "busy" };
      if (!(error instanceof VideoProviderFailure) || !error.retryable) throw error;
      if (attempt + 1 === CERTIFIER_MAX_RESUME_GET_ATTEMPTS) return { kind: "pending", failure: error };
      await dependencies.sleep(CERTIFIER_POLL_INTERVAL_MS);
    }
  }
  throw new VideoProviderFailure("PROVIDER_UNAVAILABLE", true, "PROVIDER", "The certification retry loop did not complete.");
};

const createObservedProvider = (dependencies: CertifierDependencies, observedResponseFields: string[]) => {
  try {
    const environment = dependencies.readLiveEnvironment();
    const transport = dependencies.createTransport(environment);
    return new Sub2ApiVideoProvider({
      request: async (request) => {
        const response = await transport.request(request);
        observedResponseFields.push(...safeFieldNames(response.json));
        return response;
      },
    });
  } catch {
    return undefined;
  }
};

export const runCertification = async (arguments_: CertifierArguments, dependencies: CertifierDependencies): Promise<CertificationResult> => {
  if (!isExactLiveAuthorization(arguments_)) return skipped("LIVE_GUARD");

  if (arguments_.mode === "stop-after-submit") {
    if (await hasRecordedSubmission(dependencies.paths) || await hasSubmissionReservation(dependencies.paths) || await hasRecoveryState(dependencies.paths)) {
      return skipped("SUBMISSION_LIMIT");
    }
    const observedResponseFields: string[] = [];
    const provider = createObservedProvider(dependencies, observedResponseFields);
    if (!provider) return skipped("LIVE_GUARD");
    if (await reserveSubmission(dependencies.paths, dependencies.now()) !== "reserved") {
      return skipped("SUBMISSION_LIMIT");
    }
    try {
      const submission = await provider.submit({
        taskRunId: "certifier_live_grok_001",
        inputSnapshot: CERTIFIER_INPUT,
        visualInput: { mode: "TEXT" },
      });
      const now = dependencies.now();
      try {
        await writeRecoveryState(dependencies.paths, submission.providerRequestId, now);
      } catch {
        await writeFailureReport(dependencies, submission.providerRequestId, [...new Set(observedResponseFields)].sort(), "NO_RECOVERY", true, {
          fallbackStage: "PROVIDER",
        });
        return { outcome: "FAILED" };
      }
      try {
        await writeCertificationReport(dependencies.paths, {
          ...reportBase(now, "SUBMITTED_STOPPED", true),
          providerRequestIdHash: hashProviderRequestId(submission.providerRequestId),
          responseFieldNames: [...new Set(observedResponseFields)].sort(),
          cleanup: "RECOVERY_RETAINED",
        });
      } catch {
        return { outcome: "FAILED", providerRequestIdHash: hashProviderRequestId(submission.providerRequestId) };
      }
      return { outcome: "SUBMITTED_STOPPED", providerRequestIdHash: hashProviderRequestId(submission.providerRequestId) };
    } catch (error) {
      await writeFailureReport(dependencies, undefined, [...new Set(observedResponseFields)].sort(), "NO_RECOVERY", true, {
        error,
        fallbackStage: "PROVIDER",
      });
      return { outcome: "FAILED" };
    }
  }

  const inspection = await inspectRecoveryState(dependencies.paths, dependencies.now());
  if (inspection.kind !== "ready") {
    const reason = inspection.kind === "expired"
      ? "RECOVERY_EXPIRED"
      : inspection.kind === "invalid"
        ? "RECOVERY_INVALID"
        : "RECOVERY_MISSING";
    return skipped(reason);
  }

  const claimResult = await claimRecoveryState(dependencies.paths, dependencies.now());
  if (claimResult.kind !== "claimed") {
    const reason = claimResult.kind === "busy"
      ? "RECOVERY_BUSY"
      : claimResult.kind === "expired"
      ? "RECOVERY_EXPIRED"
      : claimResult.kind === "invalid"
        ? "RECOVERY_INVALID"
        : "RECOVERY_MISSING";
    return skipped(reason);
  }
  const { claim } = claimResult;
  const observedResponseFields: string[] = [];
  const provider = createObservedProvider(dependencies, observedResponseFields);
  if (!provider) {
    await claim.release();
    return skipped("LIVE_GUARD");
  }
  let completed = false;
  let observedProviderState: CertificationProviderState | undefined;
  let failureStage: VideoProviderFailureStage = "PROVIDER";
  try {
    const polled = await withGetOnlyRetries(
      () => pollToTerminal(
        provider,
        claim.state.providerRequestId,
        dependencies,
        claim.state.expiresAt,
        claim,
        (state) => { observedProviderState = state; },
      ),
      dependencies,
      claim.state.expiresAt,
      claim,
    );
    if (polled.kind === "pending") {
      await writeRetryPendingReport(
        dependencies,
        claim.state.providerRequestId,
        [...new Set(observedResponseFields)].sort(),
        observedProviderState,
        polled.failure,
      );
      return skipped("RECOVERY_RETRY_PENDING");
    }
    if (polled.kind === "expired") {
      completed = true;
      return skipped("RECOVERY_EXPIRED");
    }
    if (polled.kind === "busy") return skipped("RECOVERY_BUSY");
    const status = polled.value;
    if (status.state === "FAILED") {
      completed = true;
      await writeFailureReport(dependencies, claim.state.providerRequestId, [...new Set(observedResponseFields)].sort(), "RECOVERY_CLEARED", true, {
        providerState: status.state,
        error: new VideoProviderFailure(status.code, status.retryable, "PROVIDER", status.message),
        fallbackStage: "PROVIDER",
      });
      return { outcome: "FAILED", providerRequestIdHash: hashProviderRequestId(claim.state.providerRequestId) };
    }
    failureStage = "DOWNLOAD";
    const downloaded = await withGetOnlyRetries(
      () => downloadAndValidate(
        provider,
        claim.state.providerRequestId,
        dependencies,
        claim.state.expiresAt,
        claim,
      ),
      dependencies,
      claim.state.expiresAt,
      claim,
    );
    if (downloaded.kind === "pending") {
      await writeRetryPendingReport(
        dependencies,
        claim.state.providerRequestId,
        [...new Set(observedResponseFields)].sort(),
        observedProviderState,
        downloaded.failure,
      );
      return skipped("RECOVERY_RETRY_PENDING");
    }
    if (downloaded.kind === "expired") {
      completed = true;
      return skipped("RECOVERY_EXPIRED");
    }
    if (downloaded.kind === "busy") return skipped("RECOVERY_BUSY");
    const { validated, contentLength } = downloaded.value;
    completed = true;
    try {
      await writeCertificationReport(dependencies.paths, {
        ...reportBase(dependencies.now(), "SUCCEEDED", true),
        providerRequestIdHash: hashProviderRequestId(claim.state.providerRequestId),
        responseFieldNames: [...new Set(observedResponseFields)].sort(),
        providerState: observedProviderState,
        terminalStatus: "SUCCEEDED",
        downloadValidation: {
          mimeType: validated.mimeType,
          ...(contentLength === undefined ? {} : { contentLength }),
          sha256: validated.sha256,
          ffprobeOk: true,
        },
        cleanup: "RECOVERY_CLEARED",
      });
      return { outcome: "SUCCEEDED", providerRequestIdHash: hashProviderRequestId(claim.state.providerRequestId) };
    } catch {
      return { outcome: "FAILED", providerRequestIdHash: hashProviderRequestId(claim.state.providerRequestId) };
    }
  } catch (error) {
    if (error instanceof RecoveryExpiredError) {
      completed = true;
      return skipped("RECOVERY_EXPIRED");
    }
    if (error instanceof RecoveryClaimLostError) return skipped("RECOVERY_BUSY");
    completed = true;
    await writeFailureReport(dependencies, claim.state.providerRequestId, [...new Set(observedResponseFields)].sort(), "RECOVERY_CLEARED", true, {
      providerState: observedProviderState,
      error,
      fallbackStage: failureStage,
    });
    return { outcome: "FAILED", providerRequestIdHash: hashProviderRequestId(claim.state.providerRequestId) };
  } finally {
    if (completed) await claim.complete();
    else await claim.release();
  }
};

export const createTestDependencies = (input: Omit<CertifierDependencies, "sleep"> & { sleep?: CertifierDependencies["sleep"] }): CertifierDependencies => ({
  ...input,
  sleep: input.sleep ?? noOpSleep,
});
