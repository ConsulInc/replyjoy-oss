import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import { renderApp } from "../test/render-app";
import { AppLayout } from "./app-layout";

let authState: "signed-in" | "signed-out" = "signed-in";
const signOutSpy = vi.fn();
const mockFetcher = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: authState === "signed-in",
    signOut: signOutSpy,
  }),
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({
  useAuthedFetcher: () => mockFetcher,
}));

function renderLayout() {
  return renderApp(
    <Routes>
      <Route path="/app" element={<AppLayout />}>
        <Route path="settings" element={<div>Settings screen</div>} />
      </Route>
    </Routes>,
    "/app/settings",
  );
}

describe("AppLayout", () => {
  beforeEach(() => {
    mockFetcher.mockReset();
    mockFetcher.mockResolvedValue({
      user: { id: "user_1", email: "derek@example.com" },
      appMode: "oss",
      billingEnabled: false,
      hasAccess: true,
      subscription: null,
    });
  });

  it("renders navigation for signed-in users", () => {
    authState = "signed-in";
    renderLayout();

    expect(screen.getAllByText(/replyjoy/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(0);
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(screen.getAllByText(/workspace/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/active workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
    expect(screen.getByText("Settings screen")).toBeInTheDocument();
  });

  it("shows the sign-in control for signed-out users", () => {
    authState = "signed-out";
    renderLayout();

    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByText(/active workspace/i)).not.toBeInTheDocument();
  });

  it("logs the user out when clicking the logout button", async () => {
    const user = userEvent.setup();
    authState = "signed-in";
    renderLayout();

    await user.click(screen.getByRole("button", { name: /logout/i }));
    expect(signOutSpy).toHaveBeenCalled();
  });
});
