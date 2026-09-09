import { serve } from "@hono/node-server";
import { createDatabase, DrizzleAssetWorkspaceRepository, DrizzleControlPlaneRepository, DrizzleCreativePlanningRepository, DrizzleDeliveryPreflightStore, DrizzleDocumentConversionRepository, DrizzleDocumentKnowledgeRepository, DrizzleNarrationQualityStore, DrizzleProductionRepository, DrizzleTaskRunRepository } from "@alchemy-video/persistence";
import { parseVideoBillingFixedFee, parseVideoBillingModelRates, parseVideoBillingSurchargeMultiplier } from "@alchemy-video/domain";
import { resolveVideoPromptMaxUtf8Bytes, resolveVideoProviderRuntimeProfile } from "@alchemy-video/provider-video";
import { ReferenceDeliveryTokenCodec } from "@alchemy-video/reference-delivery";
import { createReferenceVisionAnalyzerFromEnv } from "@alchemy-video/reference-analysis";
import { createS3StoragePort } from "@alchemy-video/storage-client";
import { HttpVeyraCreditTransport, VideoVeyraBridgeAdapter, VeyraSub2ApiCreditAdapter, VeyraSub2ApiIdentityAdapter } from "@alchemy-video/credit-veyra";

import { createApp } from "./app.js";
import { HttpPixabayMusicClient } from "./pixabay-music.js";
import { VideoSessionCodec, VideoSessionIdentityAdapter } from "./veyra-session.js";
import { createControlProductionTaskRunInputSnapshotFactory } from "./production-video-input-snapshot.js";

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
const documentKnowledgeStore = new DrizzleDocumentKnowledgeRepository(database.db);
const planningStore = new DrizzleCreativePlanningRepository(database.db);
const deliveryPreflightStore = new DrizzleDeliveryPreflightStore(database.db);
const narrationQualityStore = new DrizzleNarrationQualityStore(database.db);
const productionStore = new DrizzleProductionRepository(
  database.db,
  createControlProductionTaskRunInputSnapshotFactory(process.env.VIDEO_PROVIDER, process.env.VIDEO_PROMPT_MAX_UTF8_BYTES),
);
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
const referenceVisionAnalyzer = createReferenceVisionAnalyzerFromEnv();
const veyraAuthEnabled = process.env.VEYRA_AUTH_ENABLED === "true";
const veyraCreditEnabled = process.env.VEYRA_CREDIT_ENABLED === "true";
let veyraBridge: VideoVeyraBridgeAdapter | undefined;
let videoSessionCodec: VideoSessionCodec | undefined;
let identity: VideoSessionIdentityAdapter | undefined;
if (veyraAuthEnabled) {
  const baseUrl = process.env.VIDEO_VEYRA_INTERNAL_BASE_URL;
  const internalToken = process.env.VIDEO_VEYRA_INTERNAL_TOKEN;
  const sessionSecret = process.env.VIDEO_SESSION_SECRET;
  if (!baseUrl || !internalToken || !sessionSecret) throw new Error("VIDEO_VEYRA_INTERNAL_BASE_URL, VIDEO_VEYRA_INTERNAL_TOKEN, and VIDEO_SESSION_SECRET are required when VEYRA_AUTH_ENABLED=true.");
  const transport = new HttpVeyraCreditTransport({ baseUrl });
  const identityAdapter = new VeyraSub2ApiIdentityAdapter({ transport, internalToken });
  // The account status check is part of the Alchemy/Veyra login flow.  Keep
  // account lookup available for the identity-only canary, while the separate
  // credit flag still controls debit/billing behavior.
  const creditAdapter = new VeyraSub2ApiCreditAdapter({ transport, internalToken });
  veyraBridge = new VideoVeyraBridgeAdapter(identityAdapter, creditAdapter);
  if (veyraCreditEnabled) {
    const billingChargeAmount = process.env.VIDEO_BILLING_CHARGE_AMOUNT;
    const billingModelRates = parseVideoBillingModelRates(process.env.VIDEO_BILLING_MODEL_RATES_JSON);
    const surchargeMultiplier = parseVideoBillingSurchargeMultiplier(process.env.VIDEO_BILLING_SURCHARGE_MULTIPLIER);
    const fixedFee = parseVideoBillingFixedFee(process.env.VIDEO_BILLING_FIXED_FEE);
    const usagePricingConfigured = Object.keys(billingModelRates).length > 0 || surchargeMultiplier !== undefined;
    if (usagePricingConfigured && fixedFee === undefined) {
      throw new Error("VIDEO_BILLING_SURCHARGE_MULTIPLIER or VIDEO_BILLING_MODEL_RATES_JSON requires VIDEO_BILLING_FIXED_FEE.");
    }
    if (fixedFee !== undefined && !usagePricingConfigured) {
      throw new Error("VIDEO_BILLING_FIXED_FEE requires VIDEO_BILLING_SURCHARGE_MULTIPLIER or VIDEO_BILLING_MODEL_RATES_JSON.");
    }
    if ((!billingChargeAmount || billingChargeAmount === "0") && !usagePricingConfigured) {
      throw new Error("VIDEO_BILLING_CHARGE_AMOUNT, VIDEO_BILLING_SURCHARGE_MULTIPLIER, or VIDEO_BILLING_MODEL_RATES_JSON is required when VEYRA_CREDIT_ENABLED=true.");
    }
    if (billingChargeAmount && billingChargeAmount !== "0" && usagePricingConfigured) {
      throw new Error("VIDEO_BILLING_CHARGE_AMOUNT cannot be combined with usage-based Video OS service fees.");
    }
  }
  videoSessionCodec = new VideoSessionCodec(sessionSecret);
  identity = new VideoSessionIdentityAdapter(videoSessionCodec);
} else if (veyraCreditEnabled) {
  throw new Error("VEYRA_AUTH_ENABLED=true is required when VEYRA_CREDIT_ENABLED=true.");
}
const pixabayRuntimeUrl = process.env.MEDIA_RUNTIME_URL;
const pixabayRuntimeToken = process.env.MEDIA_RUNTIME_TOKEN;
const pixabayMusic = pixabayRuntimeUrl && pixabayRuntimeToken
  ? new HttpPixabayMusicClient({ runtimeUrl: pixabayRuntimeUrl, token: pixabayRuntimeToken })
  : null;
const app = createApp({
  store,
  assetStore,
  taskStore,
  documentStore,
  documentKnowledgeStore,
  planningStore,
  deliveryPreflightStore,
  narrationQualityStore,
  productionStore,
  storage,
  ...(identity ? { identity } : {}),
  ...(veyraBridge ? { videoVeyraBridge: veyraBridge } : {}),
  ...(videoSessionCodec ? { videoSessionCodec } : {}),
  videoVeyraPortalBaseUrl: process.env.VIDEO_VEYRA_PORTAL_BASE_URL ?? "https://aiself.vip",
  videoProviderMode,
  videoPromptMaxUtf8Bytes: resolveVideoPromptMaxUtf8Bytes(process.env.VIDEO_PROMPT_MAX_UTF8_BYTES),
  ...(veyraCreditEnabled && process.env.VIDEO_BILLING_CHARGE_AMOUNT
    ? { videoBillingChargeAmount: process.env.VIDEO_BILLING_CHARGE_AMOUNT }
    : {}),
  videoBillingModelRates: veyraCreditEnabled ? parseVideoBillingModelRates(process.env.VIDEO_BILLING_MODEL_RATES_JSON) : {},
  ...(veyraCreditEnabled && process.env.VIDEO_BILLING_SURCHARGE_MULTIPLIER
    ? { videoBillingSurchargeMultiplier: parseVideoBillingSurchargeMultiplier(process.env.VIDEO_BILLING_SURCHARGE_MULTIPLIER) }
    : {}),
  ...(veyraCreditEnabled && process.env.VIDEO_BILLING_FIXED_FEE
    ? { videoBillingFixedFee: parseVideoBillingFixedFee(process.env.VIDEO_BILLING_FIXED_FEE) }
    : {}),
  ...(referenceDeliverySigningKey ? { referenceDeliveryTokenCodec: new ReferenceDeliveryTokenCodec(referenceDeliverySigningKey) } : {}),
  ...(referenceVisionAnalyzer ? { referenceVisionAnalyzer } : {}),
  pixabayMusic,
});

console.info("Control API listening on http://127.0.0.1:" + port);
serve({ fetch: app.fetch, port });
