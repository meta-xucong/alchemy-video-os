import { Hono } from "hono";
import { cors } from "hono/cors";

import { errorHandler, requestLogger } from "./middleware/logger.js";

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: ["http://localhost:3031", "http://127.0.0.1:3031"],
      credentials: true
    })
  );
  app.use("*", requestLogger);
  app.onError(errorHandler);

  app.get("/api/v1/health", (context) =>
    context.json({
      data: {
        service: "control-api",
        status: "ok"
      },
      request_id: "local"
    })
  );

  return app;
}

export const app = createApp();
