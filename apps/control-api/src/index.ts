import { config } from "dotenv";

import { serve } from "@hono/node-server";
import { createDatabase, DrizzleAssetWorkspaceRepository, DrizzleControlPlaneRepository } from "@alchemy-video/persistence";
import { createS3StoragePort } from "@alchemy-video/storage-client";

import { createApp } from "./app.js";

config({ path: ".env.local" });
config();

const port = Number(process.env.CONTROL_API_PORT ?? 3032);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env.local before starting the Control API.");
}
const database = createDatabase(databaseUrl);
const store = new DrizzleControlPlaneRepository(database.db);
const assetStore = new DrizzleAssetWorkspaceRepository(database.db);
const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the Control API.");
}
const storage = createS3StoragePort({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
});
const app = createApp({ store, assetStore, storage });

console.info("Control API listening on http://127.0.0.1:" + port);
serve({ fetch: app.fetch, port });
