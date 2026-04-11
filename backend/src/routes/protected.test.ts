import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureLocalUser = vi.fn();
const signState = vi.fn();
const buildConsentUrl = vi.fn();
const syncUserAccount = vi.fn();
const listRecentDrafts = vi.fn();
const listProcessingThreads = vi.fn();
const getCurrentSyncProgress = vi.fn();
const clearAutodraftBatch = vi.fn();
const clearAutodraftThread = vi.fn();
const clearAutodraftWindow = vi.fn();
const redoAutodraftBatch = vi.fn();
const redoAutodraftThread = vi.fn();

const userSettingsFindFirst = vi.fn();
const gmailAccountsFindFirst = vi.fn();
const updateReturning = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn();
const deleteWhere = vi.fn();

vi.mock("../lib/env.js", () => ({
  env: {
    FRONTEND_URL: "http://localhost:5173",
  },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/users.js", () => ({
  ensureLocalUser,
}));

vi.mock("../lib/crypto.js", () => ({
  signState,
}));

vi.mock("../gmail/client.js", () => ({
  buildConsentUrl,
}));

vi.mock("../services/gmail-sync.js", () => ({
  syncUserAccount,
  listRecentDrafts,
  listProcessingThreads,
  getCurrentSyncProgress,
  clearAutodraftBatch,
  clearAutodraftThread,
  clearAutodraftWindow,
  redoAutodraftBatch,
  redoAutodraftThread,
}));

vi.mock("../db/client.js", () => ({
  db: {
    query: {
      userSettings: { findFirst: userSettingsFindFirst },
      gmailAccounts: { findFirst: gmailAccountsFindFirst },
    },
    update: vi.fn(() => ({ set: updateSet })),
    delete: vi.fn(() => ({ where: deleteWhere })),
  },
}));

describe("protected routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T06:35:17.000Z"));
    vi.resetModules();
    vi.clearAllMocks();

    ensureLocalUser.mockResolvedValue({
      id: "user_123",
      email: "person@example.com",
    });
    syncUserAccount.mockResolvedValue({
      emailsFound: 0,
      draftsCreated: 0,
    });

    updateSet.mockImplementation(() => ({
      where: updateWhere,
      returning: updateReturning,
    }));
    updateWhere.mockResolvedValue(undefined);
    updateReturning.mockResolvedValue([
      {
        draftingRules: ["Prompt"],
        agentProvider: "gemini",
        agentModel: "gemini-3-flash-preview",
        initialAutodraftLookback: "3d",
        autodraftEnabled: true,
      },
    ]);
    deleteWhere.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Gmail status for the signed-in user", async () => {
    gmailAccountsFindFirst.mockResolvedValue({
      googleEmail: "person@gmail.com",
      syncStatus: "synced",
      lastSyncError: null,
      lastSuccessfulSyncAt: new Date("2026-04-07T06:00:00.000Z"),
      lastPolledAt: new Date("2026-04-07T06:01:00.000Z"),
      initialSyncStartedAt: new Date("2026-04-07T06:00:00.000Z"),
      initialSyncCompletedAt: new Date("2026-04-07T06:00:30.000Z"),
    });

    const { createApp } = await import("../app.js");
    const response = await request(createApp()).get("/api/gmail/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      gmail: {
        connected: true,
        googleEmail: "person@gmail.com",
        syncStatus: "synced",
        lastSyncError: null,
        lastSuccessfulSyncAt: "2026-04-07T06:00:00.000Z",
        lastSyncAttemptAt: null,
        lastPolledAt: "2026-04-07T06:01:00.000Z",
        needsInitialProcessingChoice: false,
      },
    });
  });

  it("starts Gmail connect flow without requiring a subscription row", async () => {
    buildConsentUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?foo=bar");
    signState.mockReturnValue("signed-state");

    const { createApp } = await import("../app.js");
    const response = await request(createApp())
      .post("/api/gmail/connect/start")
      .send({});

    expect(response.status).toBe(200);
    expect(signState).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        lookback: null,
      }),
    );
    expect(buildConsentUrl).toHaveBeenCalledWith("signed-state");
    expect(response.body).toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?foo=bar",
    });
  });

  it("runs initial processing with the selected lookback", async () => {
    const { createApp } = await import("../app.js");
    const response = await request(createApp())
      .post("/api/gmail/initial-processing")
      .send({ lookback: "3d" });

    expect(response.status).toBe(200);
    expect(syncUserAccount).toHaveBeenCalledWith("user_123", {
      runType: "oauth_connect",
      lookbackOverride: "3d",
      forceFreshWindow: true,
    });
    expect(response.body).toEqual({ ok: true });
  });

  it("marks skip-initial-processing as synced immediately", async () => {
    const { createApp } = await import("../app.js");
    const response = await request(createApp())
      .post("/api/gmail/initial-processing/skip")
      .send({});

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith({
      initialSyncStartedAt: new Date("2026-04-10T06:35:17.000Z"),
      initialSyncCompletedAt: new Date("2026-04-10T06:35:17.000Z"),
      lastSyncAttemptAt: new Date("2026-04-10T06:35:17.000Z"),
      lastPolledAt: new Date("2026-04-10T06:35:17.000Z"),
      lastSuccessfulSyncAt: new Date("2026-04-10T06:35:17.000Z"),
      syncStatus: "synced",
      lastSyncError: null,
    });
    expect(response.body).toEqual({ ok: true });
  });

  it("runs a manual resync for the current user", async () => {
    syncUserAccount.mockResolvedValue({
      emailsFound: 1,
      draftsCreated: 1,
    });

    const { createApp } = await import("../app.js");
    const response = await request(createApp()).post("/api/gmail/resync").send({});

    expect(response.status).toBe(200);
    expect(syncUserAccount).toHaveBeenCalledWith("user_123", { runType: "manual" });
    expect(response.body).toEqual({
      ok: true,
      emailsFound: 1,
      draftsCreated: 1,
    });
  });

  it("returns drafts together with currently processing threads and sync progress", async () => {
    listRecentDrafts.mockResolvedValue([
      {
        id: "draft_123",
        threadId: "thread_123",
        subject: "Draft subject",
        fromName: "Alex",
        fromEmail: "alex@example.com",
        latestMessageAt: "2026-04-07T10:00:00.000Z",
        selectionReason: "Helpful reply ready",
        generatedText: "Draft body",
        attachments: [],
        gmailDraftId: "gmail_draft_123",
        gmailThreadId: "gmail_thread_123",
      },
    ]);
    listProcessingThreads.mockResolvedValue([
      {
        id: "thread_456",
        threadId: "thread_456",
        subject: "Processing subject",
        fromName: "Jordan",
        fromEmail: "jordan@example.com",
        latestMessageAt: "2026-04-07T10:05:00.000Z",
        snippet: "Processing preview",
        gmailThreadId: "gmail_thread_456",
      },
    ]);
    getCurrentSyncProgress.mockResolvedValue({
      total: 5,
      completed: 2,
      active: 1,
    });

    const { createApp } = await import("../app.js");
    const response = await request(createApp()).get("/api/drafts");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      drafts: [
        {
          id: "draft_123",
          threadId: "thread_123",
          subject: "Draft subject",
          fromName: "Alex",
          fromEmail: "alex@example.com",
          latestMessageAt: "2026-04-07T10:00:00.000Z",
          selectionReason: "Helpful reply ready",
          generatedText: "Draft body",
          attachments: [],
          gmailDraftId: "gmail_draft_123",
          gmailThreadId: "gmail_thread_123",
        },
      ],
      processingThreads: [
        {
          id: "thread_456",
          threadId: "thread_456",
          subject: "Processing subject",
          fromName: "Jordan",
          fromEmail: "jordan@example.com",
          latestMessageAt: "2026-04-07T10:05:00.000Z",
          snippet: "Processing preview",
          gmailThreadId: "gmail_thread_456",
        },
      ],
      syncProgress: {
        total: 5,
        completed: 2,
        active: 1,
      },
    });
  });

  it("clears and redoes drafts", async () => {
    clearAutodraftBatch.mockResolvedValue({
      clearedCount: 2,
    });
    clearAutodraftWindow.mockResolvedValue({
      clearedCount: 3,
      batch: null,
    });
    redoAutodraftBatch.mockResolvedValue({
      id: "sync_456",
      runType: "redo_autodraft",
      draftsCount: 1,
      startedAt: "2026-04-07T09:00:00.000Z",
      finishedAt: "2026-04-07T09:00:12.000Z",
      windowStart: "2026-04-06T09:00:00.000Z",
      windowEnd: "2026-04-07T09:00:12.000Z",
    });

    const { createApp } = await import("../app.js");

    const clearResponse = await request(createApp()).post("/api/drafts/clear-autodraft").send({});
    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body).toEqual({ clearedCount: 2 });
    expect(clearAutodraftBatch).toHaveBeenCalledWith("user_123");

    const redoResponse = await request(createApp())
      .post("/api/drafts/redo-autodraft")
      .send({ lookback: "4d" });
    expect(redoResponse.status).toBe(200);
    expect(redoAutodraftBatch).toHaveBeenCalledWith("user_123", "4d");
    expect(redoResponse.body.ok).toBe(true);
  });

  it("clears drafts using a lookback window", async () => {
    const { createApp } = await import("../app.js");

    const response = await request(createApp())
      .post("/api/drafts/clear-autodraft")
      .send({ lookback: "3d" });

    expect(response.status).toBe(200);
    expect(clearAutodraftWindow).toHaveBeenCalledWith("user_123", "3d");
    expect(response.body).toEqual({ batch: null, clearedCount: 3 });
  });

  it("returns 400 for invalid settings payloads", async () => {
    const { createApp } = await import("../app.js");
    const response = await request(createApp()).patch("/api/settings").send({
      draftingRules: [],
      agentProvider: "gemini",
      agentModel: "",
      initialAutodraftLookback: "nope",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("disconnects the Gmail account", async () => {
    const { createApp } = await import("../app.js");

    const response = await request(createApp()).post("/api/gmail/disconnect").send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(deleteWhere).toHaveBeenCalled();
  });
});
