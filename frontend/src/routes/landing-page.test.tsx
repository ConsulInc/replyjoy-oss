import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderApp } from "../test/render-app";
import { LandingPage } from "./landing-page";

let authState: "signed-in" | "signed-out" = "signed-out";

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: authState === "signed-in",
  }),
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("LandingPage", () => {
  it("shows get started CTAs while signed out", () => {
    authState = "signed-out";
    renderApp(<LandingPage />);

    expect(
      screen.getByRole("heading", {
        name: /ai that auto drafts replies to your email/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByText(/we monitor your inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/agent drafts replies/i)).toBeInTheDocument();
  });

  it("shows dashboard CTAs while signed in", () => {
    authState = "signed-in";
    renderApp(<LandingPage />);

    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /get started/i })).not.toBeInTheDocument();
  });
});
