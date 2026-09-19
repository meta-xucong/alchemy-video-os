import { createHash } from "node:crypto";

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const DEFAULT_URL_TTL_SECONDS = 10 * 60;
const DEFAULT_BROWSER_ORIGINS = ["http://127.0.0.1:3031", "http://localhost:3031"];

export type ObjectInspection = {
  mimeType: string;
  byteSize: number;
  sha256: string;
};

/**
 * The metadata-only view used by the provider-input HEAD relay.  The full
 * ObjectInspection remains the integrity boundary for upload confirmation and
 * other callers that need a computed SHA-256.
 */
export type ObjectMetadataInspection = Pick<ObjectInspection, "mimeType" | "byteSize">;

export type SignedUpload = {
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type SignedDownload = {
  downloadUrl: string;
  expiresAt: string;
};

export type StorageObjectStream = {
  mimeType: string;
  byteSize?: number;
  stream: ReadableStream<Uint8Array>;
};

export interface StoragePort {
  createUploadUrl(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds?: number;
  }): Promise<SignedUpload>;
  inspectObject(input: { objectKey: string; signal?: AbortSignal }): Promise<ObjectInspection | undefined>;
  putObject(input: { objectKey: string; mimeType: string; bytes: Uint8Array; ifNoneMatch?: "*" }): Promise<void>;
  createDownloadUrl(input: { objectKey: string; expiresInSeconds?: number }): Promise<SignedDownload>;
  readObject(input: { objectKey: string }): Promise<StorageObjectStream | undefined>;
}

export type S3StorageConfig = {
  endpoint: string;
  /**
   * Public S3 endpoint used only when signing browser upload/download URLs.
   * Server-side reads and writes continue to use endpoint on the private network.
   */
  publicEndpoint?: string;
  /** Browser origins allowed to use upload/download URLs. Defaults to local Studio origins. */
  browserOrigins?: readonly string[];
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type StorageDiagnostic = {
  name: string;
  code?: string;
  httpStatusCode?: number;
};

export class StorageUnavailableError extends Error {
  constructor(message = "Object storage is unavailable.", readonly diagnostic?: StorageDiagnostic) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export const storageDiagnostic = (error: unknown): StorageDiagnostic => {
  const source = error as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return {
    name: typeof source?.name === "string" ? source.name : "UnknownStorageError",
    ...(typeof source?.Code === "string" ? { code: source.Code } : typeof source?.code === "string" ? { code: source.code } : {}),
    ...(typeof source?.$metadata?.httpStatusCode === "number" ? { httpStatusCode: source.$metadata.httpStatusCode } : {}),
  };
};

const isMinioCorsNotImplemented = (error: unknown) => {
  const diagnostic = storageDiagnostic(error);
  return diagnostic.name === "NotImplemented" && diagnostic.code === "NotImplemented" && diagnostic.httpStatusCode === 501;
};

export class StorageObjectAlreadyExistsError extends Error {
  constructor(message = "The object already exists and cannot be overwritten.") {
    super(message);
    this.name = "StorageObjectAlreadyExistsError";
  }
}

const expiresAt = (expiresInSeconds: number) =>
  new Date(Date.now() + expiresInSeconds * 1000).toISOString();

const safeFilenameExtension = (filename: string) => {
  const extension = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
  return extension;
};

const extensionForMimeType = (mimeType: string) => {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "text/markdown": "md",
    "text/plain": "txt",
  };
  return extensions[mimeType.toLowerCase()];
};

export const createAssetObjectKey = (input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  filename: string;
  mimeType: string;
}) => {
  const extension = extensionForMimeType(input.mimeType) ?? safeFilenameExtension(input.filename);
  if (!extension) {
    throw new StorageUnavailableError("The requested upload MIME type has no safe file extension.");
  }
  return `${input.workspaceId}/${input.projectId}/${input.assetId}/original.${extension}`;
};

export const createGeneratedVideoObjectKey = (input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}) => `${input.workspaceId}/${input.projectId}/${input.assetId}/generated.mp4`;

export const createHandoffFrameObjectKey = (input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}) => `${input.workspaceId}/${input.projectId}/${input.assetId}/handoff.png`;

export const createComposedVideoObjectKey = (input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}) => `${input.workspaceId}/${input.projectId}/${input.assetId}/composed.mp4`;

export const createDocumentMarkdownObjectKey = (input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}) => `${input.workspaceId}/${input.projectId}/${input.assetId}/document.md`;

const asAsyncIterable = (body: unknown): AsyncIterable<Uint8Array> => {
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") {
    throw new StorageUnavailableError("Object storage returned an unreadable object body.");
  }
  return body as AsyncIterable<Uint8Array>;
};

const closeObjectBody = async (body: unknown) => {
  if (!body || typeof body !== "object") return;
  const candidate = body as {
    cancel?: () => Promise<void> | void;
    destroy?: () => void;
  };
  if (typeof candidate.cancel === "function") {
    await candidate.cancel();
    return;
  }
  candidate.destroy?.();
};

const asReadableStream = (body: unknown): ReadableStream<Uint8Array> => {
  if (body && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
    return (body as { transformToWebStream(): ReadableStream<Uint8Array> }).transformToWebStream();
  }
  const iterator = asAsyncIterable(body)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(new Uint8Array(next.value));
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      try {
        await iterator.return?.();
      } finally {
        await closeObjectBody(body).catch(() => undefined);
      }
    },
  });
};

export class S3StoragePort implements StoragePort {
  private bucketInitialization?: Promise<void>;

  constructor(
    private readonly client: S3Client,
    private readonly signingClient: S3Client,
    private readonly bucket: string,
    private readonly browserOrigins: readonly string[],
  ) {}

  async createUploadUrl(input: { objectKey: string; mimeType: string; expiresInSeconds?: number }) {
    await this.ensureBucket();
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS;
    try {
      return {
        uploadUrl: await getSignedUrl(
          this.signingClient,
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: input.objectKey,
            ContentType: input.mimeType,
            IfNoneMatch: "*",
          }),
          { expiresIn: expiresInSeconds },
        ),
        headers: { "Content-Type": input.mimeType, "If-None-Match": "*" },
        expiresAt: expiresAt(expiresInSeconds),
      };
    } catch (error) {
      throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
    }
  }

  async inspectObject(input: { objectKey: string; signal?: AbortSignal }): Promise<ObjectInspection | undefined> {
    await this.ensureBucket();
    try {
      const requestOptions = input.signal ? { abortSignal: input.signal } : undefined;
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.objectKey }), requestOptions);
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }), requestOptions);
      const hash = createHash("sha256");
      let byteSize = 0;
      try {
        for await (const chunk of asAsyncIterable(object.Body)) {
          const value = Buffer.from(chunk);
          hash.update(value);
          byteSize += value.length;
        }
      } finally {
        await closeObjectBody(object.Body).catch(() => undefined);
      }
      return {
        mimeType: head.ContentType ?? object.ContentType ?? "application/octet-stream",
        byteSize: head.ContentLength ?? byteSize,
        sha256: hash.digest("hex"),
      };
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) {
        return undefined;
      }
      throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
    }
  }

  async inspectObjectMetadata(input: { objectKey: string; signal?: AbortSignal }): Promise<ObjectMetadataInspection | undefined> {
    await this.ensureBucket();
    try {
      const requestOptions = input.signal ? { abortSignal: input.signal } : undefined;
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.objectKey }), requestOptions);
      if (typeof head.ContentLength !== "number" || !Number.isSafeInteger(head.ContentLength) || head.ContentLength < 1) return undefined;
      return {
        mimeType: head.ContentType ?? "application/octet-stream",
        byteSize: head.ContentLength,
      };
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) {
        return undefined;
      }
      throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
    }
  }

  async putObject(input: { objectKey: string; mimeType: string; bytes: Uint8Array; ifNoneMatch?: "*" }) {
    await this.ensureBucket();
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.bytes,
        ContentType: input.mimeType,
        ...(input.ifNoneMatch === "*" ? { IfNoneMatch: "*" } : {}),
      }));
    } catch (error) {
      const diagnostic = storageDiagnostic(error);
      if (diagnostic.httpStatusCode === 412 || diagnostic.name === "PreconditionFailed" || diagnostic.code === "PreconditionFailed") {
        throw new StorageObjectAlreadyExistsError();
      }
      throw new StorageUnavailableError("Object storage is unavailable.", diagnostic);
    }
  }

  async createDownloadUrl(input: { objectKey: string; expiresInSeconds?: number }) {
    await this.ensureBucket();
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS;
    try {
      return {
        downloadUrl: await getSignedUrl(
          this.signingClient,
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: input.objectKey,
            ResponseContentDisposition: "attachment",
          }),
          { expiresIn: expiresInSeconds },
        ),
        expiresAt: expiresAt(expiresInSeconds),
      };
    } catch (error) {
      throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
    }
  }

  async readObject(input: { objectKey: string }): Promise<StorageObjectStream | undefined> {
    await this.ensureBucket();
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
      if (!object.Body) throw new StorageUnavailableError("Object storage returned an unreadable object body.");
      return {
        mimeType: object.ContentType ?? "application/octet-stream",
        ...(object.ContentLength === undefined ? {} : { byteSize: object.ContentLength }),
        stream: asReadableStream(object.Body),
      };
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) return undefined;
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
    }
  }

  private async ensureBucket() {
    this.bucketInitialization ??= this.initializeBucket();
    return this.bucketInitialization;
  }

  private async initializeBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (error) {
        throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
      }
    }
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [{
              AllowedHeaders: ["Content-Type", "If-None-Match"],
              AllowedMethods: ["GET", "HEAD", "PUT"],
              AllowedOrigins: [...this.browserOrigins],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 300,
            }],
          },
        }),
      );
    } catch (error) {
      if (isMinioCorsNotImplemented(error)) {
        // The fixed local MinIO image configures API CORS through Compose instead of PutBucketCors.
        console.warn(JSON.stringify({ event: "storage.bucket.cors.not_implemented", ...storageDiagnostic(error) }));
        return;
      }
      throw new StorageUnavailableError("Object storage is unavailable.", storageDiagnostic(error));
    }
  }
}

const createS3Client = (input: Pick<S3StorageConfig, "endpoint" | "region" | "accessKeyId" | "secretAccessKey">) =>
  new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });

export const createS3StoragePort = (config: S3StorageConfig): StoragePort =>
  new S3StoragePort(
    createS3Client(config),
    createS3Client({ ...config, endpoint: config.publicEndpoint ?? config.endpoint }),
    config.bucket,
    config.browserOrigins?.length ? config.browserOrigins : DEFAULT_BROWSER_ORIGINS,
  );

export class InMemoryStoragePort implements StoragePort {
  private readonly objects = new Map<string, { mimeType: string; bytes: Uint8Array }>();

  async createUploadUrl(input: { objectKey: string; mimeType: string; expiresInSeconds?: number }) {
    const ttl = input.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS;
    return {
      uploadUrl: `http://storage.invalid/upload/${encodeURIComponent(input.objectKey)}`,
      headers: { "Content-Type": input.mimeType, "If-None-Match": "*" },
      expiresAt: expiresAt(ttl),
    };
  }

  async inspectObject(input: { objectKey: string; signal?: AbortSignal }) {
    const object = this.objects.get(input.objectKey);
    if (!object) return undefined;
    return {
      mimeType: object.mimeType,
      byteSize: object.bytes.byteLength,
      sha256: createHash("sha256").update(object.bytes).digest("hex"),
    };
  }

  async inspectObjectMetadata(input: { objectKey: string; signal?: AbortSignal }): Promise<ObjectMetadataInspection | undefined> {
    const object = this.objects.get(input.objectKey);
    if (!object || object.bytes.byteLength < 1) return undefined;
    return {
      mimeType: object.mimeType,
      byteSize: object.bytes.byteLength,
    };
  }

  async createDownloadUrl(input: { objectKey: string; expiresInSeconds?: number }) {
    if (!this.objects.has(input.objectKey)) {
      throw new StorageUnavailableError("The requested object does not exist.");
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS;
    return {
      downloadUrl: `http://storage.invalid/download/${encodeURIComponent(input.objectKey)}`,
      expiresAt: expiresAt(ttl),
    };
  }

  async putObject(input: { objectKey: string; mimeType: string; bytes: Uint8Array; ifNoneMatch?: "*" }) {
    if (input.ifNoneMatch === "*" && this.objects.has(input.objectKey)) {
      throw new StorageObjectAlreadyExistsError();
    }
    this.objects.set(input.objectKey, { mimeType: input.mimeType, bytes: input.bytes });
  }

  async readObject(input: { objectKey: string }) {
    const object = this.objects.get(input.objectKey);
    if (!object) return undefined;
    const bytes = new Uint8Array(object.bytes);
    return {
      mimeType: object.mimeType,
      byteSize: bytes.byteLength,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
}

export const createInMemoryStoragePort = () => new InMemoryStoragePort();
