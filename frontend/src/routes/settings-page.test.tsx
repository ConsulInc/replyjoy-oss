import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderApp } from "../test/render-app";
import { SettingsForm, SettingsPage } from "./settings-page";

let authState: "signed-in" | "signed-out" = "signed-in";
const mockFetcher = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: authState === "signed-in",
  }),
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useUser: () => ({
    user: {
      fullName: "Derek Bai",
      primaryEmailAddress: {
        emailAddress: "derek@example.com",
      },
      emailAddresses: [{ emailAddress: "derek@example.com" }],
    },
  }),
}));

vi.mock("../lib/api", () => ({
  useAuthedFetcher: () => mockFetcher,
}));

const defaultSettings = {
  draftingRules: ["Draft concise, warm, useful replies."],
  agentProvider: "gemini",
  agentModel: "gemini-3-flash-preview",
  initialAutodraftLookback: "1d",
  autodraftEnabled: true,
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

function installSettingsFetcher() {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];

  mockFetcher.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });

    if (path === "/api/settings" && method === "GET") {
      return {
        appMode: "oss",
        billingEnabled: false,
        hasAccess: true,
        subscription: null,
        settings: defaultSettings,
      };
    }

    if (path === "/api/settings" && method === "PATCH") {
      return { settings: body };
    }

    if (path === "/api/gmail/status") {
      return { gmail: connectedGmail };
    }

    throw new Error(`Unhandled request ${method} ${path}`);
  });

  return calls;
}

describe("SettingsPage", () => {
  beforeEach(() => {
    authState = "signed-in";
    mockFetcher.mockReset();
  });

  it("shows the sign-in state while signed out", () => {
    authState = "signed-out";

    renderApp(<SettingsPage />, "/app/settings");

    expect(screen.getByRole("heading", { name: /sign in to open settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  it("renders account details and drafting controls", async () => {
    installSettingsFetcher();

    renderApp(<SettingsForm />, "/app/settings");

    expect(await screen.findByText("Derek Bai")).toBeInTheDocument();
    expect(screen.getAllByText("derek@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("person@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.getByText("gemini-3-flash-preview")).toBeInTheDocument();
    expect(screen.getByText(/only gemini is enabled right now/i)).toBeInTheDocument();
    expect(screen.getByText(/only gemini 3 flash is enabled right now/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(defaultSettings.draftingRules.join("\n"))).toBeInTheDocument();
    expect(screen.queryByText(/open source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/access granted/i)).not.toBeInTheDocument();
  });

  it("saves the updated prompt with Gemini locked", async () => {
    const calls = installSettingsFetcher();
    const user = userEvent.setup();

    renderApp(<SettingsForm />, "/app/settings");

    const promptInput = await screen.findByDisplayValue(defaultSettings.draftingRules.join("\n"));
    await user.clear(promptInput);
    await user.type(promptInput, "Reply with short, direct drafts.");
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByText(/settings saved\./i)).toBeInTheDocument();
    });

    const patchCall = calls.find(
      (call) => call.path === "/api/settings" && call.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    expect(patchCall?.body).toMatchObject({
      agentProvider: "gemini",
      agentModel: "gemini-3-flash-preview",
      autodraftEnabled: true,
      draftingRules: ["Reply with short, direct drafts."],
      initialAutodraftLookback: "1d",
    });
  });

  it("renders a blocking error when settings fail to load", async () => {
    mockFetcher.mockImplementation(async (path: string) => {
      if (path === "/api/settings") {
        throw new Error("Unable to reach settings API");
      }

      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }

      throw new Error(`Unhandled path ${path}`);
    });

    renderApp(<SettingsForm />, "/app/settings");

    expect(
      await screen.findByText(/failed to load settings: unable to reach settings api/i),
    ).toBeInTheDocument();
  });

  it("disconnects Gmail when requested", async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];

    mockFetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });

      if (path === "/api/settings" && method === "GET") {
        return {
          appMode: "oss",
          billingEnabled: false,
          hasAccess: true,
          subscription: null,
          settings: defaultSettings,
        };
      }

      if (path === "/api/settings" && method === "PATCH") {
        return { settings: body };
      }

      if (path === "/api/gmail/status") {
        return { gmail: connectedGmail };
      }

      if (path === "/api/gmail/disconnect" && method === "POST") {
        return { ok: true };
      }

      throw new Error(`Unhandled request ${method} ${path}`);
    });

    const user = userEvent.setup();
    renderApp(<SettingsForm />, "/app/settings");

    const disconnectButton = await screen.findByRole("button", { name: /disconnect gmail/i });
    await user.click(disconnectButton);

    await waitFor(() => {
      expect(screen.getByText(/gmail account disconnected\./i)).toBeInTheDocument();
    });

    const disconnectCall = calls.find((call) => call.path === "/api/gmail/disconnect");
    expect(disconnectCall?.method).toBe("POST");
  });

  it("shows a connect button in settings when Gmail is disconnected", async () => {
    mockFetcher.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";

      if (path === "/api/settings" && method === "GET") {
        return {
          appMode: "oss",
          billingEnabled: false,
          hasAccess: true,
          subscription: null,
          settings: defaultSettings,
        };
      }

      if (path === "/api/gmail/status") {
        return { gmail: disconnectedGmail };
      }

      throw new Error(`Unhandled request ${method} ${path}`);
    });

    renderApp(<SettingsForm />, "/app/settings");

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect gmail/i })).toHaveAttribute("href", "/app");
    expect(screen.queryByRole("button", { name: /disconnect gmail/i })).not.toBeInTheDocument();
  });
});
