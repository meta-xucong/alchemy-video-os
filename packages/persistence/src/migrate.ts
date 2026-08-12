import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./db.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const { db, close } = createDatabase(connectionString);
const migrationsFolder = resolve(fileURLToPath(new URL("../drizzle", import.meta.url)));

try {
  await migrate(db, { migrationsFolder });
  console.log("Database migrations applied.");
} finally {
  await close();
}
