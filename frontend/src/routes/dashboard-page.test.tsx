import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderApp } from "../test/render-app";
import { DashboardPage } from "./dashboard-page";

let authState: "signed-in" | "signed-out" = "signed-in";
const mockFetcher = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: authState === "signed-in",
  }),
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({
  API_URL: "http://localhost:3000",
  useAuthedFetcher: () => mockFetcher,
}));

const defaultSettings = {
  draftingRules: ["Draft concise, warm, useful replies."],
  agentProvider: "gemini" as const,
  agentModel: "gemini-3-flash-preview",
  initialAutodraftLookback: "1d" as const,
  autodraftEnabled: true,
};

const disconnectedGmail = {
  connected: false,
  googleEmail: null,
  syncStatus: null,
  lastSyncError: null,
  lastSuccessfulSyncAt: null,
  lastSyncAttemptAt: null,
  lastPolledAt: null,
  needsInitialProcessingChoice: false,
};

const connectedGmail = {
  connected: true,
  googleEmail: "person@gmail.com",
  syncStatus: "synced",
  lastSyncError: null,
  lastSuccessfulSyncAt: "2026-04-07T06:00:00.000Z",
  lastSyncAttemptAt: "2026-04-07T06:00:00.000Z",
  lastPolledAt: "2026-04-07T06:00:00.000Z",
  needsInitialProcessingChoice: false,
};

const syncingGmail = {
  ...connectedGmail,
  syncStatus: "syncing",
};

function buildDraftsResponse(overrides?: Partial<{
  drafts: Array<Record<string, unknown>>;
  processingThreads: Array<Record<string, unknown>>;
  syncProgress: { total: number; completed: number; active: number } | null;
}>) {
  return {
    drafts: [],
    processingThreads: [],
    syncProgress: null,
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    authState = "signed-in";
    mockFetcher.mockReset();
  });

  it("shows the sign-in state while signed out", () => {
    authState = "signed-out";

    renderApp(<DashboardPage />, "/app");

    expect(screen.getByRole("heading", { name: /sign in to open your dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  it("shows the Gmail connect state when the inbox is disconnected", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/settings") {
        return { settings: defaultSettings };
      }
      if (path === "/api/gmail/status") {
        return { gmail: disconnectedGmail };
      }
      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DashboardPage />, "/app");

    expect(await screen.findByRole("heading", { name: /connect gmail to start drafting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect gmail/i })).toBeInTheDocument();
  });

  it("shows connected controls and the draft workspace", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/settings") {
        return { settings: defaultSettings };
      }
      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }
      if (path === "/api/drafts") {
        return buildDraftsResponse({
          drafts: [
            {
              id: "draft-1",
              threadId: "thread-1",
              subject: "Quarterly check-in",
              fromName: "Alex",
              fromEmail: "alex@example.com",
              latestMessageAt: "2026-04-07T09:00:00.000Z",
              selectionReason: "Reply draft ready",
              attachments: [],
              generatedText: "Thanks for the update.",
              gmailDraftId: "gmail-draft-1",
              gmailThreadId: "gmail-thread-1",
              decision: "drafted",
              hasDraft: true,
            },
          ],
        });
      }
      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DashboardPage />, "/app");

    expect(
      await screen.findByRole("heading", { name: /review drafts and run inbox automation/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run sync now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more options/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /quarterly check-in/i })).toBeInTheDocument();
  });

  it("shows checking status and disables sync while syncing", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/settings") {
        return { settings: defaultSettings };
      }
      if (path === "/api/gmail/status") {
        return { gmail: syncingGmail };
      }
      if (path === "/api/drafts") {
        return buildDraftsResponse({
          processingThreads: [
            {
              id: "thread-row-1",
              threadId: "thread-1",
              subject: "Quick follow-up",
              fromName: "Alex",
              fromEmail: "alex@example.com",
              latestMessageAt: "2026-04-07T09:00:00.000Z",
              snippet: "Reviewing the latest messages and generating a reply draft.",
              gmailThreadId: "gmail-thread-1",
            },
          ],
          syncProgress: {
            total: 3,
            completed: 1,
            active: 1,
          },
        });
      }
      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DashboardPage />, "/app");

    expect(await screen.findAllByText(/agent drafting/i)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /syncing\./i })).toBeDisabled();
    expect(screen.getByText(/threads currently being drafted/i)).toBeInTheDocument();
    expect(screen.getByText(/completed 1\/3/i)).toBeInTheDocument();
  });

  it("opens initial processing modal after Gmail connects and starts processing", async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];

    mockFetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });

      if (path === "/api/settings") {
        return { settings: defaultSettings };
      }
      if (path === "/api/gmail/status") {
        return {
          gmail: {
            ...connectedGmail,
            needsInitialProcessingChoice: true,
          },
        };
      }
      if (path === "/api/drafts") {
        return buildDraftsResponse();
      }
      if (path === "/api/gmail/initial-processing" && method === "POST") {
        return { ok: true };
      }
      throw new Error(`Unhandled request ${method} ${path}`);
    });

    const user = userEvent.setup();
    renderApp(<DashboardPage />, "/app?gmail=connected");

    expect(await screen.findByRole("heading", { name: /process older emails\?/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/initial processing window/i)).toHaveValue("1d");

    await user.selectOptions(screen.getByLabelText(/initial processing window/i), "3d");
    await user.click(screen.getByRole("button", { name: /start processing/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /process older emails\?/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/initial processing started\./i)).toBeInTheDocument();

    const startCall = calls.find((call) => call.path === "/api/gmail/initial-processing");
    expect(startCall?.body).toEqual({ lookback: "3d" });
  });

  it("opens more options and triggers redo using the selected lookback", async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];

    mockFetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });

      if (path === "/api/settings" && method === "GET") {
        return { settings: defaultSettings };
      }
      if (path === "/api/settings" && method === "PATCH") {
        return {
          settings: {
            ...defaultSettings,
            ...(body as Record<string, unknown>),
          },
        };
      }
      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }
      if (path === "/api/drafts") {
        return buildDraftsResponse();
      }
      if (path === "/api/drafts/redo-autodraft" && method === "POST") {
        return { ok: true };
      }
      if (path === "/api/drafts/clear-autodraft" && method === "POST") {
        return { clearedCount: 0 };
      }
      throw new Error(`Unhandled request ${method} ${path}`);
    });

    const user = userEvent.setup();
    renderApp(<DashboardPage />, "/app");

    await screen.findByRole("button", { name: /more options/i });
    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.selectOptions(screen.getByLabelText(/lookback window/i), "4d");
    await user.click(screen.getByRole("button", { name: /redo drafts/i }));
    expect(await screen.findByRole("heading", { name: /confirm redo draft run\?/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm redo/i }));

    await waitFor(() => {
      expect(screen.getByText(/redo started\./i)).toBeInTheDocument();
    });

    const patchCall = calls.find((call) => call.path === "/api/settings" && call.method === "PATCH");
    const redoCall = calls.find((call) => call.path === "/api/drafts/redo-autodraft");

    expect(patchCall?.body).toMatchObject({
      ...defaultSettings,
      initialAutodraftLookback: "4d",
    });
    expect(redoCall?.body).toEqual({ lookback: "4d" });
  });

  it("clears latest app drafts using the selected lookback", async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];

    mockFetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });

      if (path === "/api/settings" && method === "GET") {
        return { settings: defaultSettings };
      }
      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }
      if (path === "/api/drafts") {
        return buildDraftsResponse();
      }
      if (path === "/api/drafts/clear-autodraft" && method === "POST") {
        return { clearedCount: 0 };
      }
      throw new Error(`Unhandled request ${method} ${path}`);
    });

    const user = userEvent.setup();
    renderApp(<DashboardPage />, "/app");

    await screen.findByRole("button", { name: /more options/i });
    await user.click(screen.getByRole("button", { name: /more options/i }));
    await user.selectOptions(screen.getByLabelText(/lookback window/i), "2d");
    await user.click(screen.getByRole("button", { name: /clear latest app drafts/i }));
    expect(await screen.findByRole("heading", { name: /clear latest app drafts\?/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm clear/i }));

    const clearCall = calls.find((call) => call.path === "/api/drafts/clear-autodraft" && call.method === "POST");
    expect(clearCall?.body).toEqual({ lookback: "2d" });
  });
});
