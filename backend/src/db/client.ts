import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../lib/env.js";
import * as schema from "./schema.js";

const rawUrl = env.DATABASE_URL;

let url = rawUrl;
if (url.startsWith("file:")) {
  const relativePath = url.slice("file:".length);
  const absolutePath = resolve(process.cwd(), relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  url = `file:${absolutePath}`;
}

export const client = createClient({
  url,
  authToken: env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
