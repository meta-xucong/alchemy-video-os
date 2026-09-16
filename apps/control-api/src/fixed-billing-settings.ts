import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  FixedVideoBillingSettingsSchema,
  type FixedVideoBillingSettings,
  type FixedVideoBillingSettingsUpdate,
} from "@alchemy-video/contracts";

/**
 * Small server-owned settings store modelled on Alchemy Media's
 * veyra_billing_settings service.  The Control API is the only writer; task
 * snapshots remain immutable after a task or production run is created.
 */
export type FixedVideoBillingSettingsStore = {
  get(): FixedVideoBillingSettings;
  update(input: FixedVideoBillingSettingsUpdate): FixedVideoBillingSettings;
  updateIdempotent(input: FixedVideoBillingCommandInput): FixedVideoBillingCommandResult;
};

export type FixedVideoBillingCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  settings: FixedVideoBillingSettingsUpdate;
};

export type FixedVideoBillingCommandResult =
  | { kind: "NEW" | "REPLAY"; settings: FixedVideoBillingSettings }
  | { kind: "CONFLICT" };

export class FixedBillingSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedBillingSettingsError";
  }
}

const defaultSettings = (): FixedVideoBillingSettings => ({ enabled: false, tiers: [] });

const settingsPath = (path?: string) => path?.trim() || process.env.VIDEO_BILLING_SETTINGS_PATH?.trim() || join(process.cwd(), "data", "video-billing-settings.json");

// This key is deliberately private to the server-side file format. It is
// stripped before settings are parsed or returned, while keeping settings and
// the admin command receipt in one atomically replaced document.
const IDEMPOTENCY_METADATA_KEY = "__video_os_idempotency_v1";
const COMMAND_ID_PATTERN = /^[a-f0-9]{64}$/;
const LOCK_WAIT_TIMEOUT_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 5;
const LOCK_INVALID_MARKER_WAIT_MS = 100;

const parseSettings = (value: unknown): FixedVideoBillingSettings => {
  const parsed = FixedVideoBillingSettingsSchema.safeParse(value);
  if (!parsed.success) throw new FixedBillingSettingsError("Video fixed-tier billing settings are invalid.");
  return parsed.data;
};

type PersistedCommand = {
  request_hash: string;
  settings: FixedVideoBillingSettings;
};

type PersistedState = {
  settings: FixedVideoBillingSettings;
  commands: Record<string, PersistedCommand>;
};

const cloneSettings = (value: FixedVideoBillingSettings): FixedVideoBillingSettings => ({
  enabled: value.enabled,
  tiers: value.tiers.map((tier) => ({ ...tier })),
});

const parsePersistedCommands = (value: unknown): Record<string, PersistedCommand> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FixedBillingSettingsError("Video fixed-tier billing command receipts are invalid.");
  }
  const commands: Record<string, PersistedCommand> = Object.create(null) as Record<string, PersistedCommand>;
  for (const [commandId, rawCommand] of Object.entries(value)) {
    if (!COMMAND_ID_PATTERN.test(commandId) || !rawCommand || typeof rawCommand !== "object" || Array.isArray(rawCommand)) {
      throw new FixedBillingSettingsError("Video fixed-tier billing command receipts are invalid.");
    }
    const candidate = rawCommand as Record<string, unknown>;
    if (typeof candidate.request_hash !== "string" || candidate.request_hash.length === 0) {
      throw new FixedBillingSettingsError("Video fixed-tier billing command receipts are invalid.");
    }
    commands[commandId] = {
      request_hash: candidate.request_hash,
      settings: parseSettings(candidate.settings),
    };
  }
  return commands;
};

const parsePersistedState = (value: unknown): PersistedState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FixedBillingSettingsError("Video fixed-tier billing settings are invalid.");
  }
  const record = value as Record<string, unknown>;
  const { [IDEMPOTENCY_METADATA_KEY]: rawCommands, ...settingsPayload } = record;
  return {
    settings: parseSettings(settingsPayload),
    commands: parsePersistedCommands(rawCommands),
  };
};

const commandIdentity = (scope: string, idempotencyKey: string) =>
  createHash("sha256").update(`${scope}\u0000${idempotencyKey}`).digest("hex");

type SettingsFileLock = {
  path: string;
  descriptor: number;
  token: string;
};

const errorCode = (error: unknown) => (
  error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined
);

const waitSynchronously = (milliseconds: number) => {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
};

const processIsAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but cannot be signalled.  Unknown
    // platform errors are treated as alive so a lock is never reclaimed while
    // its owner may still be running.
    return errorCode(error) !== "ESRCH";
  }
};

type LockInspection = "MISSING" | "ACTIVE" | "STALE" | "INVALID";

const inspectSettingsFileLock = (lockPath: string): LockInspection => {
  let content: string;
  try {
    // A missing lock is normal between an owner's release and the next
    // exclusive create.  Other read failures are deliberately fail-closed.
    content = readFileSync(lockPath, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "MISSING" : "INVALID";
  }

  let owner: unknown;
  try {
    owner = JSON.parse(content);
  } catch {
    return "INVALID";
  }
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return "INVALID";
  const pid = (owner as { pid?: unknown }).pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return "INVALID";
  return processIsAlive(pid) ? "ACTIVE" : "STALE";
};

const reclaimStaleSettingsFileLock = (lockPath: string) => {
  const reclaimPath = `${lockPath}.${process.pid}.${Date.now()}.${randomUUID()}.reclaim`;
  try {
    // Both contenders may have observed the same dead PID.  Only the process
    // that wins this same-directory atomic rename owns the old marker; never
    // unlink the shared lock path after observing it as stale.
    renameSync(lockPath, reclaimPath);
  } catch {
    return false;
  }
  try {
    unlinkSync(reclaimPath);
  } catch {
    // The reclaimed marker is private and harmless if cleanup is interrupted.
  }
  return true;
};

const acquireSettingsFileLock = (filePath: string): SettingsFileLock => {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  let invalidMarkerSince: number | undefined;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch (error) {
    throw new FixedBillingSettingsError(error instanceof Error ? error.message : "Video fixed-tier billing lock directory could not be created.");
  }
  while (true) {
    let descriptor: number;
    try {
      descriptor = openSync(lockPath, "wx");
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        throw new FixedBillingSettingsError(error instanceof Error ? error.message : "Video fixed-tier billing lock could not be acquired.");
      }
      const inspection = inspectSettingsFileLock(lockPath);
      if (inspection === "STALE") {
        invalidMarkerSince = undefined;
        if (!reclaimStaleSettingsFileLock(lockPath)) {
          if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
            throw new FixedBillingSettingsError("Video fixed-tier billing settings are busy.");
          }
          waitSynchronously(LOCK_RETRY_DELAY_MS);
        }
        continue;
      }
      if (inspection === "INVALID") {
        invalidMarkerSince ??= Date.now();
        if (Date.now() - invalidMarkerSince >= LOCK_INVALID_MARKER_WAIT_MS) {
          throw new FixedBillingSettingsError("Video fixed-tier billing settings lock metadata is invalid; refusing to reclaim the lock.");
        }
      } else {
        invalidMarkerSince = undefined;
      }
      if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
        throw new FixedBillingSettingsError("Video fixed-tier billing settings are busy.");
      }
      waitSynchronously(LOCK_RETRY_DELAY_MS);
      continue;
    }

    try {
      const token = randomUUID();
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }), "utf8");
      return { path: lockPath, descriptor, token };
    } catch (error) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original lock marker error.
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // A failed cleanup is recoverable through the stale-lock check.
      }
      throw new FixedBillingSettingsError(error instanceof Error ? error.message : "Video fixed-tier billing lock could not be initialized.");
    }
  }
};

const ownsSettingsFileLock = (lock: SettingsFileLock) => {
  try {
    const owner = JSON.parse(readFileSync(lock.path, "utf8")) as { pid?: unknown; token?: unknown };
    return owner.pid === process.pid && owner.token === lock.token;
  } catch {
    return false;
  }
};

const releaseSettingsFileLock = (lock: SettingsFileLock) => {
  try {
    closeSync(lock.descriptor);
  } finally {
    if (ownsSettingsFileLock(lock)) {
      try {
        unlinkSync(lock.path);
      } catch {
        // A process crash leaves the marker for the next caller to reclaim;
        // release failures must not turn an already persisted update into an
        // ambiguous API result.
      }
    }
  }
};

const withSettingsFileLock = <T>(filePath: string, callback: () => T): T => {
  const lock = acquireSettingsFileLock(filePath);
  try {
    return callback();
  } finally {
    releaseSettingsFileLock(lock);
  }
};

export const createFixedVideoBillingSettingsStore = (path?: string): FixedVideoBillingSettingsStore => {
  const filePath = settingsPath(path);

  // Read on every call.  The file is shared by independently created Control
  // API instances and a permanent process-local cache would make a later
  // settings update invisible after the first read.
  const load = (): PersistedState => {
    if (!existsSync(filePath)) {
      return { settings: defaultSettings(), commands: {} };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      throw new FixedBillingSettingsError("Video fixed-tier billing settings could not be read.");
    }
    return parsePersistedState(payload);
  };

  const save = (settings: FixedVideoBillingSettings, commands: Record<string, PersistedCommand>) => {
    const payload: Record<string, unknown> = {
      ...settings,
    };
    if (Object.keys(commands).length > 0) {
      payload[IDEMPOTENCY_METADATA_KEY] = commands;
    }
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, filePath);
    } catch (error) {
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Keep the original write error as the actionable failure. A
        // leftover temp file is harmless and is never read as settings.
      }
      throw new FixedBillingSettingsError(error instanceof Error ? error.message : "Video fixed-tier billing settings could not be saved.");
    }
  };

  return {
    get: () => {
      return cloneSettings(load().settings);
    },
    update: (input) => {
      const value = parseSettings(input);
      return withSettingsFileLock(filePath, () => {
        const current = load();
        save(value, current.commands);
        return cloneSettings(value);
      });
    },
    updateIdempotent: (input) => {
      const value = parseSettings(input.settings);
      return withSettingsFileLock(filePath, () => {
        const current = load();
        const id = commandIdentity(input.scope, input.idempotencyKey);
        const existing = current.commands[id];
        if (existing) {
          return existing.request_hash === input.requestHash
            ? { kind: "REPLAY" as const, settings: cloneSettings(existing.settings) }
            : { kind: "CONFLICT" as const };
        }
        const commands = {
          ...current.commands,
          [id]: {
            request_hash: input.requestHash,
            settings: cloneSettings(value),
          },
        };
        save(value, commands);
        return { kind: "NEW" as const, settings: cloneSettings(value) };
      });
    },
  };
};

/** Exact match only; callers must handle `undefined` as a billing block. */
export const resolveFixedVideoBillingTier = (
  settings: FixedVideoBillingSettings,
  input: { model: string; resolution: string; duration: number },
) => {
  if (!settings.enabled) return undefined;
  const matches = settings.tiers.filter((tier) => tier.enabled
    && tier.model === input.model
    && tier.resolution === input.resolution
    && tier.duration_seconds === input.duration);
  return matches.length === 1 ? matches[0] : undefined;
};
