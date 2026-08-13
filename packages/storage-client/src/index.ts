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
const STUDIO_ORIGINS = ["http://127.0.0.1:3031", "http://localhost:3031"];

export type ObjectInspection = {
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export type SignedUpload = {
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type SignedDownload = {
  downloadUrl: string;
  expiresAt: string;
};

export interface StoragePort {
  createUploadUrl(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds?: number;
  }): Promise<SignedUpload>;
  inspectObject(input: { objectKey: string }): Promise<ObjectInspection | undefined>;
  putObject(input: { objectKey: string; mimeType: string; bytes: Uint8Array; ifNoneMatch?: "*" }): Promise<void>;
  createDownloadUrl(input: { objectKey: string; expiresInSeconds?: number }): Promise<SignedDownload>;
}

export type S3StorageConfig = {
  endpoint: string;
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

const asAsyncIterable = (body: unknown): AsyncIterable<Uint8Array> => {
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") {
    throw new StorageUnavailableError("Object storage returned an unreadable object body.");
  }
  return body as AsyncIterable<Uint8Array>;
};

export class S3StoragePort implements StoragePort {
  private bucketInitialization?: Promise<void>;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createUploadUrl(input: { objectKey: string; mimeType: string; expiresInSeconds?: number }) {
    await this.ensureBucket();
    const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_URL_TTL_SECONDS;
    try {
      return {
        uploadUrl: await getSignedUrl(
          this.client,
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

  async inspectObject(input: { objectKey: string }): Promise<ObjectInspection | undefined> {
    await this.ensureBucket();
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }));
      const hash = createHash("sha256");
      let byteSize = 0;
      for await (const chunk of asAsyncIterable(object.Body)) {
        const value = Buffer.from(chunk);
        hash.update(value);
        byteSize += value.length;
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
          this.client,
          new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
          { expiresIn: expiresInSeconds },
        ),
        expiresAt: expiresAt(expiresInSeconds),
      };
    } catch (error) {
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
              AllowedOrigins: STUDIO_ORIGINS,
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

export const createS3StoragePort = (config: S3StorageConfig): StoragePort =>
  new S3StoragePort(
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
    config.bucket,
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

  async inspectObject(input: { objectKey: string }) {
    const object = this.objects.get(input.objectKey);
    if (!object) return undefined;
    return {
      mimeType: object.mimeType,
      byteSize: object.bytes.byteLength,
      sha256: createHash("sha256").update(object.bytes).digest("hex"),
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
}

export const createInMemoryStoragePort = () => new InMemoryStoragePort();
