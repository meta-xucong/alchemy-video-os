import type { ErrorHandler, MiddlewareHandler } from "hono";

import { ControlApiError } from "../errors.js";
import { createRequestId } from "../ids.js";

export const requestLogger: MiddlewareHandler = async (context, next) => {
  const startedAt = performance.now();
  context.set("requestId", createRequestId());
  const referenceDeliveryCorrelationId = context.req.path.startsWith("/provider-input/")
    ? context.req.header("X-Reference-Delivery-Correlation")
    : undefined;
  const safeReferenceDeliveryCorrelationId = referenceDeliveryCorrelationId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referenceDeliveryCorrelationId)
    ? referenceDeliveryCorrelationId.toLowerCase()
    : undefined;
  await next();

  console.info(
    JSON.stringify({
      event: "http.request.completed",
      request_id: context.get("requestId"),
      ...(safeReferenceDeliveryCorrelationId ? { reference_delivery_correlation_id: safeReferenceDeliveryCorrelationId } : {}),
      method: context.req.method,
      path: context.req.path.startsWith("/provider-input/") ? "/provider-input/[redacted]" : context.req.path,
      status: context.res.status,
      duration_ms: Math.round(performance.now() - startedAt)
    })
  );
};

export const errorHandler: ErrorHandler = (error, context) => {
  const requestId = context.get("requestId") ?? createRequestId();
  const apiError = error instanceof ControlApiError ? error : undefined;
  const status = apiError?.status ?? 500;
  const code = apiError?.code ?? "INTERNAL_ERROR";

  console.error(
    JSON.stringify({
      event: "http.request.failed",
      request_id: requestId,
      status,
      code,
    }),
  );

  return context.json(
    {
      error: {
        code,
        message: apiError?.message ?? "Unexpected control API error.",
        retryable: apiError?.retryable ?? false,
        details: apiError?.details ?? {},
      },
      request_id: requestId,
    },
    status,
  );
};
