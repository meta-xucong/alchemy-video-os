import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CERTIFIER_ACTIVE_CLAIM_LEASE_MS,
  CERTIFIER_PROFILE,
  CERTIFIER_RECOVERY_TTL_MS,
} from "./config.js";

const execFileAsync = promisify(execFile);

export type CertifierPaths = Readonly<{
  capabilitySnapshotsDirectory: string;
  reportsDirectory: string;
  recoveryDirectory: string;
}>;

export const createCertifierPaths = (projectRoot: string): CertifierPaths => ({
  capabilitySnapshotsDirectory: join(projectRoot, "tools", "sub2api-video-certifier", "capability-snapshots"),
  reportsDirectory: join(projectRoot, "tools", "sub2api-video-certifier", "reports"),
  recoveryDirectory: join(projectRoot, "tools", "sub2api-video-certifier", "recovery"),
});

export type RecoveryState = Readonly<{
  version: 1;
  profile: typeof CERTIFIER_PROFILE;
  providerRequestId: string;
  createdAt: string;
  expiresAt: string;
}>;

const recoveryFilename = `${CERTIFIER_PROFILE}.json`;
const submissionReservationFilename = `${CERTIFIER_PROFILE}.submission-reservation.json`;
const activeClaimFilename = `${CERTIFIER_PROFILE}.active-claim.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseRecoveryState = (value: string): RecoveryState | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return undefined;
    if (parsed.version !== 1 || parsed.profile !== CERTIFIER_PROFILE) return undefined;
    if (typeof parsed.providerRequestId !== "string" || !parsed.providerRequestId.trim()) return undefined;
    if (typeof parsed.createdAt !== "string" || typeof parsed.expiresAt !== "string") return undefined;
    if (!Number.isFinite(Date.parse(parsed.createdAt)) || !Number.isFinite(Date.parse(parsed.expiresAt))) return undefined;
    return parsed as RecoveryState;
  } catch {
    return undefined;
  }
};

type SubmissionReservation = Readonly<{
  version: 1;
  profile: typeof CERTIFIER_PROFILE;
  reservedAt: string;
}>;

type ActiveClaim = Readonly<{
  version: 1;
  profile: typeof CERTIFIER_PROFILE;
  claimId: string;
  claimedAt: string;
  expiresAt: string;
}>;

const parseNonSensitiveState = <T extends SubmissionReservation | ActiveClaim>(value: string, expectsExpiry: boolean): T | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.profile !== CERTIFIER_PROFILE || typeof parsed.reservedAt !== "string" && typeof parsed.claimedAt !== "string") {
      return undefined;
    }
    if (expectsExpiry && (
      typeof parsed.claimId !== "string"
      || !parsed.claimId
      || typeof parsed.expiresAt !== "string"
      || !Number.isFinite(Date.parse(parsed.expiresAt))
    )) {
      return undefined;
    }
    return parsed as T;
  } catch {
    return undefined;
  }
};

const restrictWindowsDirectory = async (directory: string) => {
  const identity = userInfo().username;
  await execFileAsync("icacls", [directory, "/inheritance:r", "/grant:r", `${identity}:(OI)(CI)F`], { windowsHide: true });
};

const ensurePrivateDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  if (process.platform === "win32") await restrictWindowsDirectory(directory);
};

const recoveryPath = (paths: CertifierPaths) => join(paths.recoveryDirectory, recoveryFilename);
const submissionReservationPath = (paths: CertifierPaths) => join(paths.recoveryDirectory, submissionReservationFilename);
const activeClaimPath = (paths: CertifierPaths) => join(paths.recoveryDirectory, activeClaimFilename);

export type RecoveryClaim = Readonly<{
  state: RecoveryState;
  renew(now: Date): Promise<boolean>;
  complete(): Promise<void>;
  release(): Promise<void>;
}>;

export type RecoveryClaimResult =
  | Readonly<{ kind: "claimed"; claim: RecoveryClaim }>
  | Readonly<{ kind: "missing" | "expired" | "invalid" | "busy" }>;

export type RecoveryInspectionResult =
  | Readonly<{ kind: "ready"; state: RecoveryState }>
  | Readonly<{ kind: "missing" | "expired" | "invalid" }>;

export const writeRecoveryState = async (paths: CertifierPaths, providerRequestId: string, now: Date) => {
  await ensurePrivateDirectory(paths.recoveryDirectory);
  const path = recoveryPath(paths);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CERTIFIER_RECOVERY_TTL_MS).toISOString();
  const state: RecoveryState = {
    version: 1,
    profile: CERTIFIER_PROFILE,
    providerRequestId,
    createdAt,
    expiresAt,
  };
  await writeFile(path, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return state;
};

export type SubmissionReservationResult = "reserved" | "exists" | "unavailable";

export const reserveSubmission = async (paths: CertifierPaths, now: Date): Promise<SubmissionReservationResult> => {
  try {
    await ensurePrivateDirectory(paths.recoveryDirectory);
    await writeFile(submissionReservationPath(paths), JSON.stringify({
      version: 1,
      profile: CERTIFIER_PROFILE,
      reservedAt: now.toISOString(),
    } satisfies SubmissionReservation), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(submissionReservationPath(paths), 0o600);
    return "reserved";
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") return "exists";
    return "unavailable";
  }
};

export const hasRecoveryState = async (paths: CertifierPaths) => {
  try {
    const files = await readdir(paths.recoveryDirectory);
    return files.includes(recoveryFilename) || files.includes(activeClaimFilename);
  } catch {
    return false;
  }
};

export const hasSubmissionReservation = async (paths: CertifierPaths) => {
  try {
    const files = await readdir(paths.recoveryDirectory);
    return files.includes(submissionReservationFilename);
  } catch {
    return false;
  }
};

export const inspectRecoveryState = async (paths: CertifierPaths, now: Date): Promise<RecoveryInspectionResult> => {
  const path = recoveryPath(paths);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { kind: "missing" };
  }
  const state = parseRecoveryState(text);
  if (!state) {
    await rm(path, { force: true });
    return { kind: "invalid" };
  }
  if (Date.parse(state.expiresAt) <= now.getTime()) {
    await rm(path, { force: true });
    return { kind: "expired" };
  }
  return { kind: "ready", state };
};

export const claimRecoveryState = async (paths: CertifierPaths, now: Date): Promise<RecoveryClaimResult> => {
  const inspected = await inspectRecoveryState(paths, now);
  if (inspected.kind !== "ready") return inspected;

  const claimPath = activeClaimPath(paths);
  const claimId = randomUUID();
  const expiresAt = (at: Date, recoveryExpiresAt: string) => new Date(Math.min(
    at.getTime() + CERTIFIER_ACTIVE_CLAIM_LEASE_MS,
    Date.parse(recoveryExpiresAt),
  )).toISOString();
  const createClaim = async (): Promise<"claimed" | "busy"> => {
    try {
      await writeFile(claimPath, JSON.stringify({
        version: 1,
        profile: CERTIFIER_PROFILE,
        claimId,
        claimedAt: now.toISOString(),
        expiresAt: expiresAt(now, inspected.state.expiresAt),
      } satisfies ActiveClaim), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(claimPath, 0o600);
      return "claimed";
    } catch (error: unknown) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) return "busy";
      let active: ActiveClaim | undefined;
      try {
        active = parseNonSensitiveState<ActiveClaim>(await readFile(claimPath, "utf8"), true);
      } catch {
        active = undefined;
      }
      if (!active || Date.parse(active.expiresAt) <= now.getTime()) {
        await rm(claimPath, { force: true });
        return createClaim();
      }
      return "busy";
    }
  };

  if (await createClaim() !== "claimed") return { kind: "busy" };
  const rechecked = await inspectRecoveryState(paths, now);
  if (rechecked.kind !== "ready") {
    await rm(claimPath, { force: true });
    return rechecked;
  }
  try {
    await writeFile(claimPath, JSON.stringify({
      version: 1,
      profile: CERTIFIER_PROFILE,
      claimId,
      claimedAt: now.toISOString(),
      expiresAt: expiresAt(now, rechecked.state.expiresAt),
    } satisfies ActiveClaim), { encoding: "utf8", mode: 0o600, flag: "w" });
    await chmod(claimPath, 0o600);
  } catch {
    await rm(claimPath, { force: true });
    return { kind: "busy" };
  }

  const ownsClaim = async () => {
    try {
      const active = parseNonSensitiveState<ActiveClaim>(await readFile(claimPath, "utf8"), true);
      return active?.claimId === claimId;
    } catch {
      return false;
    }
  };

  return {
    kind: "claimed",
    claim: {
      state: rechecked.state,
      renew: async (at: Date) => {
        if (!await ownsClaim()) return false;
        try {
          await writeFile(claimPath, JSON.stringify({
            version: 1,
            profile: CERTIFIER_PROFILE,
            claimId,
            claimedAt: now.toISOString(),
            expiresAt: expiresAt(at, rechecked.state.expiresAt),
          } satisfies ActiveClaim), { encoding: "utf8", mode: 0o600, flag: "w" });
          await chmod(claimPath, 0o600);
          return true;
        } catch {
          return false;
        }
      },
      complete: async () => {
        if (!await ownsClaim()) return;
        await rm(recoveryPath(paths), { force: true });
        await rm(claimPath, { force: true });
      },
      release: async () => {
        if (await ownsClaim()) await rm(claimPath, { force: true });
      },
    },
  };
};

export const clearRecoveryState = async (paths: CertifierPaths) => {
  await rm(recoveryPath(paths), { force: true });
};
