import "dotenv/config";

import { createClient } from "@libsql/client";
import postgres from "postgres";

const NEON_URL = process.env.NEON_DATABASE_URL;
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!NEON_URL || !TURSO_URL || !TURSO_TOKEN) {
  throw new Error(
    "Set NEON_DATABASE_URL, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN before running",
  );
}

const pg = postgres(NEON_URL, { max: 1 });
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

const toMs = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);
const toBool = (b: boolean | null | undefined): number | null =>
  b == null ? null : b ? 1 : 0;
const toJson = (o: unknown): string | null => (o == null ? null : JSON.stringify(o));
const toNum = (n: string | number | null | undefined): number | null => {
  if (n == null) return null;
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v : null;
};

async function copyTable<T>(
  table: string,
  columns: readonly string[],
  rows: readonly T[],
  rowToValues: (row: T) => unknown[],
) {
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(24)} 0 rows (skipped)`);
    return 0;
  }
  const placeholders = columns.map(() => "?").join(", ");
  const cols = columns.map((c) => `"${c}"`).join(", ");
  const stmt = `INSERT OR IGNORE INTO ${table} (${cols}) VALUES (${placeholders})`;

  let inserted = 0;
  for (const row of rows) {
    const res = await turso.execute({ sql: stmt, args: rowToValues(row) as never });
    inserted += res.rowsAffected;
  }
  console.log(
    `  ${table.padEnd(24)} ${inserted}/${rows.length} rows ${
      inserted < rows.length ? "(some already present, skipped via INSERT OR IGNORE)" : ""
    }`,
  );
  return inserted;
}

console.log(`Migrating from Neon to Turso`);
console.log(`  Neon:  ${NEON_URL.replace(/:[^:@/]+@/, ":***@")}`);
console.log(`  Turso: ${TURSO_URL}\n`);

console.log("Reading from Neon...");
const [
  users,
  userSettings,
  gmailAccounts,
  emailThreads,
  emailMessages,
  draftReplies,
  subscriptions,
  billingWebhookEvents,
] = await Promise.all([
  pg`SELECT * FROM users`,
  pg`SELECT * FROM user_settings`,
  pg`SELECT * FROM gmail_accounts`,
  pg`SELECT * FROM email_threads`,
  pg`SELECT * FROM email_messages`,
  pg`SELECT * FROM draft_replies`,
  pg`SELECT * FROM subscriptions`,
  pg`SELECT * FROM billing_webhook_events`,
]);

console.log(`\nWriting to Turso (sync_runs + thread_run_results skipped — telemetry noise):`);

await copyTable(
  "users",
  ["id", "clerk_user_id", "email", "first_name", "last_name", "avatar_url", "created_at", "updated_at"],
  users,
  (r) => [r.id, r.clerk_user_id, r.email, r.first_name, r.last_name, r.avatar_url, toMs(r.created_at), toMs(r.updated_at)],
);

await copyTable(
  "user_settings",
  [
    "id",
    "user_id",
    "drafting_rules",
    "agent_provider",
    "agent_model",
    "initial_autodraft_lookback",
    "autodraft_enabled",
    "created_at",
    "updated_at",
  ],
  userSettings,
  (r) => [
    r.id,
    r.user_id,
    toJson(r.drafting_rules ?? []),
    r.agent_provider,
    r.agent_model,
    r.initial_autodraft_lookback,
    toBool(r.autodraft_enabled),
    toMs(r.created_at),
    toMs(r.updated_at),
  ],
);

await copyTable(
  "gmail_accounts",
  [
    "id",
    "user_id",
    "google_email",
    "google_sub",
    "last_history_id",
    "refresh_token_encrypted",
    "access_token_encrypted",
    "token_expires_at",
    "scopes",
    "connected_at",
    "sync_status",
    "last_sync_error",
    "initial_sync_started_at",
    "initial_sync_completed_at",
    "last_successful_sync_at",
    "last_sync_attempt_at",
    "last_polled_at",
    "created_at",
    "updated_at",
  ],
  gmailAccounts,
  (r) => [
    r.id,
    r.user_id,
    r.google_email,
    r.google_sub,
    r.last_history_id,
    r.refresh_token_encrypted,
    r.access_token_encrypted,
    toMs(r.token_expires_at),
    r.scopes,
    toMs(r.connected_at),
    r.sync_status,
    r.last_sync_error,
    toMs(r.initial_sync_started_at),
    toMs(r.initial_sync_completed_at),
    toMs(r.last_successful_sync_at),
    toMs(r.last_sync_attempt_at),
    toMs(r.last_polled_at),
    toMs(r.created_at),
    toMs(r.updated_at),
  ],
);

await copyTable(
  "email_threads",
  [
    "id",
    "user_id",
    "gmail_thread_id",
    "gmail_history_id",
    "subject",
    "snippet",
    "from_email",
    "from_name",
    "last_message_at",
    "has_unread",
    "in_primary",
    "selection_status",
    "selection_reason",
    "latest_message_id",
    "created_at",
    "updated_at",
  ],
  emailThreads,
  (r) => [
    r.id,
    r.user_id,
    r.gmail_thread_id,
    r.gmail_history_id,
    r.subject,
    r.snippet,
    r.from_email,
    r.from_name,
    toMs(r.last_message_at),
    toBool(r.has_unread),
    toBool(r.in_primary),
    r.selection_status,
    r.selection_reason,
    r.latest_message_id,
    toMs(r.created_at),
    toMs(r.updated_at),
  ],
);

await copyTable(
  "email_messages",
  [
    "id",
    "thread_id",
    "gmail_message_id",
    "gmail_internal_date",
    "direction",
    "from_email",
    "to_emails",
    "cc_emails",
    "subject",
    "text_body",
    "html_body",
    "headers_json",
    "body_loaded",
    "created_at",
  ],
  emailMessages,
  (r) => [
    r.id,
    r.thread_id,
    r.gmail_message_id,
    toMs(r.gmail_internal_date),
    r.direction,
    r.from_email,
    r.to_emails,
    r.cc_emails,
    r.subject,
    r.text_body,
    r.html_body,
    toJson(r.headers_json),
    toBool(r.body_loaded),
    toMs(r.created_at),
  ],
);

await copyTable(
  "draft_replies",
  [
    "id",
    "user_id",
    "thread_id",
    "gmail_draft_id",
    "status",
    "decision_provider",
    "decision_model",
    "generation_provider",
    "generation_model",
    "autodraft_batch_id",
    "selection_context_json",
    "generated_text",
    "source_message_id",
    "generated_at",
    "last_synced_at",
    "created_at",
    "updated_at",
  ],
  draftReplies,
  (r) => [
    r.id,
    r.user_id,
    r.thread_id,
    r.gmail_draft_id,
    r.status,
    r.decision_provider,
    r.decision_model,
    r.generation_provider,
    r.generation_model,
    r.autodraft_batch_id,
    toJson(r.selection_context_json),
    r.generated_text,
    r.source_message_id,
    toMs(r.generated_at),
    toMs(r.last_synced_at),
    toMs(r.created_at),
    toMs(r.updated_at),
  ],
);

await copyTable(
  "subscriptions",
  [
    "id",
    "user_id",
    "tier_key",
    "cadence",
    "status",
    "access_source",
    "access_code_label",
    "stripe_customer_id",
    "stripe_subscription_id",
    "stripe_price_id",
    "current_period_end",
    "cancel_at_period_end",
    "created_at",
    "updated_at",
  ],
  subscriptions,
  (r) => [
    r.id,
    r.user_id,
    r.tier_key,
    r.cadence,
    r.status,
    r.access_source,
    r.access_code_label,
    r.stripe_customer_id,
    r.stripe_subscription_id,
    r.stripe_price_id,
    toMs(r.current_period_end),
    toBool(r.cancel_at_period_end),
    toMs(r.created_at),
    toMs(r.updated_at),
  ],
);

await copyTable(
  "billing_webhook_events",
  ["event_id", "processed_at", "created_at"],
  billingWebhookEvents,
  (r) => [r.event_id, toMs(r.processed_at), toMs(r.created_at)],
);

console.log("\nVerifying Turso row counts:");
for (const table of [
  "users",
  "user_settings",
  "gmail_accounts",
  "email_threads",
  "email_messages",
  "draft_replies",
  "subscriptions",
  "billing_webhook_events",
]) {
  const res = await turso.execute(`SELECT COUNT(*) AS c FROM ${table}`);
  console.log(`  ${table.padEnd(24)} ${res.rows[0]?.c}`);
}

await pg.end();
console.log("\nMigration complete.");
process.exit(0);
