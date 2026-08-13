import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";

import { InternalTaskRunQueueMessageSchema, type InternalTaskRunQueueMessage } from "@alchemy-video/contracts";

export const INTERNAL_EVENT_QUEUE_NAME = "alchemy-video-internal-events";
export const INTERNAL_EVENT_DEAD_LETTER_QUEUE_NAME = "alchemy-video-internal-events-dead-letter";
export const INTERNAL_EVENT_JOB_NAME = "internal-event";

export type InternalEventQueueJob = InternalTaskRunQueueMessage;

export type DeadLetterQueueJob = {
  event_id: string;
  workspace_id: string;
  attempts: number;
  reason: string;
};

export type InternalEventQueuePort = {
  enqueue(input: InternalEventQueueJob): Promise<void>;
  close(): Promise<void>;
};

export type InternalEventWorkerOptions = {
  redisUrl: string;
  processor: (input: InternalEventQueueJob) => Promise<void>;
  onTerminalFailure: (input: DeadLetterQueueJob) => Promise<void>;
  concurrency?: number;
  queueName?: string;
  deadLetterQueueName?: string;
};

const toConnectionOptions = (redisUrl: string): ConnectionOptions => {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || "6379"),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
};

const queueOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 250 },
  removeOnComplete: false,
  removeOnFail: false,
};

const safeReason = (reason: unknown) =>
  (reason instanceof Error ? reason.message : String(reason)).replace(/[\r\n]+/g, " ").slice(0, 500);

export class BullMqInternalEventQueue implements InternalEventQueuePort {
  private readonly queue: Queue<InternalEventQueueJob>;

  constructor(redisUrl: string, options: { queueName?: string } = {}) {
    this.queue = new Queue(options.queueName ?? INTERNAL_EVENT_QUEUE_NAME, { connection: toConnectionOptions(redisUrl) });
  }

  async enqueue(input: InternalEventQueueJob) {
    const message = InternalTaskRunQueueMessageSchema.parse(input);
    await this.queue.add(INTERNAL_EVENT_JOB_NAME, message, { ...queueOptions, jobId: message.event_id });
  }

  async close() {
    await this.queue.close();
  }
}

export type InternalEventWorkerHandle = {
  close(): Promise<void>;
  waitUntilReady(): Promise<void>;
};

export const createBullMqInternalEventWorker = (input: InternalEventWorkerOptions): InternalEventWorkerHandle => {
  const connection = toConnectionOptions(input.redisUrl);
  const queueName = input.queueName ?? INTERNAL_EVENT_QUEUE_NAME;
  const deadLetterQueueName = input.deadLetterQueueName ?? INTERNAL_EVENT_DEAD_LETTER_QUEUE_NAME;
  const deadLetterQueue = new Queue<DeadLetterQueueJob>(deadLetterQueueName, { connection });
  const worker = new Worker<InternalEventQueueJob>(
    queueName,
    async (job) => input.processor(InternalTaskRunQueueMessageSchema.parse(job.data)),
    { connection, concurrency: input.concurrency ?? 1 },
  );

  worker.on("failed", (job: Job<InternalEventQueueJob> | undefined, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const message = InternalTaskRunQueueMessageSchema.safeParse(job.data);
    if (!message.success) {
      console.error(JSON.stringify({ event: "queue.invalid_message", attempts: job.attemptsMade, reason: "schema_validation_failed" }));
      return;
    }
    const payload: DeadLetterQueueJob = {
      event_id: message.data.event_id,
      workspace_id: message.data.workspace_id,
      attempts: job.attemptsMade,
      reason: safeReason(error),
    };
    void Promise.all([
      input.onTerminalFailure(payload),
      deadLetterQueue.add("dead-letter", payload, { jobId: `dead-${payload.event_id}`, removeOnComplete: false, removeOnFail: false }),
    ]).catch((deadLetterError) => {
      console.error(JSON.stringify({ event: "queue.dead_letter.failed", event_id: payload.event_id, reason: safeReason(deadLetterError) }));
    });
  });

  return {
    close: async () => {
      await worker.close();
      await deadLetterQueue.close();
    },
    waitUntilReady: () => worker.waitUntilReady(),
  };
};

export const clearInternalEventQueues = async (input: {
  redisUrl: string;
  queueName?: string;
  deadLetterQueueName?: string;
}) => {
  const connection = toConnectionOptions(input.redisUrl);
  const queues = [
    new Queue(input.queueName ?? INTERNAL_EVENT_QUEUE_NAME, { connection }),
    new Queue(input.deadLetterQueueName ?? INTERNAL_EVENT_DEAD_LETTER_QUEUE_NAME, { connection }),
  ];
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
};
