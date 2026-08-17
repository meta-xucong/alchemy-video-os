import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type ReferenceDeliveryClaim = Readonly<{
  workspaceId: string;
  projectId: string;
  assetId: string;
  sha256: string;
  mimeType: string;
  expiresAt: string;
}>;

type EncryptedReferenceDeliveryClaim = Readonly<{
  version: 1;
  workspace_id: string;
  project_id: string;
  asset_id: string;
  sha256: string;
  mime_type: string;
  expires_at: string;
}>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64url = (value: Uint8Array) => Buffer.from(value).toString("base64url");
const fromBase64url = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));
const supportedImageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);

const parseOrigin = (value: string) => {
  const origin = new URL(value);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("REFERENCE_DELIVERY_ORIGIN must be an HTTPS origin without credentials, query, or fragment.");
  }
  return origin;
};

const keyFor = (secret: string) => {
  if (secret.length < 32) throw new Error("REFERENCE_DELIVERY_SIGNING_KEY must be at least 32 characters.");
  return createHash("sha256").update(secret, "utf8").digest();
};

const isClaim = (value: unknown): value is EncryptedReferenceDeliveryClaim => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  return claim.version === 1
    && typeof claim.workspace_id === "string" && claim.workspace_id.startsWith("ws_")
    && typeof claim.project_id === "string" && claim.project_id.startsWith("prj_")
    && typeof claim.asset_id === "string" && claim.asset_id.startsWith("ast_")
    && typeof claim.sha256 === "string" && /^[a-f0-9]{64}$/i.test(claim.sha256)
    && typeof claim.mime_type === "string" && supportedImageMimes.has(claim.mime_type)
    && typeof claim.expires_at === "string" && Number.isFinite(Date.parse(claim.expires_at));
};

export class ReferenceDeliveryTokenCodec {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = keyFor(secret);
  }

  issue(input: Readonly<{
    workspaceId: string;
    projectId: string;
    assetId: string;
    sha256: string;
    mimeType: string;
    expiresAt: Date;
  }>) {
    if (!supportedImageMimes.has(input.mimeType)) throw new Error("Reference delivery supports JPEG, PNG, and WebP images only.");
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) throw new Error("Reference delivery requires a SHA-256 asset hash.");
    if (!Number.isFinite(input.expiresAt.getTime())) throw new Error("Reference delivery expiry is invalid.");
    const payload: EncryptedReferenceDeliveryClaim = {
      version: 1,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      asset_id: input.assetId,
      sha256: input.sha256.toLowerCase(),
      mime_type: input.mimeType,
      expires_at: input.expiresAt.toISOString(),
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(encoder.encode(JSON.stringify(payload))), cipher.final()]);
    return `v1.${base64url(iv)}.${base64url(ciphertext)}.${base64url(cipher.getAuthTag())}`;
  }

  verify(token: string, now = new Date()): ReferenceDeliveryClaim | undefined {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.some((part) => !part)) return undefined;
    try {
      const iv = fromBase64url(parts[1]!);
      const ciphertext = fromBase64url(parts[2]!);
      const tag = fromBase64url(parts[3]!);
      if (iv.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength === 0) return undefined;
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed: unknown = JSON.parse(decoder.decode(decoded));
      if (!isClaim(parsed)) return undefined;
      if (Date.parse(parsed.expires_at) <= now.getTime()) return undefined;
      return {
        workspaceId: parsed.workspace_id,
        projectId: parsed.project_id,
        assetId: parsed.asset_id,
        sha256: parsed.sha256,
        mimeType: parsed.mime_type,
        expiresAt: parsed.expires_at,
      };
    } catch {
      return undefined;
    }
  }
}

export const createReferenceDeliveryUrl = (input: Readonly<{ origin: string; token: string }>) => {
  const origin = parseOrigin(input.origin);
  const base = origin.pathname.endsWith("/") ? origin : new URL(`${origin.pathname}/`, origin);
  const url = new URL(`provider-input/${encodeURIComponent(input.token)}`, base);
  return url.toString();
};
