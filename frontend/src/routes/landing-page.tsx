import { SignInButton, useAuth } from "@clerk/clerk-react";
import { ArrowRight, MailCheck, RefreshCcw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "../components/ui/button";

const pillars = [
  {
    title: "Connect Gmail once",
    body: "Authorize your inbox once and keep Gmail as the system of record for review and sending.",
    icon: MailCheck,
  },
  {
    title: "We monitor your inbox",
    body: "Watch for new inbox threads automatically, excluding spam/social/promotions/updates/forums, so the agent can review them as they arrive.",
    icon: RefreshCcw,
  },
  {
    title: "Agent drafts replies",
    body: "Use past emails as context so replies match your tone and the way you usually respond.",
    icon: ShieldCheck,
  },
];

export function LandingPage() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_14%,rgba(255,196,177,0.44),transparent_18%),radial-gradient(circle_at_78%_12%,rgba(238,199,255,0.56),transparent_26%),radial-gradient(circle_at_56%_44%,rgba(245,158,11,0.18),transparent_14%),linear-gradient(180deg,#f9fbff_0%,#f7f8ff_42%,#f6f7ff_100%)]" />
      <div
        className="pointer-events-none absolute left-1/2 top-[24%] h-[920px] w-[920px] -translate-x-1/2 -translate-y-1/2 opacity-70"
        style={{
          backgroundImage:
            "repeating-conic-gradient(from 0deg, rgba(196,132,252,0.26) 0deg 1.1deg, transparent 1.1deg 3.8deg, rgba(251,146,60,0.15) 3.8deg 4.8deg, transparent 4.8deg 7.2deg)",
          WebkitMaskImage:
            "radial-gradient(circle, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.86) 7%, rgba(0,0,0,0.26) 28%, rgba(0,0,0,0.06) 50%, transparent 64%)",
          maskImage:
            "radial-gradient(circle, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.86) 7%, rgba(0,0,0,0.26) 28%, rgba(0,0,0,0.06) 50%, transparent 64%)",
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-[24%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,193,165,0.84),rgba(244,114,182,0.42)_34%,rgba(168,85,247,0.15)_58%,transparent_72%)] blur-3xl" />

      <div className="relative mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <section className="flex min-h-[70vh] flex-col items-center justify-center pt-10 text-center sm:pt-16">
          <div className="max-w-5xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary backdrop-blur">
              ReplyJoy
            </div>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.02] tracking-[-0.05em] text-foreground sm:text-5xl lg:text-7xl">
              AI that auto drafts replies to your email.
            </h1>
            <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-muted-foreground sm:text-xl">
              Connect Gmail, let an agent draft replies in your tone using context from your past
              emails, and customize how it writes.
            </p>

            <div className="mt-8 flex justify-center">
              {!isLoaded ? (
                <Button size="lg" disabled>
                  Loading
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : isSignedIn ? (
                <Button asChild size="lg">
                  <Link to="/app">
                    Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <SignInButton mode="modal">
                  <Button size="lg">
                    Get started
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </SignInButton>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {pillars.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-2xl border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-primary">
                <pillar.icon className="h-5 w-5" />
              </div>
              <h2 className="mt-5 text-lg font-medium text-foreground">{pillar.title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{pillar.body}</p>
            </div>
          ))}
        </section>

        <footer className="mt-10 flex items-center justify-center gap-4 pb-4 text-sm text-muted-foreground">
          <Link className="underline underline-offset-4 transition hover:text-foreground" to="/privacy">
            Privacy Policy
          </Link>
          <Link className="underline underline-offset-4 transition hover:text-foreground" to="/terms">
            Terms of Service
          </Link>
        </footer>
      </div>
    </main>
  );
}
