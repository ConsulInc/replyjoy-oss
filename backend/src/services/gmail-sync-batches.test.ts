import { beforeEach, describe, expect, it, vi } from "vitest";

const syncRunsFindMany = vi.fn();
const syncRunsFindFirst = vi.fn();
const draftRepliesFindMany = vi.fn();
const gmailAccountsFindFirst = vi.fn();
const deleteWhere = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn();
const draftsDelete = vi.fn();
const loggerInfo = vi.fn();

vi.mock("../db/client.js", () => ({
  db: {
    query: {
      syncRuns: { findMany: syncRunsFindMany, findFirst: syncRunsFindFirst },
      draftReplies: { findMany: draftRepliesFindMany },
      gmailAccounts: { findFirst: gmailAccountsFindFirst },
    },
    delete: vi.fn(() => ({
      where: deleteWhere,
    })),
    update: vi.fn(() => ({
      set: updateSet,
    })),
  },
}));

vi.mock("../gmail/client.js", () => ({
  createGmailClient: vi.fn(() => ({
    users: {
      drafts: {
        delete: draftsDelete,
      },
    },
  })),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((value: string) => value),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: loggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("gmail sync batch helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncRunsFindFirst.mockResolvedValue(null);
    updateSet.mockReturnValue({
      where: updateWhere,
    });
    updateWhere.mockResolvedValue(undefined);
    deleteWhere.mockResolvedValue(undefined);
  });

  it("returns null when no autodraft batch exists", async () => {
    syncRunsFindMany.mockResolvedValue([]);

    const { getLatestAutodraftBatch } = await import("./gmail-sync.js");
    const result = await getLatestAutodraftBatch("user_123");

    expect(result).toBeNull();
    expect(draftRepliesFindMany).not.toHaveBeenCalled();
  });

  it("summarizes the latest autodraft batch with its tagged draft count", async () => {
    syncRunsFindMany.mockResolvedValue([
      {
        id: "sync_123",
        runType: "redo_autodraft",
        startedAt: new Date("2026-04-07T08:00:00.000Z"),
        finishedAt: new Date("2026-04-07T08:00:15.000Z"),
        windowStart: new Date("2026-04-01T08:00:00.000Z"),
        windowEnd: new Date("2026-04-07T08:00:15.000Z"),
      },
    ]);
    draftRepliesFindMany
      .mockResolvedValueOnce([
        { id: "draft_1", autodraftBatchId: "sync_123" },
        { id: "draft_2", autodraftBatchId: "sync_123" },
      ])
      .mockResolvedValueOnce([
        { id: "draft_1", autodraftBatchId: "sync_123" },
        { id: "draft_2", autodraftBatchId: "sync_123" },
      ]);

    const { getLatestAutodraftBatch } = await import("./gmail-sync.js");
    const result = await getLatestAutodraftBatch("user_123");

    expect(result).toEqual({
      id: "sync_123",
      runType: "redo_autodraft",
      draftsCount: 2,
      startedAt: "2026-04-07T08:00:00.000Z",
      finishedAt: "2026-04-07T08:00:15.000Z",
      windowStart: "2026-04-01T08:00:00.000Z",
      windowEnd: "2026-04-07T08:00:15.000Z",
    });
  });

  it("treats manual sync runs as app-created batches", async () => {
    syncRunsFindMany.mockResolvedValue([
      {
        id: "sync_manual",
        runType: "manual",
        startedAt: new Date("2026-04-07T09:00:00.000Z"),
        finishedAt: new Date("2026-04-07T09:00:10.000Z"),
        windowStart: null,
        windowEnd: new Date("2026-04-07T09:00:10.000Z"),
      },
    ]);
    draftRepliesFindMany
      .mockResolvedValueOnce([{ id: "draft_1", autodraftBatchId: "sync_manual" }])
      .mockResolvedValueOnce([{ id: "draft_1", autodraftBatchId: "sync_manual" }]);

    const { getLatestAutodraftBatch } = await import("./gmail-sync.js");
    const result = await getLatestAutodraftBatch("user_123");

    expect(result).toEqual({
      id: "sync_manual",
      runType: "manual",
      draftsCount: 1,
      startedAt: "2026-04-07T09:00:00.000Z",
      finishedAt: "2026-04-07T09:00:10.000Z",
      windowStart: null,
      windowEnd: "2026-04-07T09:00:10.000Z",
    });
  });

  it("skips newer empty runs and returns the latest batch that actually created drafts", async () => {
    syncRunsFindMany.mockResolvedValue([
      {
        id: "sync_scheduled",
        runType: "scheduled",
        startedAt: new Date("2026-04-07T09:05:00.000Z"),
        finishedAt: new Date("2026-04-07T09:05:10.000Z"),
        windowStart: new Date("2026-04-07T09:02:00.000Z"),
        windowEnd: new Date("2026-04-07T09:05:10.000Z"),
      },
      {
        id: "sync_manual",
        runType: "manual",
        startedAt: new Date("2026-04-07T09:00:00.000Z"),
        finishedAt: new Date("2026-04-07T09:00:10.000Z"),
        windowStart: null,
        windowEnd: new Date("2026-04-07T09:00:10.000Z"),
      },
    ]);
    draftRepliesFindMany
      .mockResolvedValueOnce([{ id: "draft_1", autodraftBatchId: "sync_manual" }])
      .mockResolvedValueOnce([{ id: "draft_1", autodraftBatchId: "sync_manual" }]);

    const { getLatestAutodraftBatch } = await import("./gmail-sync.js");
    const result = await getLatestAutodraftBatch("user_123");

    expect(result).toEqual({
      id: "sync_manual",
      runType: "manual",
      draftsCount: 1,
      startedAt: "2026-04-07T09:00:00.000Z",
      finishedAt: "2026-04-07T09:00:10.000Z",
      windowStart: null,
      windowEnd: "2026-04-07T09:00:10.000Z",
    });
  });

  it("clears only the drafts in the latest tagged batch and tolerates already-deleted Gmail drafts", async () => {
    syncRunsFindMany.mockResolvedValue([
      {
        id: "sync_123",
        runType: "oauth_connect",
        startedAt: new Date("2026-04-07T08:00:00.000Z"),
        finishedAt: new Date("2026-04-07T08:00:15.000Z"),
        windowStart: new Date("2026-04-01T08:00:00.000Z"),
        windowEnd: new Date("2026-04-07T08:00:15.000Z"),
      },
    ]);
    draftRepliesFindMany
      .mockResolvedValueOnce([
        {
          id: "draft_1",
          threadId: "thread_1",
          autodraftBatchId: "sync_123",
        },
        {
          id: "draft_2",
          threadId: "thread_2",
          autodraftBatchId: "sync_123",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "draft_1",
          threadId: "thread_1",
          gmailDraftId: "gmail_draft_1",
          autodraftBatchId: "sync_123",
        },
        {
          id: "draft_2",
          threadId: "thread_2",
          gmailDraftId: "gmail_draft_2",
          autodraftBatchId: "sync_123",
        },
      ]);
    draftRepliesFindMany.mockResolvedValueOnce([
      {
        id: "draft_1",
        threadId: "thread_1",
        gmailDraftId: "gmail_draft_1",
        autodraftBatchId: "sync_123",
      },
      {
        id: "draft_2",
        threadId: "thread_2",
        gmailDraftId: "gmail_draft_2",
        autodraftBatchId: "sync_123",
      },
    ]);
    gmailAccountsFindFirst.mockResolvedValue({
      refreshTokenEncrypted: "refresh-token",
      accessTokenEncrypted: "access-token",
      tokenExpiresAt: new Date("2026-04-07T09:00:00.000Z"),
    });
    draftsDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ response: { status: 404 } });

    const { clearAutodraftBatch } = await import("./gmail-sync.js");
    const result = await clearAutodraftBatch("user_123");

    expect(draftsDelete).toHaveBeenCalledTimes(2);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(updateWhere.mock.calls.length).toBeGreaterThan(0);
    expect(loggerInfo).toHaveBeenCalledWith("Cleared autodraft batch", {
      userId: "user_123",
      batchId: "sync_123",
      clearedCount: 2,
    });
    expect(result).toEqual({
      batch: {
        id: "sync_123",
        runType: "oauth_connect",
        draftsCount: 2,
        startedAt: "2026-04-07T08:00:00.000Z",
        finishedAt: "2026-04-07T08:00:15.000Z",
        windowStart: "2026-04-01T08:00:00.000Z",
        windowEnd: "2026-04-07T08:00:15.000Z",
      },
      clearedCount: 2,
    });
  });
});
