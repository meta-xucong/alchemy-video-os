import { serve } from "@hono/node-server";
import { createDatabase, DrizzleAssetWorkspaceRepository, DrizzleControlPlaneRepository, DrizzleCreativePlanningRepository, DrizzleDocumentConversionRepository, DrizzleProductionRepository, DrizzleTaskRunRepository } from "@alchemy-video/persistence";
import { resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";
import { createS3StoragePort } from "@alchemy-video/storage-client";

import { createApp } from "./app.js";

const port = Number(process.env.CONTROL_API_PORT ?? 3032);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in the Control API process environment.");
}
const database = createDatabase(databaseUrl);
const store = new DrizzleControlPlaneRepository(database.db);
const assetStore = new DrizzleAssetWorkspaceRepository(database.db);
const taskStore = new DrizzleTaskRunRepository(database.db);
const documentStore = new DrizzleDocumentConversionRepository(database.db);
const planningStore = new DrizzleCreativePlanningRepository(database.db);
const productionStore = new DrizzleProductionRepository(database.db);
const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the Control API.");
}
const storage = createS3StoragePort({
  endpoint: process.env.S3_ENDPOINT!,
  ...(process.env.S3_PUBLIC_ENDPOINT ? { publicEndpoint: process.env.S3_PUBLIC_ENDPOINT } : {}),
  ...(process.env.S3_BROWSER_ORIGINS
    ? { browserOrigins: process.env.S3_BROWSER_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean) }
    : {}),
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
});
const videoProviderMode = resolveVideoProviderRuntimeProfile(process.env.VIDEO_PROVIDER).mode;
const referenceDeliverySigningKey = process.env.REFERENCE_DELIVERY_SIGNING_KEY;
const app = createApp({
  store,
  assetStore,
  taskStore,
  documentStore,
  planningStore,
  productionStore,
  storage,
  videoProviderMode,
  ...(referenceDeliverySigningKey ? { referenceDeliveryTokenCodec: new ReferenceDeliveryTokenCodec(referenceDeliverySigningKey) } : {}),
});

console.info("Control API listening on http://127.0.0.1:" + port);
serve({ fetch: app.fetch, port });
