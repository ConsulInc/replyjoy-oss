import { relations } from "drizzle-orm";
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const providerOptions = ["gemini"] as const;
const lookbackOptions = ["1d", "2d", "3d", "4d", "5d"] as const;

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const boolFlag = (name: string) => integer(name, { mode: "boolean" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const userSettings = sqliteTable("user_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  draftingRules: text("drafting_rules", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  agentProvider: text("agent_provider", { enum: providerOptions }).notNull().default("gemini"),
  agentModel: text("agent_model").notNull().default("gemini-3-flash-preview"),
  initialAutodraftLookback: text("initial_autodraft_lookback", { enum: lookbackOptions })
    .notNull()
    .default("1d"),
  autodraftEnabled: boolFlag("autodraft_enabled").notNull().default(true),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const gmailAccounts = sqliteTable("gmail_accounts", {
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
  tokenExpiresAt: timestampMs("token_expires_at"),
  scopes: text("scopes"),
  connectedAt: timestampMs("connected_at").notNull().$defaultFn(() => new Date()),
  syncStatus: text("sync_status").default("connected"),
  lastSyncError: text("last_sync_error"),
  initialSyncStartedAt: timestampMs("initial_sync_started_at"),
  initialSyncCompletedAt: timestampMs("initial_sync_completed_at"),
  lastSuccessfulSyncAt: timestampMs("last_successful_sync_at"),
  lastSyncAttemptAt: timestampMs("last_sync_attempt_at"),
  lastPolledAt: timestampMs("last_polled_at"),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const emailThreads = sqliteTable(
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
    lastMessageAt: timestampMs("last_message_at"),
    hasUnread: boolFlag("has_unread").default(false),
    inPrimary: boolFlag("in_primary").default(true),
    selectionStatus: text("selection_status"),
    selectionReason: text("selection_reason"),
    latestMessageId: text("latest_message_id"),
    createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
    updatedAt: timestampMs("updated_at")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userThreadUnique: uniqueIndex("email_threads_user_thread_unique").on(
      table.userId,
      table.gmailThreadId,
    ),
  }),
);

export const emailMessages = sqliteTable("email_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => emailThreads.id, { onDelete: "cascade" }),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  gmailInternalDate: timestampMs("gmail_internal_date"),
  direction: text("direction"),
  fromEmail: text("from_email"),
  toEmails: text("to_emails"),
  ccEmails: text("cc_emails"),
  subject: text("subject"),
  textBody: text("text_body"),
  htmlBody: text("html_body"),
  headersJson: text("headers_json", { mode: "json" }).$type<Record<string, string>>(),
  bodyLoaded: boolFlag("body_loaded").default(false),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

export const draftReplies = sqliteTable("draft_replies", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  threadId: text("thread_id")
    .notNull()
    .references(() => emailThreads.id, { onDelete: "cascade" }),
  gmailDraftId: text("gmail_draft_id"),
  status: text("status").notNull().default("drafted"),
  decisionProvider: text("decision_provider", { enum: providerOptions }),
  decisionModel: text("decision_model"),
  generationProvider: text("generation_provider", { enum: providerOptions }),
  generationModel: text("generation_model"),
  autodraftBatchId: text("autodraft_batch_id"),
  selectionContextJson: text("selection_context_json", { mode: "json" }).$type<
    Record<string, unknown>
  >(),
  generatedText: text("generated_text").notNull(),
  sourceMessageId: text("source_message_id"),
  generatedAt: timestampMs("generated_at").notNull().$defaultFn(() => new Date()),
  lastSyncedAt: timestampMs("last_synced_at"),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: timestampMs("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  runType: text("run_type").notNull(),
  windowStart: timestampMs("window_start"),
  windowEnd: timestampMs("window_end"),
  status: text("status").notNull().default("pending"),
  threadsScanned: text("threads_scanned").default("0"),
  threadsSelected: text("threads_selected").default("0"),
  draftsCreated: text("drafts_created").default("0"),
  totalCostUsd: real("total_cost_usd").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestampMs("started_at").notNull().$defaultFn(() => new Date()),
  finishedAt: timestampMs("finished_at"),
});

export const threadRunResults = sqliteTable(
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
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
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
