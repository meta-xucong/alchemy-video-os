import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { PlatformDatabase } from "./db.js";
import { assets, commandDeduplications, documentConversions, productionRuns, productionSegments, projects, referenceBindings, shots, taskRuns } from "./schema.js";
import { assetScope, projectScope, shotScope } from "./workspace-repositories.js";

export type AssetKind = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "POSTER" | "THUMBNAIL";
export type AssetStatus = "PENDING_UPLOAD" | "READY" | "FAILED" | "DELETED";
export type ShotStatus = "DRAFT" | "READY" | "GENERATING" | "GENERATED" | "FAILED" | "ARCHIVED";
export type ReferenceRole = "STYLE" | "SUBJECT" | "FIRST_FRAME" | "LAST_FRAME";
/** Server-owned purpose for uploaded audio. Omitted means unclassified audio. */
export type AudioAssetRole = "MUSIC" | "NARRATION_SAMPLE" | "USER_SOURCE_AUDIO";

export type ControlAsset = {
  id: string;
  workspaceId: string;
  projectId: string;
  kind: AssetKind;
  origin: "USER_UPLOAD" | "GENERATED" | "DERIVED";
  status: AssetStatus;
  objectKey: string;
  sha256: string | null;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ControlShot = {
  id: string;
  workspaceId: string;
  projectId: string;
  position: number;
  prompt: string;
  model: string | null;
  generationSettings: Record<string, unknown>;
  status: ShotStatus;
  selectedAssetId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ControlReferenceBinding = {
  shotId: string;
  assetId: string;
  role: ReferenceRole;
  position: number;
  createdAt: string;
};

export type AssetCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  assetId: string;
  kind: Extract<AssetKind, "IMAGE" | "AUDIO" | "DOCUMENT">;
  objectKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  /** Internal mapper only; never copied from arbitrary browser metadata. */
  audioRole?: AudioAssetRole;
  metadata?: Record<string, unknown>;
};

export type ConfirmAssetInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  assetId: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Server-derived metadata from an internal importer; not a public command field. */
  metadata?: Record<string, unknown>;
  visualAnalysis?: {
    role: "STYLE" | "SUBJECT" | "SCENE";
    confidence: number;
    summary?: string;
    objects?: Array<{
      name: string;
      description: string;
      relation: string;
      prohibited_changes: string[];
    }>;
  };
  visualAnalysisStatus?: "READY" | "UNAVAILABLE" | "FAILED";
  verifyUpload: (asset: ControlAsset) => Promise<boolean>;
};

/** Internal retry path for server-produced reference-image analysis. */
export type UpdateVisualReferenceAnalysisInput = {
  workspaceId: string;
  projectId: string;
  assetId: string;
  visualAnalysis?: ConfirmAssetInput["visualAnalysis"];
  visualAnalysisStatus: NonNullable<ConfirmAssetInput["visualAnalysisStatus"]>;
};

/** Internal server-generated audio asset lifecycle; never a browser upload command. */
export type GeneratedAudioAssetInput = {
  workspaceId: string;
  projectId: string;
  assetId: string;
  objectKey: string;
  metadata: Record<string, unknown>;
};

export type CompletedAudioAssetInput = {
  workspaceId: string;
  assetId: string;
  sha256: string;
  mimeType: string;
  byteSize: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
};

export type DeleteAssetInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  assetId: string;
};

export type CreateShotInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  shotId: string;
  position: number;
  prompt: string;
  model: string | null;
  generationSettings: Record<string, unknown>;
  referenceBindings: Array<{ assetId: string; role: ReferenceRole; position: number }>;
};

export type UpdateShotInput = Omit<CreateShotInput, "projectId" | "shotId" | "position" | "prompt" | "model" | "generationSettings" | "referenceBindings"> & {
  shotId: string;
  position?: number;
  prompt?: string;
  model?: string | null;
  generationSettings?: Record<string, unknown>;
  status?: Extract<ShotStatus, "DRAFT" | "READY" | "ARCHIVED">;
  selectedAssetId?: string | null;
  referenceBindings?: Array<{ assetId: string; role: ReferenceRole; position: number }>;
};

export type AssetCommandConflict = { kind: "CONFLICT" };
export type AssetCommandNotFound = { kind: "NOT_FOUND"; status: 404 };
export type AssetCommandExecution<T> = { kind: "NEW" | "REPLAY"; value: T; status: 200 | 201 };
export type AssetCommandInvalidUpload = { kind: "INVALID_UPLOAD" };
export type AssetCommandInvalidDelete = { kind: "INVALID_DELETE" };
export type AssetCommandInUse = { kind: "ASSET_IN_USE" };
export type AssetCommandPositionConflict = { kind: "POSITION_CONFLICT" };

type CommandSnapshot = Record<string, unknown>;
type QueryExecutor = Pick<PlatformDatabase, "select" | "insert" | "update" | "delete" | "execute">;

const commandScope = (scope: string, idempotencyKey: string) =>
  and(eq(commandDeduplications.scope, scope), eq(commandDeduplications.idempotencyKey, idempotencyKey));
const isConflict = (requestHash: string, existingHash: string) => requestHash !== existingHash;
const isNotFoundSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "NOT_FOUND" && snapshot.status === 404;
const isAssetSnapshot = (snapshot: CommandSnapshot): snapshot is { kind: "ASSET"; asset_id: string } =>
  snapshot.kind === "ASSET" && typeof snapshot.asset_id === "string";
const isShotSnapshot = (snapshot: CommandSnapshot): snapshot is { kind: "SHOT"; shot_id: string } =>
  snapshot.kind === "SHOT" && typeof snapshot.shot_id === "string";
const isInvalidReferenceSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "INVALID_REFERENCE";
const isInvalidUploadSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "INVALID_UPLOAD";
const isInvalidDeleteSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "INVALID_DELETE";
const isAssetInUseSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "ASSET_IN_USE";
const isPositionConflictSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "POSITION_CONFLICT";

const activeTaskRunStatuses = ["CREATED", "QUEUED", "RUNNING", "PROVIDER_PROCESSING", "DOWNLOADING", "BILLING_PENDING", "BILLING_FAILED", "RETRY_SCHEDULED"] as const;
const activeProductionRunStatuses = ["DRAFT", "PLAN_READY", "CONFIRMED", "GENERATING", "REVIEWING", "RENDERING"] as const;
const activeDocumentConversionStatuses = ["CREATED", "QUEUED", "RUNNING"] as const;

const snapshotReferencesAsset = (snapshot: Record<string, unknown>, assetId: string) => {
  const referenceAssetIds = snapshot.reference_asset_ids;
  if (Array.isArray(referenceAssetIds) && referenceAssetIds.includes(assetId)) return true;
  const visualInput = snapshot.visual_input;
  if (!visualInput || typeof visualInput !== "object") return false;
  const references = (visualInput as { references?: unknown }).references;
  return Array.isArray(references) && references.some((reference) => (
    reference && typeof reference === "object" && (reference as { asset_id?: unknown }).asset_id === assetId
  ));
};

export interface AssetWorkspaceStore {
  findProjectDetail(workspaceId: string, projectId: string): Promise<{
    project: { id: string; workspaceId: string; name: string; status: "ACTIVE" | "ARCHIVED"; createdAt: string; updatedAt: string };
    assets: ControlAsset[];
    shots: ControlShot[];
    referenceBindings: ControlReferenceBinding[];
  } | undefined>;
  findAsset(workspaceId: string, assetId: string): Promise<ControlAsset | undefined>;
  /** Optional internal port used by the server-generated narration worker. */
  ensureGeneratedAudioAsset?(input: GeneratedAudioAssetInput): Promise<ControlAsset | undefined>;
  /** Optional internal port used after Runtime bytes have been measured. */
  completeGeneratedAudioAsset?(input: CompletedAudioAssetInput): Promise<ControlAsset | undefined>;
  listWorkspaceMusicAssets(workspaceId: string): Promise<ControlAsset[]>;
  findShot(workspaceId: string, shotId: string): Promise<ControlShot | undefined>;
  setShotGenerationState(input: { workspaceId: string; shotId: string; status: Extract<ShotStatus, "GENERATING" | "GENERATED" | "FAILED">; selectedAssetId?: string | null }): Promise<ControlShot | undefined>;
  createUploadAsset(input: AssetCommandInput): Promise<AssetCommandExecution<ControlAsset> | AssetCommandConflict | AssetCommandNotFound>;
  confirmAssetUpload(input: ConfirmAssetInput): Promise<AssetCommandExecution<ControlAsset> | AssetCommandConflict | AssetCommandNotFound | AssetCommandInvalidUpload>;
  /** Optional so lightweight test/dedicated stores remain fail-closed when unavailable. */
  updateVisualReferenceAnalysis?(input: UpdateVisualReferenceAnalysisInput): Promise<ControlAsset | undefined>;
  deleteAsset(input: DeleteAssetInput): Promise<AssetCommandExecution<ControlAsset> | AssetCommandConflict | AssetCommandNotFound | AssetCommandInvalidDelete | AssetCommandInUse>;
  createShot(input: CreateShotInput): Promise<AssetCommandExecution<ControlShot> | AssetCommandConflict | AssetCommandNotFound | { kind: "INVALID_REFERENCE" } | AssetCommandPositionConflict>;
  updateShot(input: UpdateShotInput): Promise<AssetCommandExecution<ControlShot> | AssetCommandConflict | AssetCommandNotFound | { kind: "INVALID_REFERENCE" } | AssetCommandPositionConflict>;
}

const commandReservation = async (
  transaction: QueryExecutor,
  input: { scope: string; idempotencyKey: string; requestHash: string },
) => {
  const [reservation] = await transaction
    .insert(commandDeduplications)
    .values({
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      responseSnapshot: {},
    })
    .onConflictDoNothing()
    .returning({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot });

  if (reservation) return { kind: "RESERVED" as const };
  const [existing] = await transaction
    .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
    .from(commandDeduplications)
    .where(commandScope(input.scope, input.idempotencyKey))
    .limit(1);
  if (!existing || isConflict(input.requestHash, existing.requestHash)) return { kind: "CONFLICT" as const };
  if (isNotFoundSnapshot(existing.responseSnapshot)) return { kind: "NOT_FOUND" as const };
  return { kind: "REPLAY" as const, value: existing.responseSnapshot };
};

const storeSnapshot = async (
  transaction: QueryExecutor,
  scope: string,
  idempotencyKey: string,
  responseSnapshot: CommandSnapshot,
) =>
  transaction
    .update(commandDeduplications)
    .set({ responseSnapshot })
    .where(commandScope(scope, idempotencyKey));

const storeNotFound = async (
  transaction: QueryExecutor,
  scope: string,
  idempotencyKey: string,
) => storeSnapshot(transaction, scope, idempotencyKey, { kind: "NOT_FOUND", status: 404 });

const referenceBindingsAreReady = async (
  transaction: QueryExecutor,
  workspaceId: string,
  projectId: string,
  bindings: Array<{ assetId: string }>,
) => {
  if (bindings.length === 0) return true;
  const found = await transaction
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.projectId, projectId),
        eq(assets.status, "READY"),
        inArray(assets.id, bindings.map((binding) => binding.assetId)),
      ),
    );
  return found.length === new Set(bindings.map((binding) => binding.assetId)).size;
};

const replaceReferenceBindings = async (
  transaction: QueryExecutor,
  input: {
    workspaceId: string;
    projectId: string;
    shotId: string;
    bindings: Array<{ assetId: string; role: ReferenceRole; position: number }>;
  },
) => {
  await transaction.delete(referenceBindings).where(and(eq(referenceBindings.workspaceId, input.workspaceId), eq(referenceBindings.shotId, input.shotId)));
  if (input.bindings.length > 0) {
    await transaction.insert(referenceBindings).values(
      input.bindings.map((binding) => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        shotId: input.shotId,
        assetId: binding.assetId,
        role: binding.role,
        position: binding.position,
      })),
    );
  }
};

const serializeShotPosition = (transaction: QueryExecutor, workspaceId: string, projectId: string) =>
  transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId} || ':' || ${projectId}))`);

const shotPositionIsOccupied = async (
  transaction: QueryExecutor,
  workspaceId: string,
  projectId: string,
  position: number,
  excludeShotId?: string,
) => {
  const [occupied] = await transaction
    .select({ id: shots.id })
    .from(shots)
    .where(
      and(
        eq(shots.workspaceId, workspaceId),
        eq(shots.projectId, projectId),
        eq(shots.position, position),
        ...(excludeShotId ? [ne(shots.id, excludeShotId)] : []),
      ),
    )
    .limit(1);
  return Boolean(occupied);
};

const isShotPositionUniqueViolation = (error: unknown) => {
  const source = error as { code?: unknown; constraint?: unknown };
  return source?.code === "23505" && source?.constraint === "shots_project_position_key";
};

export class DrizzleAssetWorkspaceRepository implements AssetWorkspaceStore {
  constructor(private readonly db: PlatformDatabase) {}

  async findProjectDetail(workspaceId: string, projectId: string) {
    const [project] = await this.db.select().from(projects).where(and(projectScope(workspaceId, projectId), ne(projects.status, "DELETED"))).limit(1);
    if (!project || project.status === "DELETED") return undefined;
    const [projectAssets, projectShots] = await Promise.all([
      this.db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), eq(assets.projectId, projectId))).orderBy(asc(assets.createdAt)),
      this.db.select().from(shots).where(and(eq(shots.workspaceId, workspaceId), eq(shots.projectId, projectId))).orderBy(asc(shots.position)),
    ]);
    const bindings = await this.db
      .select()
      .from(referenceBindings)
      .where(and(eq(referenceBindings.workspaceId, workspaceId), eq(referenceBindings.projectId, projectId)))
      .orderBy(asc(referenceBindings.position));
    return {
      project: { ...project, status: project.status as "ACTIVE" | "ARCHIVED" },
      assets: projectAssets,
      shots: projectShots,
      referenceBindings: bindings,
    };
  }

  async findAsset(workspaceId: string, assetId: string) {
    return (await this.db.select().from(assets).where(assetScope(workspaceId, assetId)).limit(1))[0];
  }

  async ensureGeneratedAudioAsset(input: GeneratedAudioAssetInput) {
    if (!input.objectKey.startsWith(`${input.workspaceId}/${input.projectId}/${input.assetId}/`)) {
      throw new Error("Generated audio object key is outside the asset scope.");
    }
    return this.db.transaction(async (transaction) => {
      const [project] = await transaction.select({ id: projects.id }).from(projects).where(and(projectScope(input.workspaceId, input.projectId), ne(projects.status, "DELETED"))).limit(1);
      if (!project) return undefined;
      await transaction.insert(assets).values({
        id: input.assetId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        kind: "AUDIO",
        origin: "GENERATED",
        status: "PENDING_UPLOAD",
        objectKey: input.objectKey,
        metadata: input.metadata,
      }).onConflictDoNothing();
      const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, input.assetId)).limit(1);
      if (!asset || asset.kind !== "AUDIO" || asset.origin !== "GENERATED" || asset.objectKey !== input.objectKey) {
        throw new Error("Generated audio asset identity conflicts with a persisted asset.");
      }
      return asset;
    });
  }

  async completeGeneratedAudioAsset(input: CompletedAudioAssetInput) {
    if (!/^[a-f0-9]{64}$/u.test(input.sha256) || input.byteSize < 1 || input.durationMs < 1 || !/^audio\/[a-z0-9.+-]+$/iu.test(input.mimeType)) {
      throw new Error("Measured generated audio metadata is invalid.");
    }
    const [current] = await this.db.select().from(assets).where(assetScope(input.workspaceId, input.assetId)).limit(1);
    if (!current || current.kind !== "AUDIO" || current.origin !== "GENERATED") return undefined;
    if (current.status === "READY") {
      if (current.sha256 !== input.sha256 || current.mimeType !== input.mimeType || current.byteSize !== input.byteSize || current.durationMs !== input.durationMs) {
        throw new Error("Generated audio asset facts conflict with the persisted asset.");
      }
      return current;
    }
    if (current.status !== "PENDING_UPLOAD") throw new Error("Generated audio asset is not pending completion.");
    const [completed] = await this.db.update(assets).set({
      status: "READY",
      sha256: input.sha256,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      durationMs: input.durationMs,
      metadata: { ...current.metadata, ...(input.metadata ?? {}) },
      updatedAt: new Date().toISOString(),
    }).where(assetScope(input.workspaceId, input.assetId)).returning();
    return completed;
  }

  async listWorkspaceMusicAssets(workspaceId: string) {
    return this.db.select().from(assets).where(and(
      eq(assets.workspaceId, workspaceId),
      eq(assets.kind, "AUDIO"),
      eq(assets.status, "READY"),
      sql`${assets.metadata}->>'audio_role' = 'MUSIC'`,
    )).orderBy(asc(assets.createdAt));
  }

  async findShot(workspaceId: string, shotId: string) {
    return (await this.db.select().from(shots).where(shotScope(workspaceId, shotId)).limit(1))[0];
  }

  async setShotGenerationState(input: { workspaceId: string; shotId: string; status: Extract<ShotStatus, "GENERATING" | "GENERATED" | "FAILED">; selectedAssetId?: string | null }) {
    const [current] = await this.db.select().from(shots).where(shotScope(input.workspaceId, input.shotId)).limit(1);
    if (!current) return undefined;
    const [updated] = await this.db
      .update(shots)
      .set({
        status: input.status,
        ...(input.selectedAssetId === undefined ? {} : { selectedAssetId: input.selectedAssetId }),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(shotScope(input.workspaceId, input.shotId))
      .returning();
    return updated;
  }

  async createUploadAsset(input: AssetCommandInput) {
    return this.db.transaction(async (transaction) => {
      const reservation = await commandReservation(transaction, input);
      if (reservation.kind === "CONFLICT") return reservation;
      if (reservation.kind === "NOT_FOUND") return { kind: "NOT_FOUND", status: 404 } as const;
      if (reservation.kind === "REPLAY") {
        if (!isAssetSnapshot(reservation.value)) return { kind: "CONFLICT" } as const;
        const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, reservation.value.asset_id)).limit(1);
        return asset ? { kind: "REPLAY", value: asset, status: 201 } as const : { kind: "CONFLICT" } as const;
      }

      const [project] = await transaction.select({ id: projects.id }).from(projects).where(and(projectScope(input.workspaceId, input.projectId), ne(projects.status, "DELETED"))).limit(1);
      if (!project) {
        await storeNotFound(transaction, input.scope, input.idempotencyKey);
        return { kind: "NOT_FOUND", status: 404 } as const;
      }
      const [asset] = await transaction
        .insert(assets)
        .values({
          id: input.assetId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          kind: input.kind,
          origin: "USER_UPLOAD",
          status: "PENDING_UPLOAD",
          objectKey: input.objectKey,
          metadata: {
            filename: input.filename,
            requested_mime_type: input.mimeType,
            requested_byte_size: input.byteSize,
            // Never trust caller-supplied audio_role. The route maps a
            // validated purpose to this server-owned field; omitted purpose
            // deliberately leaves AUDIO unclassified for narration/source use.
            ...Object.fromEntries(Object.entries(input.metadata ?? {}).filter(([key]) => key !== "audio_role")),
            ...(input.audioRole ? { audio_role: input.audioRole } : {}),
          },
        })
        .returning();
      await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET", asset_id: asset.id });
      return { kind: "NEW", value: asset, status: 201 } as const;
    });
  }

  async confirmAssetUpload(input: ConfirmAssetInput) {
    return this.db.transaction(async (transaction) => {
      const reservation = await commandReservation(transaction, input);
      if (reservation.kind === "CONFLICT") return reservation;
      if (reservation.kind === "NOT_FOUND") return { kind: "NOT_FOUND", status: 404 } as const;
      if (reservation.kind === "REPLAY") {
        if (isInvalidUploadSnapshot(reservation.value)) return { kind: "INVALID_UPLOAD" } as const;
        if (!isAssetSnapshot(reservation.value)) return { kind: "CONFLICT" } as const;
        const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, reservation.value.asset_id)).limit(1);
        return asset ? { kind: "REPLAY", value: asset, status: 200 } as const : { kind: "CONFLICT" } as const;
      }

      const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, input.assetId)).limit(1);
      if (!asset) {
        await storeNotFound(transaction, input.scope, input.idempotencyKey);
        return { kind: "NOT_FOUND", status: 404 } as const;
      }
      if (asset.status === "PENDING_UPLOAD" && !(await input.verifyUpload(asset))) {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "INVALID_UPLOAD" });
        return { kind: "INVALID_UPLOAD" } as const;
      }
      if (asset.status !== "PENDING_UPLOAD") {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET", asset_id: asset.id });
        return { kind: "NEW", value: asset, status: 200 } as const;
      }
      const [confirmed] = await transaction
        .update(assets)
        .set({
          status: "READY",
          sha256: input.sha256,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        metadata: {
          ...asset.metadata,
          ...(input.metadata ?? {}),
          ...(input.visualAnalysis ? { visual_analysis: input.visualAnalysis } : {}),
          ...(input.visualAnalysisStatus ? { visual_analysis_status: input.visualAnalysisStatus } : {}),
        },
        updatedAt: new Date().toISOString(),
      })
        .where(assetScope(input.workspaceId, input.assetId))
        .returning();
      await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET", asset_id: confirmed.id });
      return { kind: "NEW", value: confirmed, status: 200 } as const;
    });
  }

  async updateVisualReferenceAnalysis(input: UpdateVisualReferenceAnalysisInput) {
    return this.db.transaction(async (transaction) => {
      const scope = and(
        assetScope(input.workspaceId, input.assetId),
        eq(assets.projectId, input.projectId),
        eq(assets.kind, "IMAGE"),
        eq(assets.origin, "USER_UPLOAD"),
        eq(assets.status, "READY"),
      );
      const [current] = await transaction.select().from(assets).where(scope).limit(1);
      if (!current) return undefined;
      const [updated] = await transaction
        .update(assets)
        .set({
          metadata: {
            ...current.metadata,
            ...(input.visualAnalysis ? { visual_analysis: input.visualAnalysis } : {}),
            visual_analysis_status: input.visualAnalysisStatus,
          },
          updatedAt: new Date().toISOString(),
        })
        .where(scope)
        .returning();
      return updated;
    });
  }

  async deleteAsset(input: DeleteAssetInput) {
    return this.db.transaction(async (transaction) => {
      const reservation = await commandReservation(transaction, input);
      if (reservation.kind === "CONFLICT") return reservation;
      if (reservation.kind === "NOT_FOUND") return { kind: "NOT_FOUND", status: 404 } as const;
      if (reservation.kind === "REPLAY") {
        if (isInvalidDeleteSnapshot(reservation.value)) return { kind: "INVALID_DELETE" } as const;
        if (isAssetInUseSnapshot(reservation.value)) return { kind: "ASSET_IN_USE" } as const;
        if (!isAssetSnapshot(reservation.value)) return { kind: "CONFLICT" } as const;
        const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, reservation.value.asset_id)).limit(1);
        return asset ? { kind: "REPLAY", value: asset, status: 200 } as const : { kind: "CONFLICT" } as const;
      }

      const [asset] = await transaction.select().from(assets).where(assetScope(input.workspaceId, input.assetId)).limit(1);
      if (!asset) {
        await storeNotFound(transaction, input.scope, input.idempotencyKey);
        return { kind: "NOT_FOUND", status: 404 } as const;
      }
      if (asset.origin !== "USER_UPLOAD") {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "INVALID_DELETE" });
        return { kind: "INVALID_DELETE" } as const;
      }
      if (asset.status === "DELETED") {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET", asset_id: asset.id });
        return { kind: "NEW", value: asset, status: 200 } as const;
      }
      if (await this.assetIsInUse(transaction, input.workspaceId, asset.projectId, input.assetId)) {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET_IN_USE" });
        return { kind: "ASSET_IN_USE" } as const;
      }
      const [deleted] = await transaction.update(assets)
        .set({ status: "DELETED", updatedAt: new Date().toISOString() })
        .where(assetScope(input.workspaceId, input.assetId))
        .returning();
      await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET", asset_id: deleted.id });
      return { kind: "NEW", value: deleted, status: 200 } as const;
    });
  }

  private async assetIsInUse(transaction: QueryExecutor, workspaceId: string, projectId: string, assetId: string) {
    const [activeProduction] = await transaction
      .select({ id: productionRuns.id })
      .from(productionRuns)
      .where(and(
        eq(productionRuns.workspaceId, workspaceId),
        eq(productionRuns.projectId, projectId),
        inArray(productionRuns.status, activeProductionRunStatuses),
      ))
      .limit(1);
    if (activeProduction) return true;

    const activeTaskSnapshots = await transaction
      .select({ inputSnapshot: taskRuns.inputSnapshot })
      .from(taskRuns)
      .where(and(
        eq(taskRuns.workspaceId, workspaceId),
        eq(taskRuns.projectId, projectId),
        inArray(taskRuns.status, activeTaskRunStatuses),
      ));
    if (activeTaskSnapshots.some(({ inputSnapshot }) => snapshotReferencesAsset(inputSnapshot, assetId))) return true;

    const retryableFailedSnapshots = await transaction
      .select({ inputSnapshot: taskRuns.inputSnapshot })
      .from(productionSegments)
      .innerJoin(taskRuns, and(
        eq(taskRuns.workspaceId, productionSegments.workspaceId),
        eq(taskRuns.projectId, productionSegments.projectId),
        eq(taskRuns.id, productionSegments.taskRunId),
      ))
      .where(and(
        eq(productionSegments.workspaceId, workspaceId),
        eq(productionSegments.projectId, projectId),
        eq(productionSegments.status, "FAILED"),
        eq(productionSegments.retryable, true),
      ));
    if (retryableFailedSnapshots.some(({ inputSnapshot }) => snapshotReferencesAsset(inputSnapshot, assetId))) return true;

    const [activeConversion] = await transaction
      .select({ id: documentConversions.id })
      .from(documentConversions)
      .where(and(
        eq(documentConversions.workspaceId, workspaceId),
        eq(documentConversions.projectId, projectId),
        eq(documentConversions.sourceAssetId, assetId),
        inArray(documentConversions.status, activeDocumentConversionStatuses),
      ))
      .limit(1);
    return Boolean(activeConversion);
  }

  async createShot(input: CreateShotInput) {
    return this.db.transaction(async (transaction) => {
      const reservation = await commandReservation(transaction, input);
      if (reservation.kind === "CONFLICT") return reservation;
      if (reservation.kind === "NOT_FOUND") return { kind: "NOT_FOUND", status: 404 } as const;
      if (reservation.kind === "REPLAY") {
        if (isInvalidReferenceSnapshot(reservation.value)) return { kind: "INVALID_REFERENCE" } as const;
        if (isPositionConflictSnapshot(reservation.value)) return { kind: "POSITION_CONFLICT" } as const;
        if (!isShotSnapshot(reservation.value)) return { kind: "CONFLICT" } as const;
        const [shot] = await transaction.select().from(shots).where(shotScope(input.workspaceId, reservation.value.shot_id)).limit(1);
        return shot ? { kind: "REPLAY", value: shot, status: 201 } as const : { kind: "CONFLICT" } as const;
      }
      const [project] = await transaction.select({ id: projects.id }).from(projects).where(and(projectScope(input.workspaceId, input.projectId), ne(projects.status, "DELETED"))).limit(1);
      if (!project) {
        await storeNotFound(transaction, input.scope, input.idempotencyKey);
        return { kind: "NOT_FOUND", status: 404 } as const;
      }
      if (!(await referenceBindingsAreReady(transaction, input.workspaceId, input.projectId, input.referenceBindings))) {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "INVALID_REFERENCE" });
        return { kind: "INVALID_REFERENCE" } as const;
      }
      await serializeShotPosition(transaction, input.workspaceId, input.projectId);
      if (await shotPositionIsOccupied(transaction, input.workspaceId, input.projectId, input.position)) {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "POSITION_CONFLICT" });
        return { kind: "POSITION_CONFLICT" } as const;
      }
      let shot;
      const insertResult = await transaction.transaction(async (savepoint) => {
        try {
          const [created] = await savepoint
            .insert(shots)
            .values({
              id: input.shotId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              position: input.position,
              prompt: input.prompt,
              model: input.model,
              generationSettings: input.generationSettings,
              status: "DRAFT",
            })
            .returning();
          return { kind: "CREATED" as const, value: created };
        } catch (error) {
          if (!isShotPositionUniqueViolation(error)) throw error;
          return { kind: "POSITION_CONFLICT" as const };
        }
      });
      if (insertResult.kind === "POSITION_CONFLICT") {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "POSITION_CONFLICT" });
        return { kind: "POSITION_CONFLICT" } as const;
      }
      shot = insertResult.value;
      await replaceReferenceBindings(transaction, { ...input, bindings: input.referenceBindings });
      await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "SHOT", shot_id: shot.id });
      return { kind: "NEW", value: shot, status: 201 } as const;
    });
  }

  async updateShot(input: UpdateShotInput) {
    return this.db.transaction(async (transaction) => {
      const reservation = await commandReservation(transaction, input);
      if (reservation.kind === "CONFLICT") return reservation;
      if (reservation.kind === "NOT_FOUND") return { kind: "NOT_FOUND", status: 404 } as const;
      if (reservation.kind === "REPLAY") {
        if (isInvalidReferenceSnapshot(reservation.value)) return { kind: "INVALID_REFERENCE" } as const;
        if (isPositionConflictSnapshot(reservation.value)) return { kind: "POSITION_CONFLICT" } as const;
        if (!isShotSnapshot(reservation.value)) return { kind: "CONFLICT" } as const;
        const [shot] = await transaction.select().from(shots).where(shotScope(input.workspaceId, reservation.value.shot_id)).limit(1);
        return shot ? { kind: "REPLAY", value: shot, status: 200 } as const : { kind: "CONFLICT" } as const;
      }
      const [current] = await transaction.select().from(shots).where(shotScope(input.workspaceId, input.shotId)).limit(1);
      if (!current) {
        await storeNotFound(transaction, input.scope, input.idempotencyKey);
        return { kind: "NOT_FOUND", status: 404 } as const;
      }
      if (input.referenceBindings && !(await referenceBindingsAreReady(transaction, input.workspaceId, current.projectId, input.referenceBindings))) {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "INVALID_REFERENCE" });
        return { kind: "INVALID_REFERENCE" } as const;
      }
      if (input.selectedAssetId) {
        const [selectedAsset] = await transaction
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.projectId, current.projectId), eq(assets.id, input.selectedAssetId), eq(assets.status, "READY")))
          .limit(1);
        if (!selectedAsset) {
          await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "INVALID_REFERENCE" });
          return { kind: "INVALID_REFERENCE" } as const;
        }
      }
      if (input.position !== undefined) {
        await serializeShotPosition(transaction, input.workspaceId, current.projectId);
        if (await shotPositionIsOccupied(transaction, input.workspaceId, current.projectId, input.position, current.id)) {
          await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "POSITION_CONFLICT" });
          return { kind: "POSITION_CONFLICT" } as const;
        }
      }
      let updated;
      const updateResult = await transaction.transaction(async (savepoint) => {
        try {
          const [changed] = await savepoint
            .update(shots)
            .set({
              ...(input.position === undefined ? {} : { position: input.position }),
              ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
              ...(input.model === undefined ? {} : { model: input.model }),
              ...(input.generationSettings === undefined ? {} : { generationSettings: input.generationSettings }),
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.selectedAssetId === undefined ? {} : { selectedAssetId: input.selectedAssetId }),
              revision: current.revision + 1,
              updatedAt: new Date().toISOString(),
            })
            .where(shotScope(input.workspaceId, input.shotId))
            .returning();
          return { kind: "UPDATED" as const, value: changed };
        } catch (error) {
          if (!isShotPositionUniqueViolation(error)) throw error;
          return { kind: "POSITION_CONFLICT" as const };
        }
      });
      if (updateResult.kind === "POSITION_CONFLICT") {
        await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "POSITION_CONFLICT" });
        return { kind: "POSITION_CONFLICT" } as const;
      }
      updated = updateResult.value;
      if (input.referenceBindings) {
        await replaceReferenceBindings(transaction, {
          workspaceId: input.workspaceId,
          projectId: current.projectId,
          shotId: current.id,
          bindings: input.referenceBindings,
        });
      }
      await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "SHOT", shot_id: updated.id });
      return { kind: "NEW", value: updated, status: 200 } as const;
    });
  }
}
