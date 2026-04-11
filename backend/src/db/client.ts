import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import { env } from "../lib/env.js";
import * as schema from "./schema.js";

const queryClient = postgres(env.DATABASE_URL, { max: 1 });

export const db = drizzle(queryClient, { schema });
export { queryClient };

