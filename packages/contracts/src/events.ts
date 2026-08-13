import { z } from "zod";

import {
  AssetIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  JsonObjectSchema,
  ProjectIdSchema,
  ProviderAttemptIdSchema,
  Sha256Schema,
  ShotIdSchema,
  TaskRunIdSchema,
  UsageRecordIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";
import {
  AssetKindSchema,
  PublicTaskRunStatusSchema,
  ShotStatusSchema,
  TaskRunKindSchema,
  TaskRunStatusSchema,
} from "./resources.js";

const AggregateSchema = z.object({
  type: z.enum(["project", "shot", "task_run", "asset"]),
  id: z.string().min(1),
}).strict();

const InternalEventBaseSchema = z.object({
  contract_version: z.literal("1.0"),
  message_id: z.string().min(1),
  event_id: EventIdSchema,
  occurred_at: UtcTimestampSchema,
  trace_id: z.string().min(1),
  correlation_id: z.string().min(1),
  causation_id: z.string().min(1).optional(),
  idempotency_key: IdempotencyKeySchema,
  producer: z.string().min(1),
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema.optional(),
  aggregate: AggregateSchema,
  version: z.literal(1),
});

const PublicWorkspaceEventBaseSchema = z.object({
  event_id: EventIdSchema,
  occurred_at: UtcTimestampSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema.optional(),
  aggregate: AggregateSchema,
  version: z.literal(1),
}).strict();

export const AssetUploadConfirmedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("asset.upload.confirmed"),
  data: z.object({
    asset_id: AssetIdSchema,
    project_id: ProjectIdSchema,
    kind: AssetKindSchema,
    sha256: Sha256Schema,
  }),
});

export const ShotUpdatedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("shot.updated"),
  data: z.object({
    shot_id: ShotIdSchema,
    status: z.string().min(1),
    revision: z.number().int().positive(),
  }),
});

export const TaskRunQueuedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.queued"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    kind: TaskRunKindSchema,
    input_snapshot: JsonObjectSchema,
  }),
});

export const InternalTaskRunQueueMessageSchema = z.object({
  contract_version: z.literal("1.0"),
  event_id: EventIdSchema,
  workspace_id: WorkspaceIdSchema,
  task_run_id: TaskRunIdSchema,
  attempt_no: z.number().int().positive(),
  correlation_id: z.string().min(1),
  input_snapshot: JsonObjectSchema,
}).strict();

export const TaskRunStartedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.started"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    attempt_no: z.number().int().positive(),
  }),
});

export const ProviderAttemptSubmittedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("provider_attempt.submitted"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    provider_attempt_id: ProviderAttemptIdSchema,
    provider_request_id: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
});

export const TaskRunProgressedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.progressed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    status: TaskRunStatusSchema,
    progress: z.number().min(0).max(100),
    message: z.string().min(1),
  }),
});

export const TaskRunSucceededEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.succeeded"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    result_asset_id: AssetIdSchema,
    sha256: Sha256Schema,
  }),
});

export const TaskRunFailedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("task_run.failed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    error_code: z.string().min(1),
    retryable: z.boolean(),
    provider_attempt_id: ProviderAttemptIdSchema.optional(),
  }),
});

export const UsageDebitedEventSchema = InternalEventBaseSchema.extend({
  event_type: z.literal("usage.debited"),
  data: z.object({
    usage_record_id: UsageRecordIdSchema,
    task_run_id: TaskRunIdSchema,
    amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/),
    source: z.string().min(1),
    replayed: z.boolean(),
  }),
});

export const InternalEventEnvelopeSchema = z.discriminatedUnion("event_type", [
  AssetUploadConfirmedEventSchema,
  ShotUpdatedEventSchema,
  TaskRunQueuedEventSchema,
  TaskRunStartedEventSchema,
  ProviderAttemptSubmittedEventSchema,
  TaskRunProgressedEventSchema,
  TaskRunSucceededEventSchema,
  TaskRunFailedEventSchema,
  UsageDebitedEventSchema,
]);

const PublicAssetUploadConfirmedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("asset.upload.confirmed"),
  data: z.object({
    asset_id: AssetIdSchema,
    project_id: ProjectIdSchema,
    kind: AssetKindSchema,
  }).strict(),
});

const PublicShotUpdatedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("shot.updated"),
  data: z.object({
    shot_id: ShotIdSchema,
    status: ShotStatusSchema,
    revision: z.number().int().positive(),
  }).strict(),
});

const PublicTaskRunQueuedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.queued"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    kind: TaskRunKindSchema,
  }).strict(),
});

const PublicTaskRunStartedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.started"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
  }).strict(),
});

const PublicTaskRunProgressedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.progressed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    status: PublicTaskRunStatusSchema,
    progress: z.number().min(0).max(100),
  }).strict(),
});

const PublicTaskRunSucceededEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.succeeded"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    result_asset_id: AssetIdSchema,
  }).strict(),
});

const PublicTaskRunFailedEventSchema = PublicWorkspaceEventBaseSchema.extend({
  event_type: z.literal("task_run.failed"),
  data: z.object({
    task_run_id: TaskRunIdSchema,
    error_code: z.string().min(1),
    retryable: z.boolean(),
  }).strict(),
});

export const PublicWorkspaceEventEnvelopeSchema = z.discriminatedUnion("event_type", [
  PublicAssetUploadConfirmedEventSchema,
  PublicShotUpdatedEventSchema,
  PublicTaskRunQueuedEventSchema,
  PublicTaskRunStartedEventSchema,
  PublicTaskRunProgressedEventSchema,
  PublicTaskRunSucceededEventSchema,
  PublicTaskRunFailedEventSchema,
]);

export const projectPublicWorkspaceEvent = (
  event: InternalEventEnvelope,
): PublicWorkspaceEventEnvelope | undefined => {
  const project = (value: unknown) => {
    const parsed = PublicWorkspaceEventEnvelopeSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };
  const base = {
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    workspace_id: event.workspace_id,
    ...(event.project_id === undefined ? {} : { project_id: event.project_id }),
    aggregate: event.aggregate,
    version: event.version,
  };

  switch (event.event_type) {
    case "asset.upload.confirmed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          asset_id: event.data.asset_id,
          project_id: event.data.project_id,
          kind: event.data.kind,
        },
      });
    case "shot.updated":
      return project({
        ...base,
        event_type: event.event_type,
        data: event.data,
      });
    case "task_run.queued":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          kind: event.data.kind,
        },
      });
    case "task_run.started":
      return project({
        ...base,
        event_type: event.event_type,
        data: { task_run_id: event.data.task_run_id },
      });
    case "task_run.progressed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          status: event.data.status === "PROVIDER_PROCESSING" ? "PROCESSING" : event.data.status,
          progress: event.data.progress,
        },
      });
    case "task_run.succeeded":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          result_asset_id: event.data.result_asset_id,
        },
      });
    case "task_run.failed":
      return project({
        ...base,
        event_type: event.event_type,
        data: {
          task_run_id: event.data.task_run_id,
          error_code: event.data.error_code,
          retryable: event.data.retryable,
        },
      });
    case "provider_attempt.submitted":
    case "usage.debited":
      return undefined;
  }
};

export type InternalEventEnvelope = z.infer<typeof InternalEventEnvelopeSchema>;
export type InternalTaskRunQueueMessage = z.infer<typeof InternalTaskRunQueueMessageSchema>;
export type PublicWorkspaceEventEnvelope = z.infer<typeof PublicWorkspaceEventEnvelopeSchema>;
