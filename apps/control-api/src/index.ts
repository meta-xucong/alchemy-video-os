import "dotenv/config";

import { serve } from "@hono/node-server";

import { app } from "./app.js";

const port = Number(process.env.CONTROL_API_PORT ?? 3032);

console.info("Control API listening on http://127.0.0.1:" + port);
serve({ fetch: app.fetch, port });
