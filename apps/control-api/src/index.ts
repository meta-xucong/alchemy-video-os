import { config } from "dotenv";

import { serve } from "@hono/node-server";
import { createDatabase, DrizzleControlPlaneRepository } from "@alchemy-video/persistence";

import { createApp } from "./app.js";

config({ path: ".env.local" });
config();

const port = Number(process.env.CONTROL_API_PORT ?? 3032);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env.local before starting the Control API.");
}
const store = new DrizzleControlPlaneRepository(createDatabase(databaseUrl).db);
const app = createApp({ store });

console.info("Control API listening on http://127.0.0.1:" + port);
serve({ fetch: app.fetch, port });
