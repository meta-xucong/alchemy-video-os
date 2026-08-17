import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ProviderFailureCode,
  ProviderStatus,
  VideoProviderFailureStage,
} from "@alchemy-video/provider-video";

import type { CertifierPaths } from "./recovery-state.js";

export type CertificationProviderState = ProviderStatus["state"];

export type CertificationFailureClassification =
  | "REJECTED"
  | "UNAVAILABLE"
  | "PROTOCOL_DRIFT"
  | "DOWNLOAD_INVALID";

export type CertificationProviderFailure = Readonly<{
  classification: CertificationFailureClassification;
  code: ProviderFailureCode;
  stage: VideoProviderFailureStage;
  retryable: boolean;
}>;

export type CertificationReport = Readonly<{
  version: 1;
  evidenceId: string;
  caseId: "LIVE-GROK-001";
  profile: "grok-imagine-video-1.5";
  model: "grok-imagine-video-1.5";
  recordedAt: string;
  outcome: "SUBMITTED_STOPPED" | "SUCCEEDED" | "FAILED" | "LIVE_CALLS_SKIPPED";
  submitted: boolean;
  providerRequestIdHash?: string;
  requestFieldNames: readonly string[];
  responseFieldNames: readonly string[];
  providerState?: CertificationProviderState;
  providerFailure?: CertificationProviderFailure;
  terminalStatus?: "SUCCEEDED" | "FAILED";
  downloadValidation?: Readonly<{
    mimeType: "video/mp4";
    contentLength?: number;
    sha256: string;
    ffprobeOk: true;
  }>;
  redactions: readonly string[];
  cleanup: "RECOVERY_RETAINED" | "RECOVERY_CLEARED" | "NO_RECOVERY";
}>;

const safeFieldName = (field: string) => !/(authorization|bearer|cookie|key|token|signature|url|object|message|detail|description|prompt|payload|body)/i.test(field);

export const safeFieldNames = (payload: unknown) => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.keys(payload).filter(safeFieldName).sort();
};

export const hashProviderRequestId = (providerRequestId: string) =>
  `sha256:${createHash("sha256").update(providerRequestId).digest("hex")}`;

const reportFilename = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;

export const writeCertificationReport = async (paths: CertifierPaths, report: CertificationReport) => {
  await mkdir(paths.reportsDirectory, { recursive: true, mode: 0o700 });
  const path = join(paths.reportsDirectory, reportFilename());
  await writeFile(path, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
  return path;
};

export const hasRecordedSubmission = async (paths: CertifierPaths) => {
  try {
    const files = await readdir(paths.reportsDirectory);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const value = JSON.parse(await readFile(join(paths.reportsDirectory, file), "utf8")) as { submitted?: unknown };
        if (value.submitted === true) return true;
      } catch {
        // A malformed ignored local report must not authorize another submission.
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};
