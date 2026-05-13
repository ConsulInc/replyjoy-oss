import "dotenv/config";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN;

if (!url) {
  throw new Error("Set TURSO_DATABASE_URL (or DATABASE_URL) to your libsql://... target");
}

if (!url.startsWith("libsql:")) {
  throw new Error(`Refusing to run against ${url} — this script is intended for Turso (libsql://...)`);
}

const client = createClient({ url, authToken });
const db = drizzle(client);

const ossMigrationsFolder = path.resolve(import.meta.dirname, "../drizzle");
console.log(`Applying OSS migrations from ${ossMigrationsFolder}`);
await migrate(db, { migrationsFolder: ossMigrationsFolder });

const commercialPath = process.env.COMMERCIAL_MIGRATIONS_PATH;
if (commercialPath) {
  const commercialMigrationsFolder = path.resolve(process.cwd(), commercialPath);
  console.log(`Applying commercial migrations from ${commercialMigrationsFolder}`);
  await migrate(db, { migrationsFolder: commercialMigrationsFolder });
}

console.log("Turso schema bootstrap complete.");
process.exit(0);
