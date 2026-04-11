import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { env } from "../lib/env.js";
import { db } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

export async function bootstrapDatabase() {
  await migrate(db, { migrationsFolder });

  if (env.COMMERCIAL_MIGRATIONS_PATH) {
    await migrate(db, {
      migrationsFolder: path.resolve(process.cwd(), env.COMMERCIAL_MIGRATIONS_PATH),
    });
  }
}
