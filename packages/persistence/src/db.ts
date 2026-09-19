import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

export const createDatabase = (connectionString: string) => {
  const pool = new Pool({ connectionString });
  return {
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  };
};

export type PlatformDatabase = ReturnType<typeof createDatabase>["db"];
