import type {
  AssetCommandInput,
  AssetWorkspaceStore,
  ConfirmAssetInput,
  ControlAsset,
  ControlReferenceBinding,
  ControlShot,
  CreateShotInput,
  UpdateShotInput,
} from "@alchemy-video/persistence";

import type { ControlPlaneStore } from "@alchemy-video/persistence";

type StoredCommand = { hash: string; assetId?: string; shot?: ControlShot; invalidReference?: boolean; invalidUpload?: boolean; positionConflict?: boolean; notFound?: boolean; status: 200 | 201 | 404 };

export class InMemoryAssetWorkspaceStore implements AssetWorkspaceStore {
  private readonly assets = new Map<string, ControlAsset>();
  private readonly shots = new Map<string, ControlShot>();
  private readonly bindings = new Map<string, ControlReferenceBinding[]>();
  private readonly commands = new Map<string, StoredCommand>();

  constructor(private readonly control: ControlPlaneStore) {}

  async findProjectDetail(workspaceId: string, projectId: string) {
    const project = await this.control.findProject(workspaceId, projectId);
    if (!project) return undefined;
    const shots = [...this.shots.values()].filter((value) => value.workspaceId === workspaceId && value.projectId === projectId).sort((a, b) => a.position - b.position);
    const assets = [...this.assets.values()].filter((value) => value.workspaceId === workspaceId && value.projectId === projectId);
    return { project, assets, shots, referenceBindings: shots.flatMap((shot) => this.bindings.get(shot.id) ?? []) };
  }

  async findAsset(workspaceId: string, assetId: string) {
    const asset = this.assets.get(assetId);
    return asset?.workspaceId === workspaceId ? asset : undefined;
  }

  async createUploadAsset(input: AssetCommandInput) {
    const replay = this.replayUploadAsset(input, 201);
    if (replay) return replay;
    if (!(await this.control.findProject(input.workspaceId, input.projectId))) {
      this.storeNotFound(input);
      return { kind: "NOT_FOUND", status: 404 } as const;
    }
    const now = new Date().toISOString();
    const asset: ControlAsset = { id: input.assetId, workspaceId: input.workspaceId, projectId: input.projectId, kind: input.kind, origin: "USER_UPLOAD", status: "PENDING_UPLOAD", objectKey: input.objectKey, sha256: null, mimeType: null, byteSize: null, width: null, height: null, durationMs: null, metadata: { filename: input.filename, requested_mime_type: input.mimeType, requested_byte_size: input.byteSize }, createdAt: now, updatedAt: now };
    this.assets.set(asset.id, asset);
    this.storeAsset(input, asset.id, 201);
    return { kind: "NEW", value: asset, status: 201 } as const;
  }

  async confirmAssetUpload(input: ConfirmAssetInput) {
    const replay = this.replayConfirmationAsset(input, 200);
    if (replay) return replay;
    const current = await this.findAsset(input.workspaceId, input.assetId);
    if (!current) {
      this.storeNotFound(input);
      return { kind: "NOT_FOUND", status: 404 } as const;
    }
    if (current.status === "PENDING_UPLOAD" && !(await input.verifyUpload(current))) {
      this.storeInvalidUpload(input);
      return { kind: "INVALID_UPLOAD" } as const;
    }
    const asset = current.status === "PENDING_UPLOAD" ? { ...current, status: "READY" as const, sha256: input.sha256, mimeType: input.mimeType, byteSize: input.byteSize, width: input.width ?? null, height: input.height ?? null, durationMs: input.durationMs ?? null, updatedAt: new Date().toISOString() } : current;
    this.assets.set(asset.id, asset);
    this.storeAsset(input, asset.id, 200);
    return { kind: "NEW", value: asset, status: 200 } as const;
  }

  async createShot(input: CreateShotInput) {
    const replay = this.replayShot(input, 201);
    if (replay) return replay;
    if (!(await this.control.findProject(input.workspaceId, input.projectId))) {
      this.storeNotFound(input);
      return { kind: "NOT_FOUND", status: 404 } as const;
    }
    if (!this.referencesReady(input.workspaceId, input.projectId, input.referenceBindings)) {
      this.storeInvalidReference(input);
      return { kind: "INVALID_REFERENCE" } as const;
    }
    if (this.positionOccupied(input.workspaceId, input.projectId, input.position)) {
      this.storePositionConflict(input);
      return { kind: "POSITION_CONFLICT" } as const;
    }
    const now = new Date().toISOString();
    const shot: ControlShot = { id: input.shotId, workspaceId: input.workspaceId, projectId: input.projectId, position: input.position, prompt: input.prompt, model: input.model, generationSettings: input.generationSettings, status: "DRAFT", selectedAssetId: null, revision: 1, createdAt: now, updatedAt: now };
    this.shots.set(shot.id, shot);
    this.replaceBindings(shot, input.referenceBindings);
    this.storeShot(input, shot, 201);
    return { kind: "NEW", value: shot, status: 201 } as const;
  }

  async updateShot(input: UpdateShotInput) {
    const replay = this.replayShot(input, 200);
    if (replay) return replay;
    const current = this.shots.get(input.shotId);
    if (!current || current.workspaceId !== input.workspaceId) {
      this.storeNotFound(input);
      return { kind: "NOT_FOUND", status: 404 } as const;
    }
    if (input.referenceBindings && !this.referencesReady(input.workspaceId, current.projectId, input.referenceBindings)) {
      this.storeInvalidReference(input);
      return { kind: "INVALID_REFERENCE" } as const;
    }
    if (input.selectedAssetId && !this.referencesReady(input.workspaceId, current.projectId, [{ assetId: input.selectedAssetId }])) {
      this.storeInvalidReference(input);
      return { kind: "INVALID_REFERENCE" } as const;
    }
    if (input.position !== undefined && this.positionOccupied(input.workspaceId, current.projectId, input.position, current.id)) {
      this.storePositionConflict(input);
      return { kind: "POSITION_CONFLICT" } as const;
    }
    const shot: ControlShot = { ...current, ...(input.position === undefined ? {} : { position: input.position }), ...(input.prompt === undefined ? {} : { prompt: input.prompt }), ...(input.model === undefined ? {} : { model: input.model }), ...(input.generationSettings === undefined ? {} : { generationSettings: input.generationSettings }), ...(input.status === undefined ? {} : { status: input.status }), ...(input.selectedAssetId === undefined ? {} : { selectedAssetId: input.selectedAssetId }), revision: current.revision + 1, updatedAt: new Date().toISOString() };
    this.shots.set(shot.id, shot);
    if (input.referenceBindings) this.replaceBindings(shot, input.referenceBindings);
    this.storeShot(input, shot, 200);
    return { kind: "NEW", value: shot, status: 200 } as const;
  }

  private key(input: { scope: string; idempotencyKey: string }) { return `${input.scope}:${input.idempotencyKey}`; }
  private replayUploadAsset(input: { scope: string; idempotencyKey: string; requestHash: string }, status: 201) {
    const existing = this.commands.get(this.key(input));
    if (!existing) return undefined;
    if (existing.hash !== input.requestHash) return { kind: "CONFLICT" } as const;
    if (existing.notFound) return { kind: "NOT_FOUND", status: 404 } as const;
    if (!existing.assetId) return { kind: "CONFLICT" } as const;
    const asset = this.assets.get(existing.assetId);
    return asset ? { kind: "REPLAY", value: asset, status } as const : { kind: "CONFLICT" } as const;
  }
  private replayConfirmationAsset(input: { scope: string; idempotencyKey: string; requestHash: string }, status: 200) {
    const existing = this.commands.get(this.key(input));
    if (!existing) return undefined;
    if (existing.hash !== input.requestHash) return { kind: "CONFLICT" } as const;
    if (existing.notFound) return { kind: "NOT_FOUND", status: 404 } as const;
    if (existing.invalidUpload) return { kind: "INVALID_UPLOAD" } as const;
    if (!existing.assetId) return { kind: "CONFLICT" } as const;
    const asset = this.assets.get(existing.assetId);
    return asset ? { kind: "REPLAY", value: asset, status } as const : { kind: "CONFLICT" } as const;
  }
  private replayShot(input: { scope: string; idempotencyKey: string; requestHash: string }, status: 200 | 201) {
    const existing = this.commands.get(this.key(input));
    if (!existing) return undefined;
    if (existing.hash !== input.requestHash) return { kind: "CONFLICT" } as const;
    if (existing.notFound) return { kind: "NOT_FOUND", status: 404 } as const;
    if (existing.invalidReference) return { kind: "INVALID_REFERENCE" } as const;
    if (existing.positionConflict) return { kind: "POSITION_CONFLICT" } as const;
    return existing.shot ? { kind: "REPLAY", value: existing.shot, status } as const : { kind: "CONFLICT" } as const;
  }
  private storeAsset(input: { scope: string; idempotencyKey: string; requestHash: string }, assetId: string, status: 200 | 201) { this.commands.set(this.key(input), { hash: input.requestHash, assetId, status }); }
  private storeShot(input: { scope: string; idempotencyKey: string; requestHash: string }, shot: ControlShot, status: 200 | 201) { this.commands.set(this.key(input), { hash: input.requestHash, shot, status }); }
  private storeInvalidReference(input: { scope: string; idempotencyKey: string; requestHash: string }) { this.commands.set(this.key(input), { hash: input.requestHash, invalidReference: true, status: 200 }); }
  private storeInvalidUpload(input: { scope: string; idempotencyKey: string; requestHash: string }) { this.commands.set(this.key(input), { hash: input.requestHash, invalidUpload: true, status: 200 }); }
  private storePositionConflict(input: { scope: string; idempotencyKey: string; requestHash: string }) { this.commands.set(this.key(input), { hash: input.requestHash, positionConflict: true, status: 200 }); }
  private storeNotFound(input: { scope: string; idempotencyKey: string; requestHash: string }) { this.commands.set(this.key(input), { hash: input.requestHash, notFound: true, status: 404 }); }
  private referencesReady(workspaceId: string, projectId: string, bindings: Array<{ assetId: string }>) { return bindings.every(({ assetId }) => { const asset = this.assets.get(assetId); return asset?.workspaceId === workspaceId && asset.projectId === projectId && asset.status === "READY"; }); }
  private positionOccupied(workspaceId: string, projectId: string, position: number, excludeShotId?: string) { return [...this.shots.values()].some((shot) => shot.workspaceId === workspaceId && shot.projectId === projectId && shot.position === position && shot.id !== excludeShotId); }
  private replaceBindings(shot: ControlShot, bindings: CreateShotInput["referenceBindings"]) { this.bindings.set(shot.id, bindings.map((binding) => ({ shotId: shot.id, assetId: binding.assetId, role: binding.role, position: binding.position, createdAt: shot.updatedAt }))); }
}

export const createInMemoryAssetWorkspaceStore = (control: ControlPlaneStore) => new InMemoryAssetWorkspaceStore(control);
