import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CERTIFIER_INPUT,
  CERTIFIER_PROFILE,
} from "./config.js";
import type { CertifierPaths } from "./recovery-state.js";
import type { CertificationReport } from "./report.js";

export type LocalCapabilitySnapshot = Readonly<{
  version: 1;
  evidenceId: string;
  caseId: "LIVE-GROK-001";
  profile: typeof CERTIFIER_PROFILE;
  model: typeof CERTIFIER_PROFILE;
  certifiedAt: string;
  certificationStatus: "CERTIFIED";
  enabled: false;
  inputModes: readonly ["text_to_video"];
  durations: readonly [typeof CERTIFIER_INPUT.duration];
  resolutions: readonly [typeof CERTIFIER_INPUT.resolution];
  ratios: readonly [typeof CERTIFIER_INPUT.ratio];
  requestFieldNames: readonly string[];
  responseFieldNames: readonly string[];
  downloadValidation: Readonly<{
    mimeType: "video/mp4";
    contentLength?: number;
    sha256: string;
    ffprobeOk: true;
  }>;
  promotion: "REQUIRES_INDEPENDENT_AUDIT";
}>;

const safeSnapshotFilename = (evidenceId: string) => {
  if (!/^cert_\d{14,}$/.test(evidenceId)) throw new Error("invalid certification evidence id");
  return `${evidenceId}.json`;
};

export const isCertifiedReport = (report: CertificationReport): report is CertificationReport & Required<Pick<CertificationReport, "downloadValidation" | "providerState" | "terminalStatus">> =>
  report.outcome === "SUCCEEDED"
  && report.submitted === true
  && report.providerState === "SUCCEEDED"
  && report.terminalStatus === "SUCCEEDED"
  && report.cleanup === "RECOVERY_CLEARED"
  && report.downloadValidation !== undefined;

export const createLocalCapabilitySnapshot = (report: CertificationReport): LocalCapabilitySnapshot => {
  if (!isCertifiedReport(report)) throw new Error("certification report is not a complete success");
  return {
    version: 1,
    evidenceId: report.evidenceId,
    caseId: report.caseId,
    profile: report.profile,
    model: report.model,
    certifiedAt: report.recordedAt,
    certificationStatus: "CERTIFIED",
    enabled: false,
    inputModes: ["text_to_video"],
    durations: [CERTIFIER_INPUT.duration],
    resolutions: [CERTIFIER_INPUT.resolution],
    ratios: [CERTIFIER_INPUT.ratio],
    requestFieldNames: [...report.requestFieldNames],
    responseFieldNames: [...report.responseFieldNames],
    downloadValidation: report.downloadValidation,
    promotion: "REQUIRES_INDEPENDENT_AUDIT",
  };
};

export const writeLocalCapabilitySnapshot = async (paths: CertifierPaths, snapshot: LocalCapabilitySnapshot) => {
  await mkdir(paths.capabilitySnapshotsDirectory, { recursive: true, mode: 0o700 });
  const path = join(paths.capabilitySnapshotsDirectory, safeSnapshotFilename(snapshot.evidenceId));
  await writeFile(path, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  return path;
};
