import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { Type } from "@google/genai";

import { lookbackOptions } from "../config/agent-config.js";
import { db } from "../db/client.js";
import {
  draftReplies,
  emailMessages,
  emailThreads,
  gmailAccounts,
  syncRuns,
  threadRunResults,
  userSettings,
} from "../db/schema.js";
import { createCalendarClient, createGmailClient } from "../gmail/client.js";
import { buildReplyRaw, extractThreadText, getHeader } from "../gmail/mime.js";
import { decryptSecret } from "../lib/crypto.js";
import { createId } from "../lib/id.js";
import { addTraceEvent, mergeTraceMetadata, traceableIfEnabled } from "../lib/langsmith.js";
import { logger } from "../lib/logger.js";
import {
  askModelWithUsage,
  askGeminiFunctionCallWithUsage,
  type GeminiContent,
  type GeminiFunctionDeclaration,
} from "./model-client.js";
import { formatCostUsd } from "./model-pricing.js";
import { normalizeAgentModel } from "../config/agent-config.js";

const activeSyncs = new Set<string>();
const POLL_OVERLAP_MS = 2 * 60 * 1000;
const SYNC_IDLE_WAIT_MS = 5 * 60 * 1000;
const SYNC_IDLE_POLL_MS = 250;
const MAX_CANDIDATE_THREADS = 500;
const MAX_RECENT_REVIEWS = 100;
const THREAD_PROCESSING_POOL_SIZE = 20;
const MAX_AGENT_TURNS = 40;
const MAX_AGENT_OUTPUT_TOKENS = 2_048;
const MAX_AGENT_SEARCH_RESULTS = 8;
const MAX_AGENT_CONTEXT_MESSAGES = 30;
const MAX_AGENT_MESSAGE_TEXT_CHARS = 4_000;
const MAX_AGENT_ATTACHMENTS_PER_DRAFT = 3;
const MAX_AGENT_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_AGENT_CALENDAR_WINDOW_DAYS = 14;
const MAX_AGENT_CALENDAR_EVENTS = 50;
const SYNC_RUN_RETENTION_DAYS = 7;
const STALE_SYNC_RUN_ERROR_MESSAGE = "Sync was stale during retention cleanup.";
const EXCLUDED_INBOX_CATEGORIES = [
  "CATEGORY_SPAM",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
] as const;
const AUTODRAFT_RUN_TYPES = ["oauth_connect", "redo_autodraft", "manual", "scheduled"] as const;

const AGENT_SYSTEM_PROMPT = `
You are an autonomous Gmail draft agent.
Your objective is to review candidate inbox threads and create useful reply drafts when appropriate.
You may inspect thread details before deciding.
You must use one of the provided tools for every turn. Do not answer in freeform text.

Guidelines:
- Never make up facts or assumptions. Do not invent dates, names, prices, commitments, plans, or preferences. Only use information that is explicitly present in the current thread, the user's prior mailbox history, the calendar, or attachments you have read. If a needed detail is missing, either search for it with a tool, leave it out of the draft, or use skip_thread.
- You may search past mailbox history when a draft would benefit from more context.
- When a thread is about scheduling or meeting coordination, inspect the calendar before proposing times.
- Prefer concrete alternatives that are actually open on the calendar instead of suggesting speculative availability.
- Prefer targeted searches over broad searches.
- Use sent-mail history to learn the user's tone, style, and how they answered similar messages.
- Use mailbox searches to find similar requests, prior answers, or sender-specific context.
- Search prior attachments when the user likely wants the same file resent.
- You may read up to 30 past messages total across the run. Spend that budget carefully.
- Attach at most 3 prior files, and only when you are confident they are the right ones.
- Keep reason fields short and direct.
- Keep search queries concise. Do not put long planning text inside query.
- Do not create a draft unless you are confident it is appropriate for the user.
- When no draft should be created, use skip_thread and give a short explanation.
`;

const AGENT_ATTACHMENT_FUNCTION_PARAM = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      messageId: { type: Type.STRING, description: "Message ID containing the attachment." },
      attachmentId: { type: Type.STRING, description: "Attachment ID in the message." },
      filename: { type: Type.STRING, description: "Filename to attach." },
    },
    required: ["messageId", "attachmentId", "filename"],
  },
};

const AGENT_FUNCTION_DECLARATIONS: GeminiFunctionDeclaration[] = [
  {
    name: "read_thread",
    description: "Read the candidate Gmail thread before deciding how to respond.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        threadId: { type: Type.STRING, description: "Candidate Gmail thread ID to inspect." },
        reason: { type: Type.STRING, description: "Short reason for reading the thread." },
      },
      required: ["threadId", "reason"],
    },
  },
  {
    name: "check_calendar_availability",
    description:
      "Read the user's calendar within a bounded time window and return both matching events and open slots.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        start: { type: Type.STRING, description: "Window start as an ISO 8601 datetime." },
        end: { type: Type.STRING, description: "Window end as an ISO 8601 datetime." },
        calendarId: {
          type: Type.STRING,
          description: "Calendar ID to inspect. Use 'primary' unless there is a clear reason not to.",
        },
        query: {
          type: Type.STRING,
          description: "Optional text filter for calendar events in that window.",
        },
        maxResults: {
          type: Type.NUMBER,
          description: "Maximum events to inspect before summarizing the result.",
        },
        reason: { type: Type.STRING, description: "Short reason for checking the calendar." },
      },
      required: ["start", "end", "reason"],
    },
  },
  {
    name: "search_mailbox",
    description: "Search the user's mailbox for relevant prior context or sent replies.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Short Gmail search query." },
        maxResults: { type: Type.NUMBER, description: "Maximum results to inspect." },
        reason: { type: Type.STRING, description: "Short reason for the search." },
      },
      required: ["query", "reason"],
    },
  },
  {
    name: "search_attachments",
    description: "Search prior email attachments for a likely file to reuse.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Short attachment search query." },
        maxResults: { type: Type.NUMBER, description: "Maximum results to inspect." },
        reason: { type: Type.STRING, description: "Short reason for the search." },
      },
      required: ["query", "reason"],
    },
  },
  {
    name: "read_message",
    description: "Read a prior mailbox message in full for better context.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageId: { type: Type.STRING, description: "Mailbox message ID to read." },
        reason: { type: Type.STRING, description: "Short reason for reading this message." },
      },
      required: ["messageId", "reason"],
    },
  },
  {
    name: "create_draft",
    description: "Create a draft reply for the current candidate thread.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        threadId: { type: Type.STRING, description: "Candidate Gmail thread ID to draft for." },
        draft: { type: Type.STRING, description: "Reply draft body." },
        attachments: AGENT_ATTACHMENT_FUNCTION_PARAM,
        reason: { type: Type.STRING, description: "Short reason for creating the draft." },
      },
      required: ["threadId", "draft", "reason"],
    },
  },
  {
    name: "skip_thread",
    description: "Skip drafting for the current candidate thread.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        threadId: { type: Type.STRING, description: "Candidate Gmail thread ID to skip." },
        reason: { type: Type.STRING, description: "Short reason for skipping." },
      },
      required: ["threadId", "reason"],
    },
  },
  {
    name: "finish",
    description: "End the run when no more tool actions are needed.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: "Short reason for finishing." },
      },
      required: ["reason"],
    },
  },
];

const RULE_RESPONSE_SCHEMA = {
  name: "rule_suggestion",
  schema: {
    type: "object",
    properties: {
      rule: { type: "string" },
    },
    required: ["rule"],
    additionalProperties: false,
  },
};

function formatDraftingRules(draftingRules: string[]) {
  if (draftingRules.length === 0) {
    return "No custom drafting rules configured.";
  }

  const numbered = draftingRules.map((rule, index) => `${index + 1}. ${rule.trim()}`).join("\n");
  return `User drafting rules:\n${numbered}`;
}

export function computeWindowStart(lookback: string, lastPolledAt: Date | null) {
  if (lastPolledAt) {
    return new Date(lastPolledAt.getTime() - POLL_OVERLAP_MS);
  }
  const now = Date.now();
  const days =
    lookback === "1d"
      ? 1
      : lookback === "2d"
        ? 2
        : lookback === "3d"
        ? 3
          : lookback === "4d"
            ? 4
            : lookback === "5d"
              ? 5
              : 1;
  return new Date(now - days * 24 * 60 * 60 * 1000);
}

export function buildSearchQuery(start: Date) {
  const exclusions = EXCLUDED_INBOX_CATEGORIES
    .map((label) => `-category:${label.replace("CATEGORY_", "").toLowerCase()}`)
    .join(" ");
  return `in:inbox ${exclusions} after:${Math.floor(start.getTime() / 1000)}`;
}

export type Candidate = {
  gmailThreadId: string;
  gmailHistoryId: string | null;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  fromName: string | null;
  latestMessageAt: string | null;
  latestMessageId: string | null;
  hasUnread: boolean;
};

export type AutodraftBatchSummary = {
  id: string;
  runType: string;
  draftsCount: number;
  startedAt: string;
  finishedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

export type ProcessingThreadSummary = {
  id: string;
  threadId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  latestMessageAt: string;
  snippet: string | null;
  gmailThreadId: string;
};

type AgentMailboxSearchResult = {
  messageId: string;
  threadId: string | null;
  date: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  snippet: string | null;
  labelIds: string[];
};

type AgentAttachmentReference = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  threadId: string | null;
  date: string | null;
  from: string | null;
  subject: string | null;
};

type AgentMailboxMessage = AgentMailboxSearchResult & {
  text: string;
  attachments: AgentAttachmentReference[];
};

type AgentCalendarEvent = {
  id: string | null;
  calendarId: string;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  organizer: string | null;
  creator: string | null;
  attendees: string[];
  start: string | null;
  end: string | null;
  isAllDay: boolean;
  transparency: string | null;
  hangoutLink: string | null;
};

type AgentCalendarAvailabilitySlot = {
  start: string;
  end: string;
  minutes: number;
};

type AgentCalendarAvailability = {
  calendarId: string;
  start: string;
  end: string;
  query: string | null;
  events: AgentCalendarEvent[];
  openSlots: AgentCalendarAvailabilitySlot[];
};

function deriveProcessingPreview(thread: Awaited<ReturnType<typeof readThreadForAgent>>) {
  const latestMessageWithText = [...thread.messages]
    .reverse()
    .find((message) => typeof message.text === "string" && message.text.trim().length > 0);

  const previewSource = latestMessageWithText?.text ?? thread.snippet ?? null;
  if (!previewSource) {
    return null;
  }

  const normalized = previewSource
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return trimAgentText(normalized, 220);
}

export type AgentThreadDecision = "drafted" | "skipped";

export type AgentThreadRunResult = {
  decision: AgentThreadDecision;
  reason: string;
  costUsd: number;
};

type AgentDraftResult = {
  draft: string;
  reason: string;
  thread: Awaited<ReturnType<typeof readThreadForAgent>> | null;
  attachments: Array<{
    messageId: string;
    attachmentId: string;
    filename: string;
  }>;
};

type AutonomousAgentRunResult = {
  drafted: Map<string, AgentDraftResult>;
  threadResults: Map<string, AgentThreadRunResult>;
  totalCostUsd: number;
};

export type LookbackEstimateMap = Record<(typeof lookbackOptions)[number], number | null>;
export type SyncProgress = {
  total: number;
  completed: number;
  active: number;
};

export type SyncRunResult = {
  emailsFound: number;
  draftsCreated: number;
};

function isAutodraftRunType(runType: string) {
  return (AUTODRAFT_RUN_TYPES as readonly string[]).includes(runType);
}

function assertSyncIdle(userId: string) {
  if (activeSyncs.has(userId)) {
    throw new Error("Sync already running for this account");
  }
}

async function recoverStaleRunningSyncs(userId: string) {
  if (activeSyncs.has(userId)) {
    return;
  }

  const staleRuns = await db.query.syncRuns.findMany({
    where: and(eq(syncRuns.userId, userId), eq(syncRuns.status, "running")),
  });

  if (staleRuns.length === 0) {
    return;
  }

  const staleRunIds = staleRuns.map((run) => run.id);
  const staleError = "Sync was interrupted before completion.";

  await db
    .update(syncRuns)
    .set({
      status: "failed",
      errorMessage: staleError,
      finishedAt: new Date(),
    })
    .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.id, staleRunIds)));

  await db
    .update(emailThreads)
    .set({
      selectionStatus: null,
      selectionReason: null,
    })
    .where(and(eq(emailThreads.userId, userId), eq(emailThreads.selectionStatus, "processing")));

  await db
    .update(gmailAccounts)
    .set({
      syncStatus: "error",
      lastSyncError: staleError,
      lastSyncAttemptAt: new Date(),
    })
    .where(eq(gmailAccounts.userId, userId));

  logger.warn("Recovered stale running syncs", {
    userId,
    staleRunIds,
  });
}

export async function recoverAllOrphanedSyncs() {
  const runningUsers = await db
    .selectDistinct({ userId: syncRuns.userId })
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"));

  for (const row of runningUsers) {
    await recoverStaleRunningSyncs(row.userId);
  }
}

async function assertNoDatabaseSyncRunning(userId: string) {
  await recoverStaleRunningSyncs(userId);

  const activeRun = await db.query.syncRuns.findFirst({
    where: and(eq(syncRuns.userId, userId), eq(syncRuns.status, "running")),
    orderBy: [desc(syncRuns.startedAt)],
  });

  if (activeRun) {
    throw new Error("Sync already running for this account");
  }
}

async function waitForSyncIdle(userId: string, timeoutMs = SYNC_IDLE_WAIT_MS) {
  const startedAt = Date.now();

  while (true) {
    await recoverStaleRunningSyncs(userId);

    const activeRun = await db.query.syncRuns.findFirst({
      where: and(eq(syncRuns.userId, userId), eq(syncRuns.status, "running")),
      orderBy: [desc(syncRuns.startedAt)],
    });

    if (!activeSyncs.has(userId) && !activeRun) {
      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for active sync to finish");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, SYNC_IDLE_POLL_MS);
    });
  }
}

async function withUserSyncLock<T>(
  userId: string,
  fn: () => Promise<T>,
  options?: {
    waitForIdle?: boolean;
    timeoutMs?: number;
  },
) {
  if (options?.waitForIdle) {
    await waitForSyncIdle(userId, options.timeoutMs);
  }

  await assertNoDatabaseSyncRunning(userId);
  assertSyncIdle(userId);
  activeSyncs.add(userId);

  try {
    return await fn();
  } finally {
    activeSyncs.delete(userId);
  }
}

export function parseFromHeader(fromHeader: string | null) {
  if (!fromHeader) return { name: null, email: null };
  const match = fromHeader.match(/^(.*)<(.+)>$/);
  if (!match) return { name: null, email: fromHeader.trim() };
  return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
}

export function hasEligibleInboxLabels(labelIds: string[] | undefined | null) {
  const labels = new Set(labelIds ?? []);
  return (
    labels.has("INBOX") &&
    ![...EXCLUDED_INBOX_CATEGORIES].some((category) => labels.has(category))
  );
}

function collectAttachmentParts(payload: any): Array<{
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}> {
  const attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];

  const visit = (node: any) => {
    if (!node) {
      return;
    }

    if (node.filename && node.body?.attachmentId) {
      attachments.push({
        attachmentId: node.body.attachmentId,
        filename: node.filename,
        mimeType: node.mimeType ?? "application/octet-stream",
        size: Number(node.body.size ?? 0),
      });
    }

    for (const part of node.parts ?? []) {
      visit(part);
    }
  };

  visit(payload);
  return attachments;
}

function isHistoryCursorExpired(error: unknown) {
  const status =
    (error as { code?: number; response?: { status?: number } } | undefined)?.response?.status ??
    (error as { code?: number } | undefined)?.code;
  return status === 404;
}

function isMissingGmailEntity(error: unknown) {
  const status =
    (error as { code?: number; response?: { status?: number } } | undefined)?.response?.status ??
    (error as { code?: number } | undefined)?.code;
  return status === 404;
}

function trimAgentText(value: string | null | undefined, maxChars: number) {
  const normalized = value?.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n...[truncated]`;
}

function summarizeThreadForPrompt(thread: Awaited<ReturnType<typeof readThreadForAgent>>) {
  return {
    threadId: thread.threadId,
    snippet: trimAgentText(thread.snippet, 280),
    messages: thread.messages.map((message) => ({
      gmailMessageId: message.gmailMessageId,
      date: message.date,
      from: message.from,
      to: message.to,
      subject: message.subject,
      messageId: message.messageId,
      references: message.references,
      text: trimAgentText(message.text, 1_200),
    })),
  };
}

function summarizeMailboxSearchResultsForPrompt(results: AgentMailboxSearchResult[]) {
  return results.map((result) => ({
    messageId: result.messageId,
    threadId: result.threadId,
    date: result.date,
    from: result.from,
    to: result.to,
    subject: result.subject,
    snippet: trimAgentText(result.snippet, 240),
    labelIds: result.labelIds,
  }));
}

function summarizeAttachmentResultsForPrompt(results: AgentAttachmentReference[]) {
  return results.map((result) => ({
    messageId: result.messageId,
    attachmentId: result.attachmentId,
    filename: result.filename,
    mimeType: result.mimeType,
    size: result.size,
    threadId: result.threadId,
    date: result.date,
    from: result.from,
    subject: result.subject,
  }));
}

function summarizeMailboxMessageForPrompt(message: AgentMailboxMessage) {
  return {
    messageId: message.messageId,
    threadId: message.threadId,
    date: message.date,
    from: message.from,
    to: message.to,
    subject: message.subject,
    snippet: trimAgentText(message.snippet, 240),
    labelIds: message.labelIds,
    text: trimAgentText(message.text, 1_200),
    attachments: message.attachments.map((attachment) => ({
      messageId: attachment.messageId,
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      threadId: attachment.threadId,
      date: attachment.date,
      from: attachment.from,
      subject: attachment.subject,
    })),
  };
}

function summarizeCalendarAvailabilityForPrompt(result: AgentCalendarAvailability) {
  return {
    calendarId: result.calendarId,
    start: result.start,
    end: result.end,
    query: result.query,
    events: result.events.map((event) => ({
      id: event.id,
      status: event.status,
      summary: trimAgentText(event.summary, 120),
      description: trimAgentText(event.description, 240),
      location: trimAgentText(event.location, 120),
      organizer: event.organizer,
      creator: event.creator,
      attendees: event.attendees.slice(0, 6),
      start: event.start,
      end: event.end,
      isAllDay: event.isAllDay,
      transparency: event.transparency,
      hangoutLink: event.hangoutLink,
    })),
    openSlots: result.openSlots,
  };
}

function buildAgentStateSnapshot(params: {
  inspected: Set<string>;
  contextMessagesRead: Set<string>;
  drafted: Map<string, AgentDraftResult>;
  decisions: Map<string, Omit<AgentThreadRunResult, "costUsd">>;
}) {
  return {
    inspectedThreadIds: [...params.inspected],
    contextMessagesRead: params.contextMessagesRead.size,
    contextMessagesRemaining: MAX_AGENT_CONTEXT_MESSAGES - params.contextMessagesRead.size,
    draftedThreadIds: [...params.drafted.keys()],
    decidedThreadIds: [...params.decisions.keys()],
  };
}

function buildAgentToolResultMessage(params: {
  tool: string;
  payload: Record<string, unknown>;
  inspected: Set<string>;
  contextMessagesRead: Set<string>;
  drafted: Map<string, AgentDraftResult>;
  decisions: Map<string, Omit<AgentThreadRunResult, "costUsd">>;
}) {
  return JSON.stringify(
    {
      tool: params.tool,
      ...params.payload,
      state: buildAgentStateSnapshot(params),
    },
    null,
    2,
  );
}

function roundCurrency(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

export function allocateThreadCosts(params: {
  candidateThreadIds: string[];
  attributedCostByThread: Map<string, number>;
  unattributedCostUsd: number;
  decisions: Map<string, Omit<AgentThreadRunResult, "costUsd">>;
}) {
  const { candidateThreadIds, attributedCostByThread, unattributedCostUsd, decisions } = params;
  const defaultReason = "Reviewed during sync, but no draft was created.";
  const sharedCostUsd = candidateThreadIds.length > 0 ? unattributedCostUsd / candidateThreadIds.length : 0;

  return new Map(
    candidateThreadIds.map((threadId) => {
      const decision = decisions.get(threadId) ?? {
        decision: "skipped" as const,
        reason: defaultReason,
      };

      return [
        threadId,
        {
          decision: decision.decision,
          reason: decision.reason,
          costUsd: roundCurrency((attributedCostByThread.get(threadId) ?? 0) + sharedCostUsd),
        },
      ] satisfies [string, AgentThreadRunResult];
    }),
  );
}

async function fetchThreadIdsFromSearch(
  gmail: ReturnType<typeof createGmailClient>,
  start: Date,
) {
  const listResponse = await gmail.users.threads.list({
    userId: "me",
    maxResults: MAX_CANDIDATE_THREADS,
    q: buildSearchQuery(start),
  });

  return listResponse.data.threads?.map((thread) => thread.id).filter(Boolean) as string[] | undefined;
}

async function countEligibleThreadsForWindow(
  gmail: ReturnType<typeof createGmailClient>,
  start: Date,
  accountEmail: string | null,
) {
  let pageToken: string | undefined;
  let eligibleCount = 0;

  do {
    const listResponse = await gmail.users.threads.list({
      userId: "me",
      maxResults: 100,
      pageToken,
      q: buildSearchQuery(start),
    });

    for (const thread of listResponse.data.threads ?? []) {
      if (!thread.id) {
        continue;
      }

      const fullThread = await gmail.users.threads.get({
        userId: "me",
        id: thread.id,
        format: "metadata",
      });
      if (!fullThread.data.messages?.length) {
        continue;
      }
      const latest = fullThread.data.messages?.at(-1);
      const latestLabelIds = latest?.labelIds ?? [];
      const latestHeaders = latest?.payload?.headers ?? [];
      const latestFrom = getHeader(latestHeaders, "From");
      const latestFromEmail = parseFromHeader(latestFrom).email;
      const isOwnLatestMessage =
        Boolean(accountEmail) &&
        Boolean(latestFromEmail) &&
        latestFromEmail?.toLowerCase() === accountEmail?.toLowerCase();

      if (
        hasEligibleInboxLabels(latestLabelIds) &&
        !latestLabelIds.includes("DRAFT") &&
        !isOwnLatestMessage
      ) {
        eligibleCount += 1;
      }
    }

    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  return eligibleCount;
}

async function fetchThreadIdsFromHistory(
  gmail: ReturnType<typeof createGmailClient>,
  startHistoryId: string,
) {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId: string | null = startHistoryId;

  try {
    do {
      const response = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        pageToken,
        maxResults: 100,
        historyTypes: ["messageAdded", "labelAdded"],
      });

      latestHistoryId = response.data.historyId ?? latestHistoryId;

      for (const entry of response.data.history ?? []) {
        latestHistoryId = entry.id ?? latestHistoryId;
        const messages = [
          ...(entry.messages ?? []),
          ...(entry.messagesAdded?.map((item) => item.message).filter(Boolean) ?? []),
          ...(entry.labelsAdded?.map((item) => item.message).filter(Boolean) ?? []),
        ];

        for (const message of messages) {
          if (message?.threadId) {
            threadIds.add(message.threadId);
          }
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return {
      threadIds: [...threadIds].slice(0, MAX_CANDIDATE_THREADS),
      latestHistoryId,
      shouldFallbackToSearch: false,
    };
  } catch (error) {
    if (isHistoryCursorExpired(error)) {
      logger.warn("Gmail history cursor expired, falling back to search", { startHistoryId });
      return {
        threadIds: [],
        latestHistoryId: null,
        shouldFallbackToSearch: true,
      };
    }

    throw error;
  }
}

async function hydrateCandidates(
  gmail: ReturnType<typeof createGmailClient>,
  threadIds: string[],
  accountEmail: string | null,
) {
  const candidates = await Promise.all(
    threadIds.map(async (threadId) => {
      try {
        const thread = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date", "Message-ID"],
        });
        if (!thread.data.messages?.length) {
          return null;
        }

        const latest = thread.data.messages.at(-1);
        const headers = latest?.payload?.headers ?? [];
        const latestLabelIds = latest?.labelIds ?? [];
        const fromHeader = getHeader(headers, "From");
        const from = parseFromHeader(fromHeader);
        const isOwnLatestMessage =
          Boolean(accountEmail) &&
          Boolean(from.email) &&
          from.email?.toLowerCase() === accountEmail?.toLowerCase();

        if (
          !hasEligibleInboxLabels(latestLabelIds) ||
          latestLabelIds.includes("DRAFT") ||
          isOwnLatestMessage
        ) {
          return null;
        }

        return {
          gmailThreadId: threadId,
          gmailHistoryId: thread.data.historyId ?? null,
          subject: getHeader(headers, "Subject"),
          snippet: thread.data.snippet ?? null,
          fromEmail: from.email,
          fromName: from.name,
          latestMessageAt: latest?.internalDate
            ? new Date(Number(latest.internalDate)).toISOString()
            : null,
          latestMessageId: latest?.id ?? null,
          hasUnread: latestLabelIds.includes("UNREAD"),
        } satisfies Candidate;
      } catch (error) {
        if (isMissingGmailEntity(error)) {
          logger.warn("Skipped missing Gmail thread while hydrating candidates", {
            threadId,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          return null;
        }

        throw error;
      }
    }),
  );

  return candidates
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .sort((left, right) => {
      const leftTime = left.latestMessageAt ? new Date(left.latestMessageAt).getTime() : 0;
      const rightTime = right.latestMessageAt ? new Date(right.latestMessageAt).getTime() : 0;
      return rightTime - leftTime;
    });
}

async function fetchCandidates(account: typeof gmailAccounts.$inferSelect, lookback: string) {
  return fetchCandidatesWithOptions(account, lookback, { forceFreshWindow: false });
}

async function fetchCandidatesWithOptions(
  account: typeof gmailAccounts.$inferSelect,
  lookback: string,
  options: {
    forceFreshWindow: boolean;
  },
) {
  const gmail = createGmailClient({
    refreshToken: decryptSecret(account.refreshTokenEncrypted),
    accessToken: account.accessTokenEncrypted ? decryptSecret(account.accessTokenEncrypted) : undefined,
    expiryDate: account.tokenExpiresAt?.getTime(),
  });

  const windowStart = computeWindowStart(
    lookback,
    options.forceFreshWindow ? null : account.lastPolledAt,
  );
  const historyResult =
    !options.forceFreshWindow && account.lastHistoryId
      ? await fetchThreadIdsFromHistory(gmail, account.lastHistoryId)
      : {
          threadIds: [] as string[],
          latestHistoryId: null,
          shouldFallbackToSearch: true,
        };

  const threadIds = historyResult.shouldFallbackToSearch
    ? ((await fetchThreadIdsFromSearch(gmail, windowStart)) ?? [])
    : historyResult.threadIds;

  const candidates = threadIds.length
    ? await hydrateCandidates(gmail, threadIds, account.googleEmail ?? null)
    : [];

  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    gmail,
    candidates,
    windowStart,
    latestHistoryId: profile.data.historyId ?? historyResult.latestHistoryId ?? account.lastHistoryId ?? null,
  };
}

function createAccountGmailClient(account: typeof gmailAccounts.$inferSelect) {
  return createGmailClient({
    refreshToken: decryptSecret(account.refreshTokenEncrypted),
    accessToken: account.accessTokenEncrypted ? decryptSecret(account.accessTokenEncrypted) : undefined,
    expiryDate: account.tokenExpiresAt?.getTime(),
  });
}

function createAccountCalendarClient(account: typeof gmailAccounts.$inferSelect) {
  return createCalendarClient({
    refreshToken: decryptSecret(account.refreshTokenEncrypted),
    accessToken: account.accessTokenEncrypted ? decryptSecret(account.accessTokenEncrypted) : undefined,
    expiryDate: account.tokenExpiresAt?.getTime(),
  });
}

function toAutodraftBatchSummary(
  run: typeof syncRuns.$inferSelect,
  draftsCount: number,
): AutodraftBatchSummary {
  return {
    id: run.id,
    runType: run.runType,
    draftsCount,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    windowStart: run.windowStart?.toISOString() ?? null,
    windowEnd: run.windowEnd?.toISOString() ?? null,
  };
}

async function findAutodraftBatch(userId: string, batchId?: string) {
  const batches = await db.query.syncRuns.findMany({
    where: batchId
      ? and(
          eq(syncRuns.userId, userId),
          eq(syncRuns.id, batchId),
          inArray(syncRuns.runType, [...AUTODRAFT_RUN_TYPES]),
        )
      : and(eq(syncRuns.userId, userId), inArray(syncRuns.runType, [...AUTODRAFT_RUN_TYPES])),
    orderBy: [desc(syncRuns.startedAt)],
    limit: batchId ? 1 : 25,
  });

  if (batchId) {
    return batches[0] ?? null;
  }

  if (batches.length === 0) {
    return null;
  }

  const drafts = await db.query.draftReplies.findMany({
    where: and(eq(draftReplies.userId, userId), inArray(draftReplies.autodraftBatchId, batches.map((batch) => batch.id))),
  });
  const batchIdsWithDrafts = new Set(
    drafts
      .map((draft) => draft.autodraftBatchId)
      .filter((draftBatchId): draftBatchId is string => Boolean(draftBatchId)),
  );

  return batches.find((batch) => batchIdsWithDrafts.has(batch.id)) ?? null;
}

export async function getLatestAutodraftBatch(userId: string) {
  const batch = await findAutodraftBatch(userId);
  if (!batch) {
    return null;
  }

  const drafts = await db.query.draftReplies.findMany({
    where: and(eq(draftReplies.userId, userId), eq(draftReplies.autodraftBatchId, batch.id)),
  });

  return toAutodraftBatchSummary(batch, drafts.length);
}

function buildRuleSuggestionPrompt(input: {
  feedback: string;
  threadId: string;
  subject: string | null;
  fromEmail: string | null;
  generatedText: string | null;
  selectionReason: string | null;
}) {
  const contextBits = [
    `Thread ID: ${input.threadId}`,
    `Subject: ${input.subject ?? "No subject"}`,
    `From: ${input.fromEmail ?? "Unknown sender"}`,
    `Selection reason: ${input.selectionReason ?? "No note provided."}`,
    `Generated draft: ${input.generatedText ?? "No draft generated."}`,
  ];

  return `Given this email review feedback from a human, return one actionable drafting rule:
- Feedback: "${input.feedback}"

Context:
${contextBits.join("\n")}

Return JSON: {"rule":"..."} where rule is a short imperative sentence that can be reused next time.
`;
}

async function deleteDraftReplyFromGmail(account: typeof gmailAccounts.$inferSelect | null, draft: typeof draftReplies.$inferSelect) {
  if (!account || !draft.gmailDraftId) {
    return;
  }

  const gmail = createAccountGmailClient(account);
  try {
    await gmail.users.drafts.delete({
      userId: "me",
      id: draft.gmailDraftId,
    });
  } catch (error) {
    const status =
      (error as { code?: number; response?: { status?: number } } | undefined)?.response?.status ??
      (error as { code?: number } | undefined)?.code;

    if (status !== 404) {
      throw error;
    }
  }
}

async function clearDraftRepliesForThreadIds(userId: string, threadIds: string[]) {
  if (threadIds.length === 0) {
    return {
      drafts: [],
    };
  }

  const draftRows = (await db.query.draftReplies.findMany({
    where: and(eq(draftReplies.userId, userId), inArray(draftReplies.threadId, threadIds)),
  })) ;

  if (!draftRows) {
    return {
      drafts: [],
    };
  }

  if (draftRows.length === 0) {
    return {
      drafts: [],
    };
  }

  const account = (await db.query.gmailAccounts.findFirst({
    where: eq(gmailAccounts.userId, userId),
  })) ?? null;
  await Promise.all(draftRows.map((draft) => deleteDraftReplyFromGmail(account, draft)));

  await db.delete(draftReplies).where(and(eq(draftReplies.userId, userId), inArray(draftReplies.threadId, threadIds)));

  await db
    .update(emailThreads)
    .set({
      selectionStatus: null,
      selectionReason: null,
    })
    .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, threadIds)));

  return {
    drafts: draftRows,
  };
}

async function getRecentThreadIdsInWindow(userId: string, lookback: string) {
  const windowStart = computeWindowStart(lookback, null);

  const threads = await db.query.emailThreads.findMany({
    where: and(eq(emailThreads.userId, userId), gte(emailThreads.lastMessageAt, windowStart)),
    columns: { id: true },
  });

  return [...new Set(threads.map((thread) => thread.id))];
}

async function clearAutodraftWindowUnlocked(userId: string, lookback: string) {
  const threadIds = await getRecentThreadIdsInWindow(userId, lookback);
  if (threadIds.length === 0) {
    return {
      batch: null,
      clearedCount: 0,
    };
  }

  const result = await clearDraftRepliesForThreadIds(userId, threadIds);

  logger.info("Cleared autodraft lookback window", {
    userId,
    lookback,
    clearedCount: result.drafts.length,
  });

  return {
    batch: null,
    clearedCount: result.drafts.length,
  };
}

async function clearAutodraftBatchUnlocked(userId: string, batchId?: string) {
  const batch = await findAutodraftBatch(userId, batchId);
  if (!batch) {
    return {
      batch: null,
      clearedCount: 0,
    };
  }

  const drafts = await db.query.draftReplies.findMany({
    where: and(eq(draftReplies.userId, userId), eq(draftReplies.autodraftBatchId, batch.id)),
  });

  if (drafts.length === 0) {
    return {
      batch: toAutodraftBatchSummary(batch, 0),
      clearedCount: 0,
    };
  }

  const threadIds = [...new Set(drafts.map((draft) => draft.threadId))];
  await clearDraftRepliesForThreadIds(userId, threadIds);

  logger.info("Cleared autodraft batch", {
    userId,
    batchId: batch.id,
    clearedCount: drafts.length,
  });

  return {
    batch: toAutodraftBatchSummary(batch, drafts.length),
    clearedCount: drafts.length,
  };
}

export async function clearAutodraftBatch(userId: string, batchId?: string) {
  return withUserSyncLock(userId, () => clearAutodraftBatchUnlocked(userId, batchId), {
    waitForIdle: true,
  });
}

export async function clearAutodraftWindow(userId: string, lookback: string) {
  return withUserSyncLock(userId, () => clearAutodraftWindowUnlocked(userId, lookback), {
    waitForIdle: true,
  });
}

export async function redoAutodraftBatch(userId: string, lookback: string) {
  return withUserSyncLock(
    userId,
    async () => {
      await syncUserAccountUnlocked(userId, {
        runType: "redo_autodraft",
        lookbackOverride: lookback,
        forceFreshWindow: true,
      });
      return getLatestAutodraftBatch(userId);
    },
    {
      waitForIdle: true,
    },
  );
}

export async function clearAutodraftThread(userId: string, threadId: string) {
  return withUserSyncLock(
    userId,
    async () => {
      const thread = await db.query.emailThreads.findFirst({
        where: and(eq(emailThreads.userId, userId), eq(emailThreads.id, threadId)),
      });
      if (!thread) {
        return {
          batch: null,
          clearedCount: 0,
        };
      }

      const { drafts } = await clearDraftRepliesForThreadIds(userId, [thread.id]);
      return {
        batch: null,
        clearedCount: drafts.length,
      };
    },
    {
      waitForIdle: true,
    },
  );
}

export async function redoAutodraftThread(userId: string, threadId: string) {
  return withUserSyncLock(
    userId,
    async () => {
      const thread = await db.query.emailThreads.findFirst({
        where: and(eq(emailThreads.userId, userId), eq(emailThreads.id, threadId)),
      });
      if (!thread) {
        throw new Error("Thread not found.");
      }

      await clearDraftRepliesForThreadIds(userId, [thread.id]);

      const account = await db.query.gmailAccounts.findFirst({
        where: eq(gmailAccounts.userId, userId),
      });
      const settings = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, userId),
      });

      if (!account || !settings) {
        throw new Error("Missing Gmail connection or user settings.");
      }
      if (!settings.autodraftEnabled) {
        throw new Error("Autodraft is currently disabled for this account.");
      }

      await db
        .update(gmailAccounts)
        .set({
          lastSyncAttemptAt: new Date(),
          syncStatus: "syncing",
          lastSyncError: null,
        })
        .where(eq(gmailAccounts.userId, userId));

      const runId = createId("sync");
      await db.insert(syncRuns).values({
        id: runId,
        userId,
        runType: "redo_autodraft",
        status: "running",
      });

      try {
        const candidate: Candidate = {
          gmailThreadId: thread.gmailThreadId,
          gmailHistoryId: thread.gmailHistoryId,
          subject: thread.subject,
          snippet: thread.snippet,
          fromEmail: thread.fromEmail,
          fromName: thread.fromName,
          latestMessageAt: thread.lastMessageAt?.toISOString() ?? new Date().toISOString(),
          latestMessageId: thread.latestMessageId,
          hasUnread: thread.hasUnread ?? false,
        };

        const gmail = createAccountGmailClient(account);
        const calendar = createAccountCalendarClient(account);
        const tools = createTracedAgentTools({ gmail, calendar });

        const result = await processCandidateThread({
          userId,
          runId,
          account,
          settings,
          gmail,
          tools,
          candidate,
          threadRecord: thread,
          autodraftBatchId: runId,
        });

        await db
          .update(syncRuns)
          .set({
            status: "completed",
            windowStart: new Date(),
            windowEnd: new Date(),
            threadsScanned: "1",
            threadsSelected: "1",
            draftsCreated: String(result.drafted ? 1 : 0),
            totalCostUsd: formatCostUsd(result.costUsd),
            finishedAt: new Date(),
          })
          .where(eq(syncRuns.id, runId));

        await db
        .update(gmailAccounts)
        .set({
          lastSyncAttemptAt: new Date(),
          syncStatus: "synced",
          lastPolledAt: new Date(),
          lastSuccessfulSyncAt: new Date(),
            lastSyncError: null,
          })
          .where(eq(gmailAccounts.userId, userId));
      } catch (error) {
        await db
          .update(syncRuns)
          .set({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          })
          .where(eq(syncRuns.id, runId));
        await db
        .update(gmailAccounts)
        .set({
          lastSyncAttemptAt: new Date(),
          syncStatus: "error",
          lastSyncError: error instanceof Error ? error.message : String(error),
        })
          .where(eq(gmailAccounts.userId, userId));

        throw error;
      }

      return {
        ok: true,
        batch: await getLatestAutodraftBatch(userId),
      };
    },
    {
      waitForIdle: true,
    },
  );
}

export async function suggestRuleFromFeedback(
  userId: string,
  params: {
    threadId: string;
    feedback: string;
    generatedText?: string;
    selectionReason?: string;
    subject?: string;
    fromEmail?: string;
  },
) {
  const thread = await db.query.emailThreads.findFirst({
    where: and(eq(emailThreads.userId, userId), eq(emailThreads.id, params.threadId)),
  });

  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  if (!thread || !settings) {
    throw new Error("Thread not found.");
  }

  const response = await askModelWithUsage<{
    rule?: string;
  }>({
    provider: settings.agentProvider,
    model: settings.agentModel,
    system: "You help convert human drafting feedback into a reusable rule.",
    responseSchema: RULE_RESPONSE_SCHEMA,
    prompt: buildRuleSuggestionPrompt({
      feedback: params.feedback,
      threadId: params.threadId,
      subject: thread.subject ?? params.subject ?? null,
      fromEmail: thread.fromEmail ?? params.fromEmail ?? null,
      generatedText: params.generatedText ?? null,
      selectionReason: params.selectionReason ?? null,
    }),
  });

  const proposed = (() => {
    const candidateRule =
      typeof (response.data as { rule?: unknown }).rule === "string"
        ? ((response.data as { rule?: string }).rule ?? "")
        : "";
    return candidateRule.trim().replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0]?.trim() ?? "";
  })();

  const rule =
    proposed.length > 0
      ? proposed
      : params.feedback.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";

  return {
    rule,
  };
}

export async function getLookbackEstimates(userId: string): Promise<LookbackEstimateMap> {
  const empty = Object.fromEntries(
    lookbackOptions.map((lookback) => [lookback, null]),
  ) as LookbackEstimateMap;

  const account = await db.query.gmailAccounts.findFirst({
    where: eq(gmailAccounts.userId, userId),
  });

  if (!account) {
    return empty;
  }

  const gmail = createAccountGmailClient(account);
  const estimates = await Promise.all(
    lookbackOptions.map(async (lookback) => {
      const count = await countEligibleThreadsForWindow(
        gmail,
        computeWindowStart(lookback, null),
        account.googleEmail ?? null,
      );
      return [lookback, count] as const;
    }),
  );

  return Object.fromEntries(estimates) as LookbackEstimateMap;
}

async function readThreadForAgent(gmail: ReturnType<typeof createGmailClient>, threadId: string) {
  const thread = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });

  const messages =
    thread.data.messages?.map((message) => {
      const headers = message.payload?.headers ?? [];
      return {
        gmailMessageId: message.id ?? "",
        date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        messageId: getHeader(headers, "Message-ID"),
        references: getHeader(headers, "References"),
        text: trimAgentText(extractThreadText(message.payload), MAX_AGENT_MESSAGE_TEXT_CHARS),
        attachments: collectAttachmentParts(message.payload).map((attachment) => ({
          ...attachment,
          messageId: message.id ?? "",
          threadId,
          date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
          from: getHeader(headers, "From"),
          subject: getHeader(headers, "Subject"),
        })),
      };
    }) ?? [];

  return {
    threadId,
    snippet: thread.data.snippet ?? null,
    messages,
  };
}

function parseCalendarEventDateTime(input: { date?: string | null; dateTime?: string | null } | undefined) {
  if (input?.dateTime) {
    return {
      iso: new Date(input.dateTime).toISOString(),
      isAllDay: false,
    };
  }

  if (input?.date) {
    return {
      iso: new Date(`${input.date}T00:00:00.000Z`).toISOString(),
      isAllDay: true,
    };
  }

  return {
    iso: null,
    isAllDay: false,
  };
}

function clampCalendarWindow(start: string, end: string) {
  const parsedStart = new Date(start);
  const parsedEnd = new Date(end);

  if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
    throw new Error("Calendar availability checks require valid ISO 8601 start and end datetimes.");
  }

  if (parsedEnd <= parsedStart) {
    throw new Error("Calendar availability checks require end to be after start.");
  }

  const maxEnd = new Date(
    parsedStart.getTime() + MAX_AGENT_CALENDAR_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    start: parsedStart,
    end: parsedEnd > maxEnd ? maxEnd : parsedEnd,
  };
}

function computeOpenCalendarSlots(params: {
  start: Date;
  end: Date;
  events: AgentCalendarEvent[];
}) {
  const busyRanges = params.events
    .filter((event) => event.transparency !== "transparent")
    .flatMap((event) => {
      if (!event.start || !event.end) {
        return [];
      }

      const start = new Date(event.start);
      const end = new Date(event.end);
      if (end <= params.start || start >= params.end || end <= start) {
        return [];
      }

      return [
        {
          start: start < params.start ? params.start : start,
          end: end > params.end ? params.end : end,
        },
      ];
    })
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  const mergedBusyRanges: Array<{ start: Date; end: Date }> = [];
  for (const range of busyRanges) {
    const last = mergedBusyRanges.at(-1);
    if (!last || range.start > last.end) {
      mergedBusyRanges.push(range);
      continue;
    }

    if (range.end > last.end) {
      last.end = range.end;
    }
  }

  const openSlots: AgentCalendarAvailabilitySlot[] = [];
  let cursor = params.start;
  for (const range of mergedBusyRanges) {
    if (range.start > cursor) {
      openSlots.push({
        start: cursor.toISOString(),
        end: range.start.toISOString(),
        minutes: Math.round((range.start.getTime() - cursor.getTime()) / 60_000),
      });
    }

    if (range.end > cursor) {
      cursor = range.end;
    }
  }

  if (cursor < params.end) {
    openSlots.push({
      start: cursor.toISOString(),
      end: params.end.toISOString(),
      minutes: Math.round((params.end.getTime() - cursor.getTime()) / 60_000),
    });
  }

  return openSlots;
}

async function checkCalendarAvailabilityForAgent(
  calendar: ReturnType<typeof createCalendarClient>,
  params: {
    start: string;
    end: string;
    calendarId?: string;
    query?: string;
    maxResults?: number;
  },
): Promise<AgentCalendarAvailability> {
  const { start, end } = clampCalendarWindow(params.start, params.end);
  const calendarId = params.calendarId?.trim() || "primary";
  const query = params.query?.trim() || null;
  const maxResults =
    typeof params.maxResults === "number" && Number.isFinite(params.maxResults)
      ? Math.max(1, Math.min(Math.floor(params.maxResults), MAX_AGENT_CALENDAR_EVENTS))
      : MAX_AGENT_CALENDAR_EVENTS;

  const response = await calendar.events.list({
    calendarId,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    q: query ?? undefined,
    maxResults,
    showDeleted: false,
  });

  const events = (response.data.items ?? [])
    .filter((event) => event.status !== "cancelled")
    .map((event) => {
      const startInfo = parseCalendarEventDateTime(event.start);
      const endInfo = parseCalendarEventDateTime(event.end);
      return {
        id: event.id ?? null,
        calendarId,
        status: event.status ?? null,
        summary: event.summary ?? null,
        description: event.description ?? null,
        location: event.location ?? null,
        organizer: event.organizer?.email ?? event.organizer?.displayName ?? null,
        creator: event.creator?.email ?? event.creator?.displayName ?? null,
        attendees:
          event.attendees?.map((attendee) => attendee.email ?? attendee.displayName).filter(Boolean) as string[] ??
          [],
        start: startInfo.iso,
        end: endInfo.iso,
        isAllDay: startInfo.isAllDay || endInfo.isAllDay,
        transparency: event.transparency ?? null,
        hangoutLink: event.hangoutLink ?? null,
      } satisfies AgentCalendarEvent;
    });

  return {
    calendarId,
    start: start.toISOString(),
    end: end.toISOString(),
    query,
    events,
    openSlots: computeOpenCalendarSlots({
      start,
      end,
      events,
    }),
  };
}

async function searchMailboxForAgent(
  gmail: ReturnType<typeof createGmailClient>,
  query: string,
  maxResults: number,
): Promise<AgentMailboxSearchResult[]> {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: Math.max(1, Math.min(maxResults, MAX_AGENT_SEARCH_RESULTS)),
    includeSpamTrash: false,
  });

  const messageIds = response.data.messages?.map((message) => message.id).filter(Boolean) as
    | string[]
    | undefined;

  if (!messageIds?.length) {
    return [];
  }

  const results = await Promise.all(
    messageIds.map(async (messageId) => {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const headers = message.data.payload?.headers ?? [];

      return {
        messageId,
        threadId: message.data.threadId ?? null,
        date: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : null,
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        subject: getHeader(headers, "Subject"),
        snippet: trimAgentText(message.data.snippet ?? null, 280),
        labelIds: message.data.labelIds ?? [],
      } satisfies AgentMailboxSearchResult;
    }),
  );

  return results;
}

async function searchAttachmentsForAgent(
  gmail: ReturnType<typeof createGmailClient>,
  query: string,
  maxResults: number,
): Promise<AgentAttachmentReference[]> {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: Math.max(1, Math.min(maxResults, MAX_AGENT_SEARCH_RESULTS)),
    includeSpamTrash: false,
  });

  const messageIds = response.data.messages?.map((message) => message.id).filter(Boolean) as
    | string[]
    | undefined;

  if (!messageIds?.length) {
    return [];
  }

  const attachments = await Promise.all(
    messageIds.map(async (messageId) => {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      const headers = message.data.payload?.headers ?? [];

      return collectAttachmentParts(message.data.payload).map((attachment) => ({
        ...attachment,
        messageId,
        threadId: message.data.threadId ?? null,
        date: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : null,
        from: getHeader(headers, "From"),
        subject: getHeader(headers, "Subject"),
      }));
    }),
  );

  return attachments.flat().slice(0, MAX_AGENT_SEARCH_RESULTS);
}

async function readMailboxMessageForAgent(
  gmail: ReturnType<typeof createGmailClient>,
  messageId: string,
): Promise<AgentMailboxMessage> {
  const message = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const headers = message.data.payload?.headers ?? [];

  return {
    messageId,
    threadId: message.data.threadId ?? null,
    date: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : null,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    snippet: trimAgentText(message.data.snippet ?? null, 280),
    labelIds: message.data.labelIds ?? [],
    text: trimAgentText(extractThreadText(message.data.payload), MAX_AGENT_MESSAGE_TEXT_CHARS),
    attachments: collectAttachmentParts(message.data.payload).map((attachment) => ({
      ...attachment,
      messageId,
      threadId: message.data.threadId ?? null,
      date: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : null,
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject"),
    })),
  };
}

async function fetchAttachmentForDraft(
  gmail: ReturnType<typeof createGmailClient>,
  attachment: {
    messageId: string;
    attachmentId: string;
    filename: string;
  },
) {
  const message = await gmail.users.messages.get({
    userId: "me",
    id: attachment.messageId,
    format: "full",
  });
  const matchedPart = collectAttachmentParts(message.data.payload).find(
    (part) => part.attachmentId === attachment.attachmentId,
  );

  if (!matchedPart) {
    throw new Error(`Attachment ${attachment.attachmentId} was not found on message ${attachment.messageId}`);
  }

  if (matchedPart.size > MAX_AGENT_ATTACHMENT_SIZE_BYTES) {
    throw new Error(
      `Attachment ${attachment.filename || matchedPart.filename} exceeds the ${Math.round(
        MAX_AGENT_ATTACHMENT_SIZE_BYTES / (1024 * 1024),
      )}MB limit`,
    );
  }

  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: attachment.messageId,
    id: attachment.attachmentId,
  });

  return {
    messageId: attachment.messageId,
    attachmentId: attachment.attachmentId,
    filename: attachment.filename || matchedPart.filename,
    mimeType: matchedPart.mimeType,
    size: matchedPart.size,
    data: response.data.data ?? "",
  };
}

function createTracedAgentTools(params: {
  gmail: ReturnType<typeof createGmailClient>;
  calendar: ReturnType<typeof createCalendarClient>;
}) {
  const { gmail, calendar } = params;
  return {
    readThread: traceableIfEnabled(
      async (threadId: string) => readThreadForAgent(gmail, threadId),
      {
        name: "Read current thread",
        run_type: "tool",
        tags: ["gmail-auto-responder", "agent", "gmail"],
        metadata: {
          tool: "read_thread",
        },
      },
    ),
    checkCalendarAvailability: traceableIfEnabled(
      async (input: {
        start: string;
        end: string;
        calendarId?: string;
        query?: string;
        maxResults?: number;
      }) => checkCalendarAvailabilityForAgent(calendar, input),
      {
        name: "Check calendar availability",
        run_type: "tool",
        tags: ["gmail-auto-responder", "agent", "calendar"],
        metadata: {
          tool: "check_calendar_availability",
        },
      },
    ),
    searchMailbox: traceableIfEnabled(
      async (query: string, maxResults: number) => searchMailboxForAgent(gmail, query, maxResults),
      {
        name: "Search mailbox context",
        run_type: "tool",
        tags: ["gmail-auto-responder", "agent", "gmail"],
        metadata: {
          tool: "search_mailbox",
        },
      },
    ),
    searchAttachments: traceableIfEnabled(
      async (query: string, maxResults: number) => searchAttachmentsForAgent(gmail, query, maxResults),
      {
        name: "Search prior attachments",
        run_type: "tool",
        tags: ["gmail-auto-responder", "agent", "gmail"],
        metadata: {
          tool: "search_attachments",
        },
      },
    ),
    readMessage: traceableIfEnabled(
      async (messageId: string) => readMailboxMessageForAgent(gmail, messageId),
      {
        name: "Read mailbox message",
        run_type: "tool",
        tags: ["gmail-auto-responder", "agent", "gmail"],
        metadata: {
          tool: "read_message",
        },
      },
    ),
  };
}

async function runAutonomousAgentImpl(params: {
  provider: "gemini";
  model: string;
  draftingRules: string[];
  candidates: Candidate[];
  readThread: (threadId: string) => ReturnType<typeof readThreadForAgent>;
  checkCalendarAvailability: (input: {
    start: string;
    end: string;
    calendarId?: string;
    query?: string;
    maxResults?: number;
  }) => Promise<AgentCalendarAvailability>;
  searchMailbox: (query: string, maxResults: number) => Promise<AgentMailboxSearchResult[]>;
  searchAttachments: (query: string, maxResults: number) => Promise<AgentAttachmentReference[]>;
  readMessage: (messageId: string) => Promise<AgentMailboxMessage>;
}) {
  const {
    provider,
    model,
    draftingRules,
    candidates,
    readThread,
    checkCalendarAvailability,
    searchMailbox,
    searchAttachments,
    readMessage,
  } = params;
  const inspected = new Set<string>();
  const contextMessagesRead = new Set<string>();
  const drafted = new Map<string, AgentDraftResult>();
  const decisions = new Map<string, Omit<AgentThreadRunResult, "costUsd">>();
  const attributedCostByThread = new Map<string, number>();
  let unattributedCostUsd = 0;
  let totalCostUsd = 0;
  let activeThreadId: string | null = null;
  const conversation: GeminiContent[] = [
    {
      role: "user",
      parts: [
        {
          text: JSON.stringify(
            {
              objective: "Review the user's eligible inbox activity and create useful reply drafts.",
              candidates,
              state: buildAgentStateSnapshot({
                inspected,
                contextMessagesRead,
                drafted,
                decisions,
              }),
            },
            null,
            2,
          ),
        },
      ],
    },
  ];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
    const response = await askGeminiFunctionCallWithUsage({
      model,
      system: `${AGENT_SYSTEM_PROMPT}\n${formatDraftingRules(draftingRules)}`,
      contents: conversation,
      functionDeclarations: AGENT_FUNCTION_DECLARATIONS,
      allowedFunctionNames: AGENT_FUNCTION_DECLARATIONS.flatMap((tool) =>
        typeof tool.name === "string" ? [tool.name] : [],
      ),
      maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
    });
    const action = {
      ...response.functionCall.args,
      action: response.functionCall.name,
    } as {
      action:
        | "read_thread"
        | "check_calendar_availability"
        | "search_mailbox"
        | "search_attachments"
        | "read_message"
        | "create_draft"
        | "skip_thread"
        | "finish";
      threadId?: string;
      messageId?: string;
      start?: string;
      end?: string;
      calendarId?: string;
      query?: string;
      maxResults?: number;
      draft?: string;
      attachments?: Array<{
        messageId: string;
        attachmentId: string;
        filename: string;
      }>;
      reason: string;
    };
    conversation.push(response.content);
    const turnCostUsd = response.estimatedCostUsd ?? 0;
    totalCostUsd += turnCostUsd;

    if (action.threadId) {
      activeThreadId = action.threadId;
    }

    if (turnCostUsd > 0) {
      const costThreadId = action.threadId ?? activeThreadId;
      if (costThreadId && candidates.some((candidate) => candidate.gmailThreadId === costThreadId)) {
        attributedCostByThread.set(costThreadId, (attributedCostByThread.get(costThreadId) ?? 0) + turnCostUsd);
      } else {
        unattributedCostUsd += turnCostUsd;
      }
    }

    addTraceEvent("agent_turn", {
      kwargs: {
        turn: turn + 1,
        action: action.action,
        threadId: action.threadId ?? null,
        messageId: action.messageId ?? null,
        start: action.start ?? null,
        end: action.end ?? null,
        calendarId: action.calendarId ?? null,
        query: action.query ?? null,
        reason: action.reason,
      },
    });

    if (action.action === "finish") {
      break;
    }

    if (action.action === "read_thread") {
      if (!action.threadId) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "read_thread",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid read_thread action without threadId.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const candidateExists = candidates.some((candidate) => candidate.gmailThreadId === action.threadId);
      if (!candidateExists) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "read_thread",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: `Ignored read_thread for unknown thread ${action.threadId}.`,
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const thread = await readThread(action.threadId);
      inspected.add(action.threadId);
      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "read_thread",
              id: response.functionCall.id,
              response: {
                ok: true,
                threadId: action.threadId,
                reason: action.reason,
                result: summarizeThreadForPrompt(thread),
                state: buildAgentStateSnapshot({
                  inspected,
                  contextMessagesRead,
                  drafted,
                  decisions,
                }),
              },
            },
          },
        ],
      });
      continue;
    }

    if (action.action === "check_calendar_availability") {
      const start = action.start?.trim();
      const end = action.end?.trim();

      if (!start || !end) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "check_calendar_availability",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid check_calendar_availability action without both start and end.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }

      try {
        const result = await checkCalendarAvailability({
          start,
          end,
          calendarId: action.calendarId?.trim() || "primary",
          query: action.query?.trim(),
          maxResults: action.maxResults,
        });
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "check_calendar_availability",
                id: response.functionCall.id,
                response: {
                  ok: true,
                  reason: action.reason,
                  result: summarizeCalendarAvailabilityForPrompt(result),
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
      } catch (error) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "check_calendar_availability",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
      }
      continue;
    }

    if (action.action === "search_mailbox") {
      const query = action.query?.trim();
      if (!query) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "search_mailbox",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid search_mailbox action without query.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const maxResults =
        typeof action.maxResults === "number" && Number.isFinite(action.maxResults)
          ? Math.max(1, Math.min(Math.floor(action.maxResults), MAX_AGENT_SEARCH_RESULTS))
          : 5;
      const results = await searchMailbox(query, maxResults);
      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "search_mailbox",
              id: response.functionCall.id,
              response: {
                ok: true,
                query,
                reason: action.reason,
                results: summarizeMailboxSearchResultsForPrompt(results),
                state: buildAgentStateSnapshot({
                  inspected,
                  contextMessagesRead,
                  drafted,
                  decisions,
                }),
              },
            },
          },
        ],
      });
      continue;
    }

    if (action.action === "search_attachments") {
      const query = action.query?.trim();
      if (!query) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "search_attachments",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid search_attachments action without query.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const maxResults =
        typeof action.maxResults === "number" && Number.isFinite(action.maxResults)
          ? Math.max(1, Math.min(Math.floor(action.maxResults), MAX_AGENT_SEARCH_RESULTS))
          : 5;
      const results = await searchAttachments(query, maxResults);
      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "search_attachments",
              id: response.functionCall.id,
              response: {
                ok: true,
                query,
                reason: action.reason,
                results: summarizeAttachmentResultsForPrompt(results),
                state: buildAgentStateSnapshot({
                  inspected,
                  contextMessagesRead,
                  drafted,
                  decisions,
                }),
              },
            },
          },
        ],
      });
      continue;
    }

    if (action.action === "read_message") {
      if (!action.messageId) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "read_message",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid read_message action without messageId.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      if (contextMessagesRead.has(action.messageId)) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "read_message",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: `Mailbox message ${action.messageId} was already read in this run.`,
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      if (contextMessagesRead.size >= MAX_AGENT_CONTEXT_MESSAGES) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "read_message",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: `Mailbox context read budget reached (${MAX_AGENT_CONTEXT_MESSAGES} messages).`,
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const message = await readMessage(action.messageId);
      contextMessagesRead.add(action.messageId);
      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "read_message",
              id: response.functionCall.id,
              response: {
                ok: true,
                messageId: action.messageId,
                reason: action.reason,
                result: summarizeMailboxMessageForPrompt(message),
                state: buildAgentStateSnapshot({
                  inspected,
                  contextMessagesRead,
                  drafted,
                  decisions,
                }),
              },
            },
          },
        ],
      });
      continue;
    }

    if (action.action === "skip_thread") {
      if (!action.threadId) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "skip_thread",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid skip_thread action without threadId.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const candidateExists = candidates.some((candidate) => candidate.gmailThreadId === action.threadId);
      if (!candidateExists) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "skip_thread",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: `Ignored skip_thread for unknown thread ${action.threadId}.`,
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      decisions.set(action.threadId, { decision: "skipped", reason: action.reason });
      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "skip_thread",
              id: response.functionCall.id,
              response: {
                ok: true,
                threadId: action.threadId,
                reason: action.reason,
                state: buildAgentStateSnapshot({
                  inspected,
                  contextMessagesRead,
                  drafted,
                  decisions,
                }),
              },
            },
          },
        ],
      });
      if (decisions.size >= candidates.length) {
        break;
      }
      continue;
    }

    if (action.action === "create_draft") {
      if (!action.threadId) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "create_draft",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: "Ignored invalid create_draft action without threadId.",
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const candidateExists = candidates.some((candidate) => candidate.gmailThreadId === action.threadId);
      if (!candidateExists) {
        conversation.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "create_draft",
                id: response.functionCall.id,
                response: {
                  ok: false,
                  error: `Ignored create_draft for unknown thread ${action.threadId}.`,
                  state: buildAgentStateSnapshot({
                    inspected,
                    contextMessagesRead,
                    drafted,
                    decisions,
                  }),
                },
              },
            },
          ],
        });
        continue;
      }
      const thread = inspected.has(action.threadId) ? await readThread(action.threadId) : null;
      drafted.set(action.threadId, {
        draft: action.draft ?? "",
        reason: action.reason,
        thread,
        attachments: (action.attachments ?? []).slice(0, MAX_AGENT_ATTACHMENTS_PER_DRAFT),
      });
      decisions.set(action.threadId, { decision: "drafted", reason: action.reason });
      conversation.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "create_draft",
              id: response.functionCall.id,
              response: {
                ok: true,
                threadId: action.threadId,
                reason: action.reason,
                draft: trimAgentText(action.draft, 800),
                attachmentCount: (action.attachments ?? []).length,
                state: buildAgentStateSnapshot({
                  inspected,
                  contextMessagesRead,
                  drafted,
                  decisions,
                }),
              },
            },
          },
        ],
      });
      if (decisions.size >= candidates.length) {
        break;
      }
    }
  }

  mergeTraceMetadata({
    contextMessagesRead: contextMessagesRead.size,
    draftedCount: drafted.size,
    inspectedThreadCount: inspected.size,
  });

  return {
    drafted,
    threadResults: allocateThreadCosts({
      candidateThreadIds: candidates.map((candidate) => candidate.gmailThreadId),
      attributedCostByThread,
      unattributedCostUsd,
      decisions,
    }),
    totalCostUsd: roundCurrency(totalCostUsd),
  } satisfies AutonomousAgentRunResult;
}

export const runAutonomousAgent = traceableIfEnabled(runAutonomousAgentImpl, {
  name: "Autonomous draft agent",
  run_type: "chain",
  tags: ["gmail-auto-responder", "agent"],
  metadata: {
    component: "gmail-sync",
  },
  processInputs: (params) => ({
    provider: params.provider,
    model: params.model,
    draftingRules: params.draftingRules,
    candidateCount: params.candidates.length,
    candidates: params.candidates.map((candidate) => ({
      gmailThreadId: candidate.gmailThreadId,
      subject: candidate.subject,
      fromEmail: candidate.fromEmail,
      latestMessageAt: candidate.latestMessageAt,
      hasUnread: candidate.hasUnread,
    })),
  }),
  processOutputs: (outputs) => ({
    ...(() => {
      const draftedEntries = (
        outputs &&
        typeof outputs === "object" &&
        "drafted" in outputs &&
        outputs.drafted instanceof Map
          ? [...outputs.drafted.entries()]
          : []
      ) as Array<
        [
          string,
          {
            draft: string;
            reason: string;
            thread: Awaited<ReturnType<typeof readThreadForAgent>> | null;
            attachments: Array<{
              messageId: string;
              attachmentId: string;
              filename: string;
            }>;
          },
        ]
      >;

      return {
        draftedCount: draftedEntries.length,
        draftedThreads: draftedEntries.map(([threadId, value]) => ({
          threadId,
          reason: value.reason,
          draftPreview: value.draft.slice(0, 280),
          threadRead: Boolean(value.thread),
          attachments: value.attachments,
        })),
        totalCostUsd:
          outputs &&
          typeof outputs === "object" &&
          "totalCostUsd" in outputs &&
          typeof outputs.totalCostUsd === "number"
            ? outputs.totalCostUsd
            : 0,
      };
    })(),
  }),
});

async function upsertThread(userId: string, candidate: Candidate) {
  const existing = await db.query.emailThreads.findFirst({
    where: and(eq(emailThreads.userId, userId), eq(emailThreads.gmailThreadId, candidate.gmailThreadId)),
  });

  if (existing) {
    const [updated] = await db
      .update(emailThreads)
      .set({
        gmailHistoryId: candidate.gmailHistoryId,
        subject: candidate.subject,
        snippet: candidate.snippet,
        fromEmail: candidate.fromEmail,
        fromName: candidate.fromName,
        lastMessageAt: candidate.latestMessageAt ? new Date(candidate.latestMessageAt) : null,
        hasUnread: candidate.hasUnread,
        inPrimary: true,
        latestMessageId: candidate.latestMessageId,
      })
      .where(eq(emailThreads.id, existing.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(emailThreads)
    .values({
      id: createId("thread"),
      userId,
      gmailThreadId: candidate.gmailThreadId,
      gmailHistoryId: candidate.gmailHistoryId,
      subject: candidate.subject,
      snippet: candidate.snippet,
      fromEmail: candidate.fromEmail,
      fromName: candidate.fromName,
      lastMessageAt: candidate.latestMessageAt ? new Date(candidate.latestMessageAt) : null,
      hasUnread: candidate.hasUnread,
      inPrimary: true,
      latestMessageId: candidate.latestMessageId,
    })
    .returning();

  return inserted;
}

async function updateThreadSelectionStatuses(params: {
  userId: string;
  threadIds: string[];
  status: string | null;
  reason: string | null;
}) {
  const { userId, threadIds, status, reason } = params;
  if (threadIds.length === 0) {
    return;
  }

  await db
    .update(emailThreads)
    .set({
      selectionStatus: status,
      selectionReason: reason,
    })
    .where(and(eq(emailThreads.userId, userId), inArray(emailThreads.id, threadIds)));
}

async function persistThreadMessages(params: {
  threadRecordId: string;
  thread: Awaited<ReturnType<typeof readThreadForAgent>>;
  accountEmail: string | null;
}) {
  const { threadRecordId, thread, accountEmail } = params;
  for (const message of thread.messages) {
    const existing = await db.query.emailMessages.findFirst({
      where: eq(emailMessages.gmailMessageId, message.gmailMessageId),
    });

    if (existing) continue;

    await db.insert(emailMessages).values({
      id: createId("msg"),
      threadId: threadRecordId,
      gmailMessageId: message.gmailMessageId,
      gmailInternalDate: message.date ? new Date(message.date) : null,
      direction:
        accountEmail && message.from?.toLowerCase().includes(accountEmail.toLowerCase())
          ? "outbound"
          : "inbound",
      fromEmail: message.from,
      toEmails: message.to,
      subject: message.subject,
      textBody: message.text,
      headersJson: {
        from: message.from ?? "",
        to: message.to ?? "",
        subject: message.subject ?? "",
        messageId: message.messageId ?? "",
        references: message.references ?? "",
      },
      bodyLoaded: true,
    });
  }
}

async function processCandidateThread(params: {
  userId: string;
  runId: string;
  account: typeof gmailAccounts.$inferSelect;
  settings: typeof userSettings.$inferSelect;
  gmail: ReturnType<typeof createGmailClient>;
  tools: ReturnType<typeof createTracedAgentTools>;
  candidate: Candidate;
  threadRecord: typeof emailThreads.$inferSelect;
  autodraftBatchId: string | null;
}) {
  const { userId, runId, account, settings, gmail, tools, candidate, threadRecord, autodraftBatchId } = params;
  const prefetchedThread = await readThreadForAgent(gmail, candidate.gmailThreadId);
  const processingPreview = deriveProcessingPreview(prefetchedThread) ?? candidate.snippet ?? null;

  await db
    .update(emailThreads)
    .set({
      snippet: processingPreview,
      latestMessageId:
        prefetchedThread.messages.at(-1)?.gmailMessageId ?? threadRecord.latestMessageId ?? candidate.latestMessageId,
      lastMessageAt:
        prefetchedThread.messages.at(-1)?.date
          ? new Date(prefetchedThread.messages.at(-1)?.date ?? "")
          : threadRecord.lastMessageAt,
    })
    .where(eq(emailThreads.id, threadRecord.id));

  await updateThreadSelectionStatuses({
    userId,
    threadIds: [threadRecord.id],
    status: "processing",
    reason: "Reviewing the latest messages and generating a reply draft.",
  });

  try {
    const agentRun = await runAutonomousAgent({
      provider: settings.agentProvider,
      model: settings.agentModel,
      draftingRules: settings.draftingRules,
      candidates: [candidate],
      readThread: async (threadId: string) =>
        threadId === candidate.gmailThreadId ? prefetchedThread : tools.readThread(threadId),
      checkCalendarAvailability: tools.checkCalendarAvailability,
      searchMailbox: tools.searchMailbox,
      searchAttachments: tools.searchAttachments,
      readMessage: tools.readMessage,
    });

    const draftedResult = agentRun.drafted.get(candidate.gmailThreadId);
    const threadResult = agentRun.threadResults.get(candidate.gmailThreadId) ?? {
      decision: draftedResult ? ("drafted" as const) : ("skipped" as const),
      reason: draftedResult?.reason ?? "Reviewed during sync, but no draft was created.",
      costUsd: agentRun.totalCostUsd,
    };

    if (draftedResult) {
      const fullThread = draftedResult.thread ?? (await readThreadForAgent(gmail, candidate.gmailThreadId));
      await persistThreadMessages({
        threadRecordId: threadRecord.id,
        thread: fullThread,
        accountEmail: account.googleEmail ?? null,
      });

      const lastMessage = fullThread.messages.at(-1);
      if (lastMessage?.from) {
        const to = parseFromHeader(lastMessage.from).email ?? lastMessage.from;
        const resolvedAttachments = (
          await Promise.allSettled(
            (draftedResult.attachments ?? []).slice(0, MAX_AGENT_ATTACHMENTS_PER_DRAFT).map((attachment) =>
              fetchAttachmentForDraft(gmail, attachment),
            ),
          )
        )
          .flatMap((outcome) => {
            if (outcome.status === "fulfilled") {
              return [outcome.value];
            }

            logger.warn("Skipped invalid agent attachment", {
              userId,
              gmailThreadId: candidate.gmailThreadId,
              errorMessage: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            });
            return [];
          });

        const raw = buildReplyRaw({
          to,
          subject: lastMessage.subject ?? threadRecord.subject ?? "(no subject)",
          messageId: lastMessage.messageId,
          references: lastMessage.references,
          body: draftedResult.draft,
          attachments: resolvedAttachments.map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            data: attachment.data,
          })),
        });

        const existingDraft = await db.query.draftReplies.findFirst({
          where: eq(draftReplies.threadId, threadRecord.id),
          orderBy: [desc(draftReplies.createdAt)],
        });

        const gmailDraft = existingDraft?.gmailDraftId
          ? await gmail.users.drafts.update({
              userId: "me",
              id: existingDraft.gmailDraftId,
              requestBody: {
                message: {
                  raw,
                  threadId: candidate.gmailThreadId,
                },
              },
            })
          : await gmail.users.drafts.create({
              userId: "me",
              requestBody: {
                message: {
                  raw,
                  threadId: candidate.gmailThreadId,
                },
              },
            });

        const selectionContextJson = {
          reason: draftedResult.reason,
          ruleSnapshot: settings.draftingRules,
          attachments: resolvedAttachments.map((attachment) => ({
            messageId: attachment.messageId,
            attachmentId: attachment.attachmentId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })),
        };

        if (existingDraft) {
          await db
            .update(draftReplies)
            .set({
              gmailDraftId: gmailDraft.data.id ?? existingDraft.gmailDraftId,
              autodraftBatchId: autodraftBatchId ?? existingDraft.autodraftBatchId ?? null,
              generatedText: draftedResult.draft,
              selectionContextJson,
              status: "drafted",
              lastSyncedAt: new Date(),
            })
            .where(eq(draftReplies.id, existingDraft.id));
        } else {
          await db.insert(draftReplies).values({
            id: createId("draft"),
            userId,
            threadId: threadRecord.id,
            gmailDraftId: gmailDraft.data.id ?? null,
            autodraftBatchId,
            generatedText: draftedResult.draft,
            selectionContextJson,
            decisionProvider: settings.agentProvider,
            decisionModel: settings.agentModel,
            generationProvider: settings.agentProvider,
            generationModel: settings.agentModel,
            sourceMessageId: lastMessage.gmailMessageId,
            status: "drafted",
            lastSyncedAt: new Date(),
          });
        }
      }
    }

    await db
      .update(emailThreads)
      .set({
        selectionStatus: draftedResult ? "drafted" : "skipped",
        selectionReason: threadResult.reason,
      })
      .where(eq(emailThreads.id, threadRecord.id));

    await db.insert(threadRunResults).values({
      syncRunId: runId,
      threadId: threadRecord.id,
      decision: draftedResult ? "drafted" : "skipped",
      reason: threadResult.reason,
      costUsd: formatCostUsd(threadResult.costUsd),
    });

    return {
      drafted: Boolean(draftedResult),
      costUsd: threadResult.costUsd,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db
      .update(emailThreads)
      .set({
        selectionStatus: "error",
        selectionReason: errorMessage,
      })
      .where(eq(emailThreads.id, threadRecord.id));

    await db.insert(threadRunResults).values({
      syncRunId: runId,
      threadId: threadRecord.id,
      decision: "error",
      reason: errorMessage,
      costUsd: formatCostUsd(0),
    });

    logger.error("Thread processing failed", {
      userId,
      runId,
      gmailThreadId: candidate.gmailThreadId,
      errorMessage,
    });

    return {
      drafted: false,
      costUsd: 0,
    };
  }
}

async function syncUserAccountUnlocked(
  userId: string,
  options?: {
    runType?: string;
    lookbackOverride?: string;
    forceFreshWindow?: boolean;
  },
): Promise<SyncRunResult> {
  const runType = options?.runType ?? "manual";
  const runId = createId("sync");
  await db.insert(syncRuns).values({
    id: runId,
    userId,
    runType,
    status: "running",
  });

  try {
    const account = await db.query.gmailAccounts.findFirst({
      where: eq(gmailAccounts.userId, userId),
    });
    const settings = await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });

    if (!account || !settings || !settings.autodraftEnabled) {
      if (account && settings && !settings.autodraftEnabled) {
        await db
          .update(gmailAccounts)
          .set({
            syncStatus: "paused",
            lastSyncError: null,
            lastSyncAttemptAt: new Date(),
          })
          .where(eq(gmailAccounts.userId, userId));
      }
      await db
        .update(syncRuns)
        .set({ status: "skipped", finishedAt: new Date() })
        .where(eq(syncRuns.id, runId));
      return {
        emailsFound: 0,
        draftsCreated: 0,
      };
    }

    if (
      runType === "scheduled" &&
      !account.initialSyncStartedAt &&
      !account.initialSyncCompletedAt
    ) {
      await db
        .update(syncRuns)
        .set({ status: "skipped", finishedAt: new Date() })
        .where(eq(syncRuns.id, runId));
      return {
        emailsFound: 0,
        draftsCreated: 0,
      };
    }

    const normalizedModel = normalizeAgentModel(settings.agentProvider, settings.agentModel);
    if (normalizedModel !== settings.agentModel) {
      await db
        .update(userSettings)
        .set({ agentModel: normalizedModel })
        .where(eq(userSettings.userId, userId));
      settings.agentModel = normalizedModel;
    }

    await db
      .update(gmailAccounts)
      .set({
        lastSyncAttemptAt: new Date(),
        syncStatus: "syncing",
        lastSyncError: null,
      })
      .where(eq(gmailAccounts.userId, userId));

    await db
      .update(emailThreads)
      .set({
        selectionStatus: null,
        selectionReason: null,
      })
      .where(and(eq(emailThreads.userId, userId), eq(emailThreads.selectionStatus, "processing")));

    logger.info("Starting Gmail sync", {
      userId,
      runId,
      runType,
      lookback: options?.lookbackOverride ?? settings.initialAutodraftLookback,
      provider: settings.agentProvider,
      model: settings.agentModel,
    });

    const lookback = options?.lookbackOverride ?? settings.initialAutodraftLookback;
    const autodraftBatchId = isAutodraftRunType(runType) ? runId : null;
    const { gmail, candidates, windowStart, latestHistoryId } = await fetchCandidatesWithOptions(
      account,
      lookback,
      {
        forceFreshWindow: options?.forceFreshWindow ?? false,
      },
    );

    const threadRecords = await Promise.all(candidates.map((candidate) => upsertThread(userId, candidate)));
    const threadRecordByGmailThreadId = new Map(
      threadRecords.map((threadRecord) => [threadRecord.gmailThreadId, threadRecord]),
    );
    const calendar = createAccountCalendarClient(account);
    const agentTools = createTracedAgentTools({ gmail, calendar });

    if (runType === "redo_autodraft" && threadRecords.length > 0) {
      await clearDraftRepliesForThreadIds(
        userId,
        threadRecords.map((threadRecord) => threadRecord.id),
      );
    }

    await db
      .update(syncRuns)
      .set({
        windowStart,
        threadsScanned: String(candidates.length),
      })
      .where(eq(syncRuns.id, runId));

    let draftsCreated = 0;
    let totalCostUsd = 0;
    let nextIndex = 0;

    const workerCount = Math.min(THREAD_PROCESSING_POOL_SIZE, candidates.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= candidates.length) {
            return;
          }

          const candidate = candidates[currentIndex];
          const threadRecord = threadRecordByGmailThreadId.get(candidate.gmailThreadId);
          if (!threadRecord) {
            continue;
          }

          const result = await processCandidateThread({
            userId,
            runId,
            account,
            settings,
            gmail,
            tools: agentTools,
            candidate,
            threadRecord,
            autodraftBatchId,
          });

          if (result.drafted) {
            draftsCreated += 1;
          }
          totalCostUsd += result.costUsd;
        }
      }),
    );

    await db
      .update(gmailAccounts)
      .set({
        lastSyncAttemptAt: new Date(),
        lastPolledAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastHistoryId: latestHistoryId,
        syncStatus: "synced",
        lastSyncError: null,
        initialSyncStartedAt: account.initialSyncStartedAt ?? new Date(),
        initialSyncCompletedAt: new Date(),
      })
      .where(eq(gmailAccounts.userId, userId));

    await db
      .update(syncRuns)
      .set({
        status: "completed",
        windowStart,
        windowEnd: new Date(),
        threadsScanned: String(candidates.length),
        threadsSelected: String(candidates.length),
        draftsCreated: String(draftsCreated),
        totalCostUsd: formatCostUsd(totalCostUsd),
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, runId));

    logger.info("Completed Gmail sync", {
      userId,
      runId,
      candidates: candidates.length,
      drafted: draftsCreated,
      draftsCreated,
      latestHistoryId,
    });

    return {
      emailsFound: candidates.length,
      draftsCreated,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db
      .update(emailThreads)
      .set({
        selectionStatus: null,
        selectionReason: null,
      })
      .where(and(eq(emailThreads.userId, userId), eq(emailThreads.selectionStatus, "processing")));

    await db
      .update(gmailAccounts)
      .set({
        lastSyncAttemptAt: new Date(),
        syncStatus: "error",
        lastSyncError: errorMessage,
      })
      .where(eq(gmailAccounts.userId, userId));

    await db
      .update(syncRuns)
      .set({
        status: "failed",
        errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, runId));
    logger.error("Gmail sync failed", {
      userId,
      runId,
      errorMessage,
    });
    throw error;
  }
}

export async function syncUserAccount(
  userId: string,
  options?: {
    runType?: string;
    lookbackOverride?: string;
    forceFreshWindow?: boolean;
  },
) {
  return withUserSyncLock(userId, () => syncUserAccountUnlocked(userId, options));
}

export async function syncAllAccounts() {
  const accounts = await db.select({ userId: gmailAccounts.userId }).from(gmailAccounts);
  for (const account of accounts) {
    try {
      await syncUserAccount(account.userId, { runType: "scheduled" });
    } catch (error) {
      logger.error("Background sync failed", {
        userId: account.userId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function cleanupOldSyncRuns() {
  const retentionCutoff = new Date(
    Date.now() - SYNC_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const staleRuns = await db
    .select({
      id: syncRuns.id,
      userId: syncRuns.userId,
    })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "running"), lt(syncRuns.startedAt, retentionCutoff)));

  if (staleRuns.length > 0) {
    const staleRunIds = [...new Set(staleRuns.map((run) => run.id))];
    const staleUserIds = [...new Set(staleRuns.map((run) => run.userId))];
    const now = new Date();

    await db
      .update(syncRuns)
      .set({
        status: "failed",
        errorMessage: STALE_SYNC_RUN_ERROR_MESSAGE,
        finishedAt: now,
      })
      .where(and(eq(syncRuns.status, "running"), inArray(syncRuns.id, staleRunIds)));

    await db
      .update(gmailAccounts)
      .set({
        syncStatus: "error",
        lastSyncError: STALE_SYNC_RUN_ERROR_MESSAGE,
        lastSyncAttemptAt: now,
      })
      .where(inArray(gmailAccounts.userId, staleUserIds));

    await db
      .update(emailThreads)
      .set({
        selectionStatus: null,
        selectionReason: null,
      })
      .where(
        and(
          inArray(emailThreads.userId, staleUserIds),
          eq(emailThreads.selectionStatus, "processing"),
        ),
      );

    logger.warn("Marked stale running sync runs as failed during retention cleanup", {
      staleRunCount: staleRuns.length,
      staleUserCount: staleUserIds.length,
      staleRunIds,
    });
  }

  const deletedRunsResult = await db.execute<{
    deleted_count: string | number;
  }>(sql`
      WITH deleted_runs AS (
        DELETE FROM sync_runs
        WHERE started_at < ${retentionCutoff}
          AND status <> 'running'
        RETURNING id
      )
      SELECT count(*)::int AS deleted_count
      FROM deleted_runs;
    `);

  const deletedRunCount = Number(deletedRunsResult?.[0]?.deleted_count ?? 0);

  if (deletedRunCount > 0) {
    logger.info("Deleted old sync runs", {
      deletedRunCount,
      retentionDays: SYNC_RUN_RETENTION_DAYS,
      retentionCutoff: retentionCutoff.toISOString(),
    });
  } else {
    logger.info("Sync run retention job did not delete any rows", {
      retentionDays: SYNC_RUN_RETENTION_DAYS,
    });
  }

  return {
    staleRunCount: staleRuns.length,
    deletedRunCount,
  };
}

export async function listRecentDrafts(userId: string) {
  const userRunIds = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(eq(syncRuns.userId, userId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(MAX_RECENT_REVIEWS);

  const runIds = userRunIds.map((run) => run.id);
  if (runIds.length === 0) {
    return [];
  }

  const recentResults = await db.query.threadRunResults.findMany({
    where: inArray(threadRunResults.syncRunId, runIds),
    orderBy: [desc(threadRunResults.createdAt)],
    // Pull more than the display cap so repeated results for the same thread
    // do not crowd out other recent reviews.
    limit: MAX_RECENT_REVIEWS * 2,
  });

  const latestResultsByThread = new Map<string, (typeof recentResults)[number]>();
  for (const result of recentResults) {
    if (!latestResultsByThread.has(result.threadId)) {
      latestResultsByThread.set(result.threadId, result);
    }
    if (latestResultsByThread.size >= MAX_RECENT_REVIEWS) {
      break;
    }
  }

  const threadIds = Array.from(latestResultsByThread.keys());
  if (threadIds.length === 0) {
    return [];
  }

  const [threads, drafts] = await Promise.all([
    db.query.emailThreads.findMany({ where: inArray(emailThreads.id, threadIds) }),
    db.query.draftReplies.findMany({
      where: and(eq(draftReplies.userId, userId), inArray(draftReplies.threadId, threadIds)),
      orderBy: [desc(draftReplies.generatedAt)],
    }),
  ]);

  const latestDraftByThread = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    if (!latestDraftByThread.has(draft.threadId)) {
      latestDraftByThread.set(draft.threadId, draft);
    }
  }

  return threadIds.map((threadId) => {
    const result = latestResultsByThread.get(threadId);
    const thread = threads.find((item) => item.id === threadId);
    const draft = latestDraftByThread.get(threadId) ?? null;
    const attachments =
      ((draft?.selectionContextJson as { attachments?: Array<Record<string, unknown>> } | null)?.attachments ?? [])
        .map((attachment) => ({
          messageId: String(attachment.messageId ?? ""),
          attachmentId: String(attachment.attachmentId ?? ""),
          filename: String(attachment.filename ?? ""),
          mimeType: attachment.mimeType ? String(attachment.mimeType) : null,
          size:
            typeof attachment.size === "number"
              ? attachment.size
              : Number.isFinite(Number(attachment.size))
                ? Number(attachment.size)
                : null,
        }));

    return {
      id: draft?.id ?? `review_${threadId}`,
      threadId,
      subject: thread?.subject ?? "",
      fromName: thread?.fromName ?? null,
      fromEmail: thread?.fromEmail ?? null,
      latestMessageAt:
        thread?.lastMessageAt?.toISOString() ??
        draft?.generatedAt.toISOString() ??
        result?.createdAt.toISOString() ??
        new Date().toISOString(),
      selectionReason: result?.reason ?? thread?.selectionReason ?? null,
      attachments,
      generatedText: draft?.generatedText ?? null,
      gmailDraftId: draft?.gmailDraftId ?? null,
      gmailThreadId: thread?.gmailThreadId ?? "",
      decision: result?.decision ?? "error",
      hasDraft: Boolean(draft),
    };
  });
}

export async function listProcessingThreads(userId: string) {
  const threads = await db.query.emailThreads.findMany({
    where: and(eq(emailThreads.userId, userId), eq(emailThreads.selectionStatus, "processing")),
    orderBy: [desc(emailThreads.lastMessageAt), desc(emailThreads.updatedAt)],
    limit: 20,
  });

  return threads.map((thread) => {
    return {
      id: thread.id,
      threadId: thread.id,
      subject: thread.subject ?? "",
      fromName: thread.fromName ?? null,
      fromEmail: thread.fromEmail ?? null,
      latestMessageAt: thread.lastMessageAt?.toISOString() ?? thread.updatedAt.toISOString(),
      snippet: thread.snippet ?? null,
      gmailThreadId: thread.gmailThreadId,
    };
  });
}

export async function getCurrentSyncProgress(userId: string): Promise<SyncProgress | null> {
  const run = await db.query.syncRuns.findFirst({
    where: and(eq(syncRuns.userId, userId), eq(syncRuns.status, "running")),
    orderBy: [desc(syncRuns.startedAt)],
  });

  if (!run) {
    return null;
  }

  const [completedRows, activeThreads] = await Promise.all([
    db.query.threadRunResults.findMany({
      where: eq(threadRunResults.syncRunId, run.id),
    }),
    db.query.emailThreads.findMany({
      where: and(eq(emailThreads.userId, userId), eq(emailThreads.selectionStatus, "processing")),
    }),
  ]);

  return {
    total: Number(run.threadsScanned ?? 0),
    completed: completedRows.length,
    active: activeThreads.length,
  };
}
