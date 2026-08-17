import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";

import {
  InternalCreativePlanningQueueMessageSchema,
  InternalDocumentConversionQueueMessageSchema,
  InternalMediaRuntimeQueueMessageSchema,
  InternalProductionQueueMessageSchema,
  InternalTaskRunQueueMessageSchema,
  type InternalCreativePlanningQueueMessage,
  type InternalDocumentConversionQueueMessage,
  type InternalMediaRuntimeQueueMessage,
  type InternalProductionQueueMessage,
  type InternalTaskRunQueueMessage,
} from "@alchemy-video/contracts";

export const INTERNAL_EVENT_QUEUE_NAME = "alchemy-video-internal-events";
export const INTERNAL_EVENT_DEAD_LETTER_QUEUE_NAME = "alchemy-video-internal-events-dead-letter";
export const INTERNAL_EVENT_JOB_NAME = "internal-event";
export const DOCUMENT_CONVERSION_QUEUE_NAME = "alchemy-video-document-conversions";
export const DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME = "alchemy-video-document-conversions-dead-letter";
export const DOCUMENT_CONVERSION_JOB_NAME = "document-conversion";
export const CREATIVE_PLANNING_QUEUE_NAME = "alchemy-video-creative-planning";
export const CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME = "alchemy-video-creative-planning-dead-letter";
export const CREATIVE_PLANNING_JOB_NAME = "creative-planning";
export const PRODUCTION_QUEUE_NAME = "alchemy-video-production";
export const PRODUCTION_DEAD_LETTER_QUEUE_NAME = "alchemy-video-production-dead-letter";
export const PRODUCTION_JOB_NAME = "production";
export const MEDIA_RUNTIME_QUEUE_NAME = "alchemy-video-media-runtime";
export const MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME = "alchemy-video-media-runtime-dead-letter";
export const MEDIA_RUNTIME_JOB_NAME = "media-runtime";

export type InternalEventQueueJob = InternalTaskRunQueueMessage;

export type DeadLetterQueueJob = {
  event_id: string;
  workspace_id: string;
  task_run_id: string;
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
  autoStart?: boolean;
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
  start(): void;
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
    { connection, concurrency: input.concurrency ?? 1, autorun: input.autoStart ?? true },
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
      task_run_id: message.data.task_run_id,
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
    start: () => {
      void worker.run().catch((error) => {
        console.error(JSON.stringify({ event: "queue.worker.run.failed", reason: safeReason(error) }));
      });
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

export type DocumentConversionQueuePort = {
  enqueue(input: InternalDocumentConversionQueueMessage): Promise<void>;
  close(): Promise<void>;
};

export type DocumentConversionQueueWorkerOptions = {
  redisUrl: string;
  processor: (input: InternalDocumentConversionQueueMessage) => Promise<void>;
  onTerminalFailure: (input: {
    event_id: string;
    workspace_id: string;
    conversion_id: string;
    attempts: number;
    reason: string;
  }) => Promise<void>;
  concurrency?: number;
  queueName?: string;
  deadLetterQueueName?: string;
  autoStart?: boolean;
};

export class BullMqDocumentConversionQueue implements DocumentConversionQueuePort {
  private readonly queue: Queue<InternalDocumentConversionQueueMessage>;

  constructor(redisUrl: string, options: { queueName?: string } = {}) {
    this.queue = new Queue(options.queueName ?? DOCUMENT_CONVERSION_QUEUE_NAME, { connection: toConnectionOptions(redisUrl) });
  }

  async enqueue(input: InternalDocumentConversionQueueMessage) {
    const message = InternalDocumentConversionQueueMessageSchema.parse(input);
    await this.queue.add(DOCUMENT_CONVERSION_JOB_NAME, message, { ...queueOptions, jobId: message.event_id });
  }

  async close() {
    await this.queue.close();
  }
}

export const createBullMqDocumentConversionWorker = (input: DocumentConversionQueueWorkerOptions): InternalEventWorkerHandle => {
  const connection = toConnectionOptions(input.redisUrl);
  const queueName = input.queueName ?? DOCUMENT_CONVERSION_QUEUE_NAME;
  const deadLetterQueueName = input.deadLetterQueueName ?? DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME;
  const deadLetterQueue = new Queue<{
    event_id: string;
    workspace_id: string;
    conversion_id: string;
    attempts: number;
    reason: string;
  }>(deadLetterQueueName, { connection });
  const worker = new Worker<InternalDocumentConversionQueueMessage>(
    queueName,
    async (job) => input.processor(InternalDocumentConversionQueueMessageSchema.parse(job.data)),
    { connection, concurrency: input.concurrency ?? 1, autorun: input.autoStart ?? true },
  );

  worker.on("failed", (job: Job<InternalDocumentConversionQueueMessage> | undefined, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const message = InternalDocumentConversionQueueMessageSchema.safeParse(job.data);
    if (!message.success) {
      console.error(JSON.stringify({ event: "document_queue.invalid_message", attempts: job.attemptsMade, reason: "schema_validation_failed" }));
      return;
    }
    const payload = {
      event_id: message.data.event_id,
      workspace_id: message.data.workspace_id,
      conversion_id: message.data.conversion_id,
      attempts: job.attemptsMade,
      reason: safeReason(error),
    };
    void Promise.all([
      input.onTerminalFailure(payload),
      deadLetterQueue.add("dead-letter", payload, { jobId: `dead-${payload.event_id}`, removeOnComplete: false, removeOnFail: false }),
    ]).catch((deadLetterError) => {
      console.error(JSON.stringify({ event: "document_queue.dead_letter.failed", event_id: payload.event_id, reason: safeReason(deadLetterError) }));
    });
  });

  return {
    close: async () => {
      await worker.close();
      await deadLetterQueue.close();
    },
    start: () => {
      void worker.run().catch((error) => {
        console.error(JSON.stringify({ event: "document_queue.worker.run.failed", reason: safeReason(error) }));
      });
    },
    waitUntilReady: () => worker.waitUntilReady(),
  };
};

export const clearDocumentConversionQueues = async (input: {
  redisUrl: string;
  queueName?: string;
  deadLetterQueueName?: string;
}) => {
  const connection = toConnectionOptions(input.redisUrl);
  const queues = [
    new Queue(input.queueName ?? DOCUMENT_CONVERSION_QUEUE_NAME, { connection }),
    new Queue(input.deadLetterQueueName ?? DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME, { connection }),
  ];
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
};

export type CreativePlanningQueuePort = {
  enqueue(input: InternalCreativePlanningQueueMessage): Promise<void>;
  close(): Promise<void>;
};

export type CreativePlanningQueueWorkerOptions = {
  redisUrl: string;
  processor: (input: InternalCreativePlanningQueueMessage) => Promise<void>;
  onTerminalFailure: (input: {
    event_id: string;
    workspace_id: string;
    creative_brief_revision_id: string;
    attempts: number;
    reason: string;
  }) => Promise<void>;
  concurrency?: number;
  queueName?: string;
  deadLetterQueueName?: string;
  autoStart?: boolean;
};

export class BullMqCreativePlanningQueue implements CreativePlanningQueuePort {
  private readonly queue: Queue<InternalCreativePlanningQueueMessage>;

  constructor(redisUrl: string, options: { queueName?: string } = {}) {
    this.queue = new Queue(options.queueName ?? CREATIVE_PLANNING_QUEUE_NAME, { connection: toConnectionOptions(redisUrl) });
  }

  async enqueue(input: InternalCreativePlanningQueueMessage) {
    const message = InternalCreativePlanningQueueMessageSchema.parse(input);
    await this.queue.add(CREATIVE_PLANNING_JOB_NAME, message, { ...queueOptions, jobId: message.event_id });
  }

  async close() {
    await this.queue.close();
  }
}

export const createBullMqCreativePlanningWorker = (input: CreativePlanningQueueWorkerOptions): InternalEventWorkerHandle => {
  const connection = toConnectionOptions(input.redisUrl);
  const queueName = input.queueName ?? CREATIVE_PLANNING_QUEUE_NAME;
  const deadLetterQueueName = input.deadLetterQueueName ?? CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME;
  const deadLetterQueue = new Queue<{
    event_id: string;
    workspace_id: string;
    creative_brief_revision_id: string;
    attempts: number;
    reason: string;
  }>(deadLetterQueueName, { connection });
  const worker = new Worker<InternalCreativePlanningQueueMessage>(
    queueName,
    async (job) => input.processor(InternalCreativePlanningQueueMessageSchema.parse(job.data)),
    { connection, concurrency: input.concurrency ?? 1, autorun: input.autoStart ?? true },
  );

  worker.on("failed", (job: Job<InternalCreativePlanningQueueMessage> | undefined, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const message = InternalCreativePlanningQueueMessageSchema.safeParse(job.data);
    if (!message.success) {
      console.error(JSON.stringify({ event: "creative_planning_queue.invalid_message", attempts: job.attemptsMade, reason: "schema_validation_failed" }));
      return;
    }
    const payload = {
      event_id: message.data.event_id,
      workspace_id: message.data.workspace_id,
      creative_brief_revision_id: message.data.creative_brief_revision_id,
      attempts: job.attemptsMade,
      reason: safeReason(error),
    };
    void Promise.all([
      input.onTerminalFailure(payload),
      deadLetterQueue.add("dead-letter", payload, { jobId: `dead-${payload.event_id}`, removeOnComplete: false, removeOnFail: false }),
    ]).catch((deadLetterError) => {
      console.error(JSON.stringify({ event: "creative_planning_queue.dead_letter.failed", event_id: payload.event_id, reason: safeReason(deadLetterError) }));
    });
  });

  return {
    close: async () => {
      await worker.close();
      await deadLetterQueue.close();
    },
    start: () => {
      void worker.run().catch((error) => {
        console.error(JSON.stringify({ event: "creative_planning_queue.worker.run.failed", reason: safeReason(error) }));
      });
    },
    waitUntilReady: () => worker.waitUntilReady(),
  };
};

export const clearCreativePlanningQueues = async (input: {
  redisUrl: string;
  queueName?: string;
  deadLetterQueueName?: string;
}) => {
  const connection = toConnectionOptions(input.redisUrl);
  const queues = [
    new Queue(input.queueName ?? CREATIVE_PLANNING_QUEUE_NAME, { connection }),
    new Queue(input.deadLetterQueueName ?? CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME, { connection }),
  ];
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
};

export type ProductionQueuePort = {
  enqueue(input: InternalProductionQueueMessage): Promise<void>;
  close(): Promise<void>;
};

export type ProductionQueueWorkerOptions = {
  redisUrl: string;
  processor: (input: InternalProductionQueueMessage) => Promise<void>;
  onTerminalFailure: (input: {
    event_id: string;
    workspace_id: string;
    production_run_id?: string;
    task_run_id?: string;
    attempts: number;
    reason: string;
  }) => Promise<void>;
  concurrency?: number;
  queueName?: string;
  deadLetterQueueName?: string;
  autoStart?: boolean;
};

export class BullMqProductionQueue implements ProductionQueuePort {
  private readonly queue: Queue<InternalProductionQueueMessage>;

  constructor(redisUrl: string, options: { queueName?: string } = {}) {
    this.queue = new Queue(options.queueName ?? PRODUCTION_QUEUE_NAME, { connection: toConnectionOptions(redisUrl) });
  }

  async enqueue(input: InternalProductionQueueMessage) {
    const message = InternalProductionQueueMessageSchema.parse(input);
    await this.queue.add(PRODUCTION_JOB_NAME, message, { ...queueOptions, jobId: message.event_id });
  }

  async close() {
    await this.queue.close();
  }
}

export const createBullMqProductionWorker = (input: ProductionQueueWorkerOptions): InternalEventWorkerHandle => {
  const connection = toConnectionOptions(input.redisUrl);
  const queueName = input.queueName ?? PRODUCTION_QUEUE_NAME;
  const deadLetterQueueName = input.deadLetterQueueName ?? PRODUCTION_DEAD_LETTER_QUEUE_NAME;
  const deadLetterQueue = new Queue<{
    event_id: string;
    workspace_id: string;
    production_run_id?: string;
    task_run_id?: string;
    attempts: number;
    reason: string;
  }>(deadLetterQueueName, { connection });
  const worker = new Worker<InternalProductionQueueMessage>(
    queueName,
    async (job) => input.processor(InternalProductionQueueMessageSchema.parse(job.data)),
    { connection, concurrency: input.concurrency ?? 1, autorun: input.autoStart ?? true },
  );

  worker.on("failed", (job: Job<InternalProductionQueueMessage> | undefined, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const message = InternalProductionQueueMessageSchema.safeParse(job.data);
    if (!message.success) {
      console.error(JSON.stringify({ event: "production_queue.invalid_message", attempts: job.attemptsMade, reason: "schema_validation_failed" }));
      return;
    }
    const payload = {
      event_id: message.data.event_id,
      workspace_id: message.data.workspace_id,
      ...(message.data.event_type === "production_run.confirmed" || message.data.event_type === "handoff_asset.accepted"
        ? { production_run_id: message.data.production_run_id }
        : { task_run_id: message.data.task_run_id }),
      attempts: job.attemptsMade,
      reason: safeReason(error),
    };
    void Promise.all([
      input.onTerminalFailure(payload),
      deadLetterQueue.add("dead-letter", payload, { jobId: `dead-${payload.event_id}`, removeOnComplete: false, removeOnFail: false }),
    ]).catch((deadLetterError) => {
      console.error(JSON.stringify({ event: "production_queue.dead_letter.failed", event_id: payload.event_id, reason: safeReason(deadLetterError) }));
    });
  });

  return {
    close: async () => {
      await worker.close();
      await deadLetterQueue.close();
    },
    start: () => {
      void worker.run().catch((error) => {
        console.error(JSON.stringify({ event: "production_queue.worker.run.failed", reason: safeReason(error) }));
      });
    },
    waitUntilReady: () => worker.waitUntilReady(),
  };
};

export const clearProductionQueues = async (input: {
  redisUrl: string;
  queueName?: string;
  deadLetterQueueName?: string;
}) => {
  const connection = toConnectionOptions(input.redisUrl);
  const queues = [
    new Queue(input.queueName ?? PRODUCTION_QUEUE_NAME, { connection }),
    new Queue(input.deadLetterQueueName ?? PRODUCTION_DEAD_LETTER_QUEUE_NAME, { connection }),
  ];
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
};

export type MediaRuntimeQueuePort = {
  enqueue(input: InternalMediaRuntimeQueueMessage): Promise<void>;
  close(): Promise<void>;
};

export type MediaRuntimeQueueWorkerOptions = {
  redisUrl: string;
  processor: (input: InternalMediaRuntimeQueueMessage) => Promise<void>;
  onTerminalFailure: (input: {
    event_id: string;
    workspace_id: string;
    production_run_id: string;
    production_segment_id?: string;
    task_run_id?: string;
    attempts: number;
    reason: string;
  }) => Promise<void>;
  concurrency?: number;
  queueName?: string;
  deadLetterQueueName?: string;
  autoStart?: boolean;
};

export class BullMqMediaRuntimeQueue implements MediaRuntimeQueuePort {
  private readonly queue: Queue<InternalMediaRuntimeQueueMessage>;

  constructor(redisUrl: string, options: { queueName?: string } = {}) {
    this.queue = new Queue(options.queueName ?? MEDIA_RUNTIME_QUEUE_NAME, { connection: toConnectionOptions(redisUrl) });
  }

  async enqueue(input: InternalMediaRuntimeQueueMessage) {
    const message = InternalMediaRuntimeQueueMessageSchema.parse(input);
    await this.queue.add(MEDIA_RUNTIME_JOB_NAME, message, { ...queueOptions, jobId: message.event_id });
  }

  async close() {
    await this.queue.close();
  }
}

export const createBullMqMediaRuntimeWorker = (input: MediaRuntimeQueueWorkerOptions): InternalEventWorkerHandle => {
  const connection = toConnectionOptions(input.redisUrl);
  const queueName = input.queueName ?? MEDIA_RUNTIME_QUEUE_NAME;
  const deadLetterQueueName = input.deadLetterQueueName ?? MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME;
  const deadLetterQueue = new Queue<{
    event_id: string;
    workspace_id: string;
    production_run_id: string;
    production_segment_id?: string;
    task_run_id?: string;
    attempts: number;
    reason: string;
  }>(deadLetterQueueName, { connection });
  const worker = new Worker<InternalMediaRuntimeQueueMessage>(
    queueName,
    async (job) => input.processor(InternalMediaRuntimeQueueMessageSchema.parse(job.data)),
    { connection, concurrency: input.concurrency ?? 1, autorun: input.autoStart ?? true },
  );

  worker.on("failed", (job: Job<InternalMediaRuntimeQueueMessage> | undefined, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    const message = InternalMediaRuntimeQueueMessageSchema.safeParse(job.data);
    if (!message.success) {
      console.error(JSON.stringify({ event: "media_runtime_queue.invalid_message", attempts: job.attemptsMade, reason: "schema_validation_failed" }));
      return;
    }
    const payload = {
      event_id: message.data.event_id,
      workspace_id: message.data.workspace_id,
      production_run_id: message.data.production_run_id,
      ...(message.data.event_type === "production_segment.qc_requested"
        ? { production_segment_id: message.data.production_segment_id, task_run_id: message.data.task_run_id }
        : {}),
      attempts: job.attemptsMade,
      reason: safeReason(error),
    };
    void Promise.all([
      input.onTerminalFailure(payload),
      deadLetterQueue.add("dead-letter", payload, { jobId: `dead-${payload.event_id}`, removeOnComplete: false, removeOnFail: false }),
    ]).catch((deadLetterError) => {
      console.error(JSON.stringify({ event: "media_runtime_queue.dead_letter.failed", event_id: payload.event_id, reason: safeReason(deadLetterError) }));
    });
  });

  return {
    close: async () => {
      await worker.close();
      await deadLetterQueue.close();
    },
    start: () => {
      void worker.run().catch((error) => {
        console.error(JSON.stringify({ event: "media_runtime_queue.worker.run.failed", reason: safeReason(error) }));
      });
    },
    waitUntilReady: () => worker.waitUntilReady(),
  };
};

export const clearMediaRuntimeQueues = async (input: {
  redisUrl: string;
  queueName?: string;
  deadLetterQueueName?: string;
}) => {
  const connection = toConnectionOptions(input.redisUrl);
  const queues = [
    new Queue(input.queueName ?? MEDIA_RUNTIME_QUEUE_NAME, { connection }),
    new Queue(input.deadLetterQueueName ?? MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME, { connection }),
  ];
  try {
    await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  } finally {
    await Promise.all(queues.map((queue) => queue.close()));
  }
};
