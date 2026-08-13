import { z } from "zod";

const prefixedId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`));

export const UserIdSchema = prefixedId("usr");
export const WorkspaceIdSchema = prefixedId("ws");
export const ProjectIdSchema = prefixedId("prj");
export const AssetIdSchema = prefixedId("ast");
export const ShotIdSchema = prefixedId("sht");
export const TaskRunIdSchema = prefixedId("tsk");
export const ProviderAttemptIdSchema = prefixedId("att");
export const UsageRecordIdSchema = prefixedId("use");
export const EventIdSchema = prefixedId("evt");
export const RequestIdSchema = z.string().regex(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);

export const UtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const DecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const IdempotencyKeySchema = z.string().min(1).max(255);
export const JsonObjectSchema = z.record(z.unknown());

export type UserId = z.infer<typeof UserIdSchema>;
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type AssetId = z.infer<typeof AssetIdSchema>;
export type ShotId = z.infer<typeof ShotIdSchema>;
export type TaskRunId = z.infer<typeof TaskRunIdSchema>;
export type ProviderAttemptId = z.infer<typeof ProviderAttemptIdSchema>;
export type UsageRecordId = z.infer<typeof UsageRecordIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
