import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gmailAccountsFindFirst = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn();
const insertValues = vi.fn();
const exchangeCodeForTokens = vi.fn();
const createGmailClient = vi.fn();
const encryptSecret = vi.fn();
const verifyState = vi.fn();
const syncUserAccount = vi.fn();
const loggerInfo = vi.fn();
const loggerError = vi.fn();
const fetchMock = vi.fn();

vi.mock("../lib/env.js", () => ({
  env: {
    FRONTEND_URL: "http://localhost:5173",
    RESEND_API_KEY: "resend_test_key", // pragma: allowlist secret
    SUPPORT_TO_EMAIL: "derek@consulinc.us",
    SUPPORT_FROM_EMAIL: "support@consulinc.us",
  },
}));

vi.mock("../db/client.js", () => ({
  db: {
    query: {
      gmailAccounts: { findFirst: gmailAccountsFindFirst },
    },
    update: vi.fn(() => ({
      set: updateSet,
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  },
}));

vi.mock("../gmail/client.js", () => ({
  exchangeCodeForTokens,
  createGmailClient,
}));

vi.mock("../lib/crypto.js", () => ({
  encryptSecret,
  verifyState,
}));

vi.mock("../services/gmail-sync.js", () => ({
  syncUserAccount,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: loggerInfo,
    error: loggerError,
  },
}));

describe("public routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);

    updateSet.mockReturnValue({
      where: updateWhere,
    });
    updateWhere.mockResolvedValue(undefined);
    insertValues.mockResolvedValue(undefined);
    verifyState.mockReturnValue({
      userId: "user_123",
      lookback: "7d",
      exp: Date.now() + 60_000,
    });
    exchangeCodeForTokens.mockResolvedValue({
      refresh_token: "refresh-token",
      access_token: "access-token",
      expiry_date: Date.now() + 3_600_000,
      scope: "gmail.readonly gmail.compose",
    });
    encryptSecret.mockImplementation((value: string) => `encrypted:${value}`);
    createGmailClient.mockReturnValue({
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: {
            emailAddress: "person@gmail.com",
            historyId: "history-123",
          },
        }),
      },
    });
    syncUserAccount.mockResolvedValue(undefined);
  });

  it("redirects after a successful OAuth callback and kicks off a background sync", async () => {
    gmailAccountsFindFirst.mockResolvedValue(null);

    const { createApp } = await import("../app.js");
    const response = await request(createApp()).get(
      "/auth/google/callback?code=oauth-code&state=signed-state",
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:5173/app?gmail=connected");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
        googleEmail: "person@gmail.com",
        lastHistoryId: "history-123",
        refreshTokenEncrypted: "encrypted:refresh-token",
      }),
    );
    expect(syncUserAccount).not.toHaveBeenCalled();
  });

  it("reuses the stored refresh token when Google does not return a new one", async () => {
    gmailAccountsFindFirst.mockResolvedValue({
      id: "gmail_123",
      googleEmail: "old@gmail.com",
      scopes: "gmail.readonly",
      refreshTokenEncrypted: "encrypted:existing-refresh",
      lastHistoryId: "history-001",
      googleSub: null,
    });
    exchangeCodeForTokens.mockResolvedValue({
      access_token: "access-token",
      expiry_date: Date.now() + 3_600_000,
      scope: "gmail.readonly gmail.compose",
    });

    const { createApp } = await import("../app.js");
    const response = await request(createApp()).get(
      "/auth/google/callback?code=oauth-code&state=signed-state",
    );

    expect(response.status).toBe(302);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshTokenEncrypted: "encrypted:existing-refresh",
        googleEmail: "person@gmail.com",
        lastHistoryId: "history-123",
      }),
    );
  });

  it("submits a public support request through Resend", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    const { createApp } = await import("../app.js");
    const response = await request(createApp()).post("/api/public/support").send({
      title: "Need help with a draft",
      body: "The agent skipped something I expected it to draft.",
      email: "person@example.com",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resend_test_key",
        }),
      }),
    );
  });
});
