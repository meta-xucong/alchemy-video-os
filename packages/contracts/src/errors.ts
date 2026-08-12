import { z } from "zod";

import { JsonObjectSchema, RequestIdSchema } from "./primitives.js";

export const ApplicationErrorCodeSchema = z.enum([
  "AUTH_UNAVAILABLE",
  "AUTH_FORBIDDEN",
  "CREDIT_INSUFFICIENT",
  "CREDIT_CONFLICT",
  "CREDIT_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "PROVIDER_PROTOCOL_INVALID",
  "DOWNLOAD_INVALID",
  "IDEMPOTENCY_CONFLICT",
  "WORKSPACE_FORBIDDEN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "TASK_STATE_INVALID",
  "INTERNAL_ERROR",
]);

export const ApiErrorSchema = z.object({
  code: ApplicationErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: JsonObjectSchema.default({}),
});

export const ApiFailureEnvelopeSchema = z.object({
  error: ApiErrorSchema,
  request_id: RequestIdSchema,
});

export const successEnvelope = <TSchema extends z.ZodTypeAny>(data: TSchema) =>
  z.object({
    data,
    request_id: RequestIdSchema,
  });

export type ApplicationErrorCode = z.infer<typeof ApplicationErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
