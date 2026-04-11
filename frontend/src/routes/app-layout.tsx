import { SignInButton, useAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Settings, Sparkles } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { commercialFrontendModule } from "@replyjoy/commercial-frontend";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { type ViewerState, useAuthedFetcher } from "../lib/api";
import { cn } from "../lib/utils";

export function AppLayout() {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const fetcher = useAuthedFetcher();
  const isAuthed = Boolean(isLoaded && isSignedIn);
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => fetcher<ViewerState>("/api/me"),
    enabled: isAuthed,
    staleTime: 30_000,
  });

  const navItems = [
    {
      to: "/app",
      label: "Dashboard",
      description: "Inbox activity and drafts",
      icon: LayoutDashboard,
      end: true,
    },
    ...commercialFrontendModule.navItems.filter(
      (item) => !item.requiresBillingEnabled || Boolean(meQuery.data?.billingEnabled),
    ),
    {
      to: "/app/settings",
      label: "Settings",
      description: "Profile and agent controls",
      icon: Settings,
    },
  ];

  const handleSignOut = async () => {
    await signOut(() => {
      window.location.assign("/");
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#f7f9fd_24%,#f5f7fb_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,205,170,0.22),transparent_24%),radial-gradient(circle_at_88%_0%,rgba(182,201,255,0.22),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.74)_0%,rgba(255,255,255,0)_18%,rgba(255,255,255,0)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[linear-gradient(180deg,rgba(255,255,255,0.88)_0%,rgba(255,255,255,0.26)_55%,transparent_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[280px] w-[780px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.1)_0%,rgba(236,72,153,0.08)_36%,rgba(99,102,241,0.05)_60%,transparent_76%)] blur-3xl" />

      <div className="relative px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1280px] gap-6 lg:grid-cols-[252px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-6 space-y-4">
              <div className="px-1">
                <Link to="/" className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-primary shadow-sm">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                      ReplyJoy
                    </div>
                    <div className="text-sm font-semibold text-foreground">Workspace</div>
                  </div>
                </Link>
              </div>

              {isAuthed ? (
                <Card className="space-y-2 p-3">
                  {navItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "flex items-start gap-3 rounded-2xl px-3 py-3 transition-all duration-150",
                          isActive
                            ? "bg-white text-foreground shadow-sm ring-1 ring-primary/12"
                            : "text-muted-foreground hover:bg-white/92 hover:text-foreground",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <div
                            className={cn(
                              "mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border",
                              isActive
                                ? "border-blue-100 bg-blue-50 text-primary"
                                : "border-slate-200/80 bg-slate-50 text-muted-foreground",
                            )}
                          >
                            <item.icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{item.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
                          </div>
                        </>
                      )}
                    </NavLink>
                  ))}
                </Card>
              ) : null}
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-5">
            <header className="sticky top-4 z-20">
              <div className="rounded-[28px] border border-slate-200/80 bg-white/92 px-4 py-4 shadow-panel backdrop-blur-sm sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center justify-between gap-4">
                    <Link to="/" className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-primary shadow-sm">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                          ReplyJoy
                        </div>
                        <div className="text-sm font-semibold text-foreground">Workspace</div>
                      </div>
                    </Link>
                  </div>

                  <div className="flex items-center gap-3">
                    {isAuthed ? (
                      <>
                        <div className="hidden lg:flex items-center gap-3">
                          <div className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            Active workspace
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={handleSignOut}>
                          Logout
                        </Button>
                      </>
                    ) : (
                      <SignInButton mode="modal">
                        <Button>Get started</Button>
                      </SignInButton>
                    )}
                  </div>
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold tracking-[-0.04em] text-foreground sm:text-3xl">
                    Manage inbox drafting from one place
                  </h1>
                </div>
                {isAuthed ? (
                  <nav className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
                    {navItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn(
                            "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
                            isActive
                              ? "border-blue-200 bg-white text-foreground shadow-sm"
                              : "border-slate-200/80 bg-white/90 text-muted-foreground",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    ))}
                  </nav>
                ) : null}
              </div>
            </header>

            <main className="min-w-0">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
