import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import { renderApp } from "./test/render-app";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: false,
  }),
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useUser: () => ({
    user: null,
  }),
}));

describe("App routes", () => {
  it("opens the dashboard on the bare workspace route", async () => {
    renderApp(<App />, "/app");

    expect(await screen.findByRole("heading", { name: /sign in to open your dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /feedback/i })).toBeInTheDocument();
  });
});
