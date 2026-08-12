import type { ErrorHandler, MiddlewareHandler } from "hono";

export const requestLogger: MiddlewareHandler = async (context, next) => {
  const startedAt = performance.now();
  await next();

  console.info(
    JSON.stringify({
      event: "http.request.completed",
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      duration_ms: Math.round(performance.now() - startedAt)
    })
  );
};

export const errorHandler: ErrorHandler = (error, context) => {
  console.error("http.request.failed", error);

  return context.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected control API error.",
        retryable: false,
        details: {}
      },
      request_id: "local"
    },
    500
  );
};
