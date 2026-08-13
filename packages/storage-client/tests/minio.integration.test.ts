import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { createS3StoragePort } from "../src/index.js";

const requiredEnvironment = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
const hasMinioConfiguration = requiredEnvironment.every((name) => process.env[name]);

test("MinIO presigned uploads allow a browser CORS PUT once and reject overwrites", { skip: !hasMinioConfiguration }, async () => {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return;

  const objectKey = `ws_c04_minio_${randomUUID()}/prj_c04_minio/ast_c04_minio/original.png`;
  const firstBytes = new TextEncoder().encode("first immutable local asset");
  const replacementBytes = new TextEncoder().encode("replacement must be rejected");
  const storage = createS3StoragePort({ endpoint, region, bucket, accessKeyId, secretAccessKey });
  const cleanupClient = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const firstUpload = await storage.createUploadUrl({ objectKey, mimeType: "image/png" });
    assert.equal(firstUpload.headers["If-None-Match"], "*");

    const preflight = await fetch(firstUpload.uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3031",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,if-none-match",
      },
    });
    assert.ok(preflight.status === 200 || preflight.status === 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:3031");
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PUT/i);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /if-none-match/i);

    const firstPut = await fetch(firstUpload.uploadUrl, {
      method: "PUT",
      headers: { ...firstUpload.headers, Origin: "http://127.0.0.1:3031" },
      body: firstBytes,
    });
    assert.equal(firstPut.status, 200);
    const firstInspection = await storage.inspectObject({ objectKey });
    assert.ok(firstInspection);
    assert.equal(firstInspection.sha256, createHash("sha256").update(firstBytes).digest("hex"));

    const stalePut = await fetch(firstUpload.uploadUrl, {
      method: "PUT",
      headers: { ...firstUpload.headers, Origin: "http://127.0.0.1:3031" },
      body: replacementBytes,
    });
    assert.equal(stalePut.status, 412);

    const replayUpload = await storage.createUploadUrl({ objectKey, mimeType: "image/png" });
    const replayPut = await fetch(replayUpload.uploadUrl, {
      method: "PUT",
      headers: { ...replayUpload.headers, Origin: "http://127.0.0.1:3031" },
      body: replacementBytes,
    });
    assert.equal(replayPut.status, 412);
    assert.deepEqual(await storage.inspectObject({ objectKey }), firstInspection);
  } finally {
    await cleanupClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    cleanupClient.destroy();
  }
});
