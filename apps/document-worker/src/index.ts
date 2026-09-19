import { config } from "dotenv";

import { createPrefixedId } from "@alchemy-video/domain";
import { DrizzleDocumentConversionRepository, DrizzleDocumentKnowledgeRepository, DrizzleTaskRunRepository, createDatabase } from "@alchemy-video/persistence";
import { createS3StoragePort } from "@alchemy-video/storage-client";
import { BullMqDocumentConversionQueue, createBullMqDocumentConversionWorker } from "@alchemy-video/task-queue";
import { BullMqDocumentKnowledgeQueue, createBullMqDocumentKnowledgeWorker } from "@alchemy-video/task-queue";

import { DocumentConversionExecutor } from "./execution-service.js";
import { DocumentKnowledgeExecutor } from "./knowledge-execution-service.js";
import { HttpDocumentRuntimeClient, validateDocumentRuntimeUrl } from "./runtime-client.js";
import { DocumentConversionEventConsumer, DocumentKnowledgeOutboxRelay, DocumentOutboxRelay } from "./service.js";
export { DocumentKnowledgeExecutor } from "./knowledge-execution-service.js";

config({ path: ".env.local" });
config();

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const runtimeUrl = process.env.DOCUMENT_RUNTIME_URL;
const runtimeToken = process.env.DOCUMENT_RUNTIME_TOKEN;
if (!databaseUrl || !redisUrl || !runtimeUrl || !runtimeToken) {
  throw new Error("DATABASE_URL, REDIS_URL, DOCUMENT_RUNTIME_URL, and DOCUMENT_RUNTIME_TOKEN are required for the C10 Document Worker.");
}
const validatedRuntimeUrl = validateDocumentRuntimeUrl(runtimeUrl);
const requiredStorageConfig = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
if (requiredStorageConfig.some((name) => !process.env[name])) {
  throw new Error("S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY are required for the C10 Document Worker.");
}

const workerId = process.env.DOCUMENT_WORKER_ID ?? `document-worker-${process.pid}`;
const database = createDatabase(databaseUrl);
const documentStore = new DrizzleDocumentConversionRepository(database.db);
const knowledgeStore = new DrizzleDocumentKnowledgeRepository(database.db);
const outboxStore = new DrizzleTaskRunRepository(database.db);
const storage = createS3StoragePort({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION!,
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY!,
  secretAccessKey: process.env.S3_SECRET_KEY!,
});
const executor = new DocumentConversionExecutor(
  documentStore,
  storage,
  new HttpDocumentRuntimeClient({ runtimeUrl: validatedRuntimeUrl, token: runtimeToken }),
);
const queueName = process.env.DOCUMENT_CONVERSION_QUEUE_NAME;
const deadLetterQueueName = process.env.DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME;
const queue = new BullMqDocumentConversionQueue(redisUrl, { ...(queueName ? { queueName } : {}) });
const relay = new DocumentOutboxRelay(outboxStore, queue, {
  relayId: `${workerId}:relay`,
  leaseMs: 30_000,
  retryDelayMs: 1_000,
  maxAttempts: 5,
  batchSize: 25,
});
const consumer = new DocumentConversionEventConsumer(documentStore, executor, {
  consumerName: "document-conversion-transition",
  workerId,
  leaseMs: 30_000,
});
const knowledgeExecutor = new DocumentKnowledgeExecutor(knowledgeStore, async ({ workspaceId, knowledgeRevisionId }) => {
  const source = await knowledgeStore.findMarkdownSource(workspaceId, knowledgeRevisionId);
  if (!source || source.mimeType !== "text/markdown") return undefined;
  const object = await storage.readObject({ objectKey: source.objectKey });
  if (!object || object.mimeType !== "text/markdown") return undefined;
  return { stream: object.stream, markdownSha256: source.markdownSha256 };
});
const worker = createBullMqDocumentConversionWorker({
  redisUrl,
  autoStart: false,
  ...(queueName ? { queueName } : {}),
  ...(deadLetterQueueName ? { deadLetterQueueName } : {}),
  processor: async (message) => {
    await consumer.process(message);
  },
  onTerminalFailure: async ({ event_id, workspace_id, reason }) => {
    await consumer.deadLetter({ eventId: event_id, workspaceId: workspace_id, reason });
  },
});
const knowledgeQueueName = process.env.DOCUMENT_KNOWLEDGE_QUEUE_NAME;
const knowledgeDeadLetterQueueName = process.env.DOCUMENT_KNOWLEDGE_DEAD_LETTER_QUEUE_NAME;
const knowledgeQueue = new BullMqDocumentKnowledgeQueue(redisUrl, { ...(knowledgeQueueName ? { queueName: knowledgeQueueName } : {}) });
const knowledgeRelay = new DocumentKnowledgeOutboxRelay(outboxStore, knowledgeQueue, {
  relayId: `${workerId}:knowledge-relay`, leaseMs: 30_000, retryDelayMs: 1_000, maxAttempts: 5, batchSize: 25,
});
const knowledgeWorker = createBullMqDocumentKnowledgeWorker({
  redisUrl,
  autoStart: false,
  ...(knowledgeQueueName ? { queueName: knowledgeQueueName } : {}),
  ...(knowledgeDeadLetterQueueName ? { deadLetterQueueName: knowledgeDeadLetterQueueName } : {}),
  processor: async (message) => {
    await knowledgeExecutor.execute({ workspaceId: message.workspace_id, knowledgeRevisionId: message.knowledge_revision_id });
  },
  onTerminalFailure: async ({ workspace_id, knowledge_revision_id, reason }) => {
    await knowledgeStore.failKnowledgeRevision({
      workspaceId: workspace_id,
      knowledgeRevisionId: knowledge_revision_id,
      retryable: true,
      errorCode: "DOCUMENT_KNOWLEDGE_INVALID",
      event: {
        eventId: createPrefixedId("evt"),
        messageId: createPrefixedId("msg"),
        traceId: createPrefixedId("trc"),
        correlationId: createPrefixedId("cor"),
      },
    });
    console.error(JSON.stringify({ event: "document_knowledge.dead_lettered", workspace_id, knowledge_revision_id, reason: reason.replace(/[\r\n]+/g, " ").slice(0, 500) }));
  },
});

await worker.waitUntilReady();
await knowledgeWorker.waitUntilReady();
const recovery = await executor.recover({ limit: 100 });
const knowledgeRecovery = await knowledgeExecutor.recover({ limit: 100 });
worker.start();
knowledgeWorker.start();
const relayTimer = setInterval(() => {
  void relay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "document_outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
const knowledgeRelayTimer = setInterval(() => {
  void knowledgeRelay.runOnce().catch((error) => {
    console.error(JSON.stringify({ event: "document_knowledge_outbox.relay.failed", reason: error instanceof Error ? error.message : String(error) }));
  });
}, 250);
await relay.runOnce();
await knowledgeRelay.runOnce();
console.info(JSON.stringify({ event: "document_worker.ready", worker_id: workerId, recovered: recovery.length, knowledge_recovered: knowledgeRecovery.length, knowledge_queue: true }));

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayTimer);
  clearInterval(knowledgeRelayTimer);
  await worker.close();
  await queue.close();
  await knowledgeWorker.close();
  await knowledgeQueue.close();
  await database.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
