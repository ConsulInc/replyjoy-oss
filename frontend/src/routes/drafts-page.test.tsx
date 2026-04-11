import type { ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import { renderApp } from "../test/render-app";
import { DraftWorkspace, DraftsPage } from "./drafts-page";

let authState: "signed-in" | "signed-out" = "signed-in";
const mockFetcher = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: ReactNode }) =>
    authState === "signed-in" ? <>{children}</> : null,
  SignedOut: ({ children }: { children: ReactNode }) =>
    authState === "signed-out" ? <>{children}</> : null,
  SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({
  API_URL: "http://localhost:3000",
  useAuthedFetcher: () => mockFetcher,
}));

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

describe("DraftWorkspace", () => {
  beforeEach(() => {
    authState = "signed-in";
    mockFetcher.mockReset();
    window.localStorage.clear();
  });

  it("redirects the legacy drafts route back to the dashboard", () => {
    renderApp(
      <Routes>
        <Route path="/app" element={<div>Dashboard</div>} />
        <Route path="/app/drafts" element={<DraftsPage />} />
      </Routes>,
      "/app/drafts",
    );

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders the empty state when no drafts exist", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }

      if (path === "/api/drafts") {
        return { drafts: [], processingThreads: [] };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DraftWorkspace />);

    expect(await screen.findByText(/no recent drafts/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open settings/i })).toHaveAttribute(
      "href",
      "/app/settings",
    );
  });

  it("shows the Gmail connection prompt when disconnected", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return {
          gmail: {
            ...connectedGmail,
            connected: false,
            googleEmail: null,
          },
        };
      }

      if (path === "/api/drafts") {
        return { drafts: [], processingThreads: [] };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DraftWorkspace />);

    expect(await screen.findByText(/connect gmail first/i)).toBeInTheDocument();
  });

  it("lets the user inspect a different draft", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }

      if (path === "/api/drafts") {
        return {
          drafts: [
            {
              id: "draft-1",
              threadId: "thread-1",
              subject: "First draft",
              fromName: "Alex",
              fromEmail: "alex@example.com",
              latestMessageAt: "2026-04-07T09:00:00.000Z",
              selectionReason: "First reason",
              attachments: [],
              generatedText: "First body",
              gmailDraftId: "gmail-draft-1",
              gmailThreadId: "gmail-thread-1",
              decision: "drafted",
              hasDraft: true,
            },
            {
              id: "draft-2",
              threadId: "thread-2",
              subject: "Second draft",
              fromName: "Jordan",
              fromEmail: "jordan@example.com",
              latestMessageAt: "2026-04-07T10:00:00.000Z",
              selectionReason: "Second reason",
              attachments: [],
              generatedText: "Second body",
              gmailDraftId: "gmail-draft-2",
              gmailThreadId: "gmail-thread-2",
              decision: "drafted",
              hasDraft: true,
            },
          ],
          processingThreads: [],
          syncProgress: null,
        };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    const user = userEvent.setup();
    renderApp(<DraftWorkspace />);

    expect(await screen.findByRole("heading", { name: /first draft/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /second draft/i }));

    expect(screen.getByRole("heading", { name: /second draft/i })).toBeInTheDocument();
    expect(screen.getByText("Second body")).toBeInTheDocument();
    expect(screen.getAllByText("Second reason")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /open draft in gmail/i })).toHaveAttribute(
      "href",
      "https://mail.google.com/mail/u/0/#drafts/gmail-thread-2",
    );
  });

  it("shows the Gmail status error message when the status query fails", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        throw new Error("Gmail status is unavailable");
      }

      if (path === "/api/drafts") {
        return { drafts: [], processingThreads: [] };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DraftWorkspace />);

    expect(
      await screen.findByText(/failed to load drafts: gmail status is unavailable/i),
    ).toBeInTheDocument();
  });

  it("shows processing threads while the agent is reviewing inbox email", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return {
          gmail: {
            ...connectedGmail,
            syncStatus: "syncing",
          },
        };
      }

      if (path === "/api/drafts") {
        return {
          drafts: [],
          processingThreads: [
            {
              id: "thread-1",
              threadId: "thread-1",
              subject: "Need feedback on the new UI",
              fromName: "Sam",
              fromEmail: "sam@example.com",
              latestMessageAt: "2026-04-07T10:00:00.000Z",
              snippet: "Can you take a look at the latest changes?",
              gmailThreadId: "gmail-thread-1",
            },
          ],
        };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DraftWorkspace />);

    expect(await screen.findByText(/threads currently being drafted/i)).toBeInTheDocument();
    expect(screen.getByText(/need feedback on the new ui/i)).toBeInTheDocument();
    expect(screen.getByText(/agent drafting/i)).toBeInTheDocument();
  });

  it("keeps the processing section hidden while a sync is only checking for new email", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return {
          gmail: {
            ...connectedGmail,
            syncStatus: "syncing",
          },
        };
      }

      if (path === "/api/drafts") {
        return { drafts: [], processingThreads: [] };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DraftWorkspace />);

    await waitFor(() => {
      expect(screen.queryByText(/threads currently being reviewed/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/scanning the inbox/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no recent drafts/i)).not.toBeInTheDocument();
  });

  it("marks an existing draft as updating when its thread is being reprocessed", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return {
          gmail: {
            ...connectedGmail,
            syncStatus: "syncing",
          },
        };
      }

      if (path === "/api/drafts") {
        return {
          drafts: [
            {
              id: "draft-1",
              threadId: "thread-1",
              subject: "Follow-up on product feedback",
              fromName: "Taylor",
              fromEmail: "taylor@example.com",
              latestMessageAt: "2026-04-07T09:00:00.000Z",
              selectionReason: "Reply draft ready",
              attachments: [
                {
                  messageId: "msg-1",
                  attachmentId: "att-1",
                  filename: "resume.pdf",
                  mimeType: "application/pdf",
                  size: 4096,
                },
              ],
              generatedText: "Thanks for the detailed notes.",
              gmailDraftId: "gmail-draft-1",
              gmailThreadId: "gmail-thread-1",
              decision: "drafted",
              hasDraft: true,
            },
          ],
          processingThreads: [
            {
              id: "thread-1",
              threadId: "thread-1",
              subject: "Follow-up on product feedback",
              fromName: "Taylor",
              fromEmail: "taylor@example.com",
              latestMessageAt: "2026-04-07T09:00:00.000Z",
              snippet: "Latest notes",
              gmailThreadId: "gmail-thread-1",
            },
          ],
          syncProgress: null,
        };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<DraftWorkspace />);

    expect(await screen.findByRole("heading", { name: /follow-up on product feedback/i })).toBeInTheDocument();
    expect(screen.getByText(/agent is still drafting this reply/i)).toBeInTheDocument();
    expect(screen.getByText(/updating draft/i)).toBeInTheDocument();
    expect(screen.getByText(/resume\.pdf/i)).toBeInTheDocument();
  });

  it("persists the recent review filter in local storage", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }

      if (path === "/api/drafts") {
        return {
          drafts: [
            {
              id: "draft-1",
              threadId: "thread-1",
              subject: "Drafted thread",
              fromName: "Alex",
              fromEmail: "alex@example.com",
              latestMessageAt: "2026-04-07T09:00:00.000Z",
              selectionReason: "Reply draft ready",
              attachments: [],
              generatedText: "Draft body",
              gmailDraftId: "gmail-draft-1",
              gmailThreadId: "gmail-thread-1",
              decision: "drafted",
              hasDraft: true,
            },
            {
              id: "review-2",
              threadId: "thread-2",
              subject: "Skipped thread",
              fromName: "Jordan",
              fromEmail: "jordan@example.com",
              latestMessageAt: "2026-04-07T10:00:00.000Z",
              selectionReason: "Newsletter does not need a reply",
              attachments: [],
              generatedText: null,
              gmailDraftId: null,
              gmailThreadId: "gmail-thread-2",
              decision: "skipped",
              hasDraft: false,
            },
          ],
          processingThreads: [],
          syncProgress: null,
        };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    const user = userEvent.setup();
    renderApp(<DraftWorkspace />);

    expect(await screen.findByRole("heading", { name: /drafted thread/i })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/recent review filter/i), "without-draft");

    expect(window.localStorage.getItem("draft-workspace-review-filter")).toBe("without-draft");
    expect(screen.getByRole("heading", { name: /skipped thread/i })).toBeInTheDocument();
  });
});
