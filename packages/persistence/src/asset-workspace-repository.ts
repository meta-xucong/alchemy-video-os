import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { PlatformDatabase } from "./db.js";
import { assets, commandDeduplications, projects, referenceBindings, shots } from "./schema.js";
import { assetScope, projectScope, shotScope } from "./workspace-repositories.js";

export type AssetKind = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "POSTER" | "THUMBNAIL";
export type AssetStatus = "PENDING_UPLOAD" | "READY" | "FAILED" | "DELETED";
export type ShotStatus = "DRAFT" | "READY" | "GENERATING" | "GENERATED" | "FAILED" | "ARCHIVED";
export type ReferenceRole = "STYLE" | "SUBJECT" | "FIRST_FRAME" | "LAST_FRAME";

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
  verifyUpload: (asset: ControlAsset) => Promise<boolean>;
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
const isPositionConflictSnapshot = (snapshot: CommandSnapshot) => snapshot.kind === "POSITION_CONFLICT";

export interface AssetWorkspaceStore {
  findProjectDetail(workspaceId: string, projectId: string): Promise<{
    project: { id: string; workspaceId: string; name: string; status: "ACTIVE" | "ARCHIVED"; createdAt: string; updatedAt: string };
    assets: ControlAsset[];
    shots: ControlShot[];
    referenceBindings: ControlReferenceBinding[];
  } | undefined>;
  findAsset(workspaceId: string, assetId: string): Promise<ControlAsset | undefined>;
  findShot(workspaceId: string, shotId: string): Promise<ControlShot | undefined>;
  setShotGenerationState(input: { workspaceId: string; shotId: string; status: Extract<ShotStatus, "GENERATING" | "GENERATED" | "FAILED">; selectedAssetId?: string | null }): Promise<ControlShot | undefined>;
  createUploadAsset(input: AssetCommandInput): Promise<AssetCommandExecution<ControlAsset> | AssetCommandConflict | AssetCommandNotFound>;
  confirmAssetUpload(input: ConfirmAssetInput): Promise<AssetCommandExecution<ControlAsset> | AssetCommandConflict | AssetCommandNotFound | AssetCommandInvalidUpload>;
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
    const [project] = await this.db.select().from(projects).where(projectScope(workspaceId, projectId)).limit(1);
    if (!project) return undefined;
    const [projectAssets, projectShots] = await Promise.all([
      this.db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), eq(assets.projectId, projectId))).orderBy(asc(assets.createdAt)),
      this.db.select().from(shots).where(and(eq(shots.workspaceId, workspaceId), eq(shots.projectId, projectId))).orderBy(asc(shots.position)),
    ]);
    const bindings = await this.db
      .select()
      .from(referenceBindings)
      .where(and(eq(referenceBindings.workspaceId, workspaceId), eq(referenceBindings.projectId, projectId)))
      .orderBy(asc(referenceBindings.position));
    return { project, assets: projectAssets, shots: projectShots, referenceBindings: bindings };
  }

  async findAsset(workspaceId: string, assetId: string) {
    return (await this.db.select().from(assets).where(assetScope(workspaceId, assetId)).limit(1))[0];
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

      const [project] = await transaction.select({ id: projects.id }).from(projects).where(projectScope(input.workspaceId, input.projectId)).limit(1);
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
          metadata: { filename: input.filename, requested_mime_type: input.mimeType, requested_byte_size: input.byteSize },
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
          updatedAt: new Date().toISOString(),
        })
        .where(assetScope(input.workspaceId, input.assetId))
        .returning();
      await storeSnapshot(transaction, input.scope, input.idempotencyKey, { kind: "ASSET", asset_id: confirmed.id });
      return { kind: "NEW", value: confirmed, status: 200 } as const;
    });
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
      const [project] = await transaction.select({ id: projects.id }).from(projects).where(projectScope(input.workspaceId, input.projectId)).limit(1);
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
