import { relations, sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const providerEnum = pgEnum("agent_provider", ["gemini"]);
export const lookbackEnum = pgEnum("initial_autodraft_lookback", [
  "1d",
  "2d",
  "3d",
  "4d",
  "5d",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const userSettings = pgTable("user_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  draftingRules: jsonb("drafting_rules")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  agentProvider: providerEnum("agent_provider").notNull().default("gemini"),
  agentModel: text("agent_model").notNull().default("gemini-3-flash-preview"),
  initialAutodraftLookback: lookbackEnum("initial_autodraft_lookback").notNull().default("1d"),
  autodraftEnabled: boolean("autodraft_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const gmailAccounts = pgTable("gmail_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  googleEmail: text("google_email"),
  googleSub: text("google_sub"),
  lastHistoryId: text("last_history_id"),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scopes: text("scopes"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
  syncStatus: text("sync_status").default("connected"),
  lastSyncError: text("last_sync_error"),
  initialSyncStartedAt: timestamp("initial_sync_started_at", { withTimezone: true }),
  initialSyncCompletedAt: timestamp("initial_sync_completed_at", { withTimezone: true }),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
  lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const emailThreads = pgTable(
  "email_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailThreadId: text("gmail_thread_id").notNull(),
    gmailHistoryId: text("gmail_history_id"),
    subject: text("subject"),
    snippet: text("snippet"),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    hasUnread: boolean("has_unread").default(false),
    inPrimary: boolean("in_primary").default(true),
    selectionStatus: text("selection_status"),
    selectionReason: text("selection_reason"),
    latestMessageId: text("latest_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => ({
    userThreadUnique: primaryKey({ columns: [table.userId, table.gmailThreadId] }),
  }),
);

export const emailMessages = pgTable("email_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => emailThreads.id, { onDelete: "cascade" }),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  gmailInternalDate: timestamp("gmail_internal_date", { withTimezone: true }),
  direction: text("direction"),
  fromEmail: text("from_email"),
  toEmails: text("to_emails"),
  ccEmails: text("cc_emails"),
  subject: text("subject"),
  textBody: text("text_body"),
  htmlBody: text("html_body"),
  headersJson: jsonb("headers_json").$type<Record<string, string>>(),
  bodyLoaded: boolean("body_loaded").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const draftReplies = pgTable("draft_replies", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  threadId: text("thread_id")
    .notNull()
    .references(() => emailThreads.id, { onDelete: "cascade" }),
  gmailDraftId: text("gmail_draft_id"),
  status: text("status").notNull().default("drafted"),
  decisionProvider: providerEnum("decision_provider"),
  decisionModel: text("decision_model"),
  generationProvider: providerEnum("generation_provider"),
  generationModel: text("generation_model"),
  autodraftBatchId: text("autodraft_batch_id"),
  selectionContextJson: jsonb("selection_context_json").$type<Record<string, unknown>>(),
  generatedText: text("generated_text").notNull(),
  sourceMessageId: text("source_message_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  runType: text("run_type").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  threadsScanned: text("threads_scanned").default(sql`'0'`),
  threadsSelected: text("threads_selected").default(sql`'0'`),
  draftsCreated: text("drafts_created").default(sql`'0'`),
  totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 8 }).notNull().default("0"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const threadRunResults = pgTable(
  "thread_run_results",
  {
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    reason: text("reason"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.syncRunId, table.threadId] }),
  }),
);

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
  gmailAccount: one(gmailAccounts, { fields: [users.id], references: [gmailAccounts.userId] }),
  threads: many(emailThreads),
  drafts: many(draftReplies),
}));
