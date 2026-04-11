import { SignInButton, useAuth, useUser } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { StatusBanner } from "../components/ui/status-banner";
import { Textarea } from "../components/ui/textarea";
import { defaultModelByProvider } from "../lib/agent-config";
import {
  ApiError,
  type EntitlementState,
  type GmailStatus,
  type UserSettings,
  useAuthedFetcher,
} from "../lib/api";

function SettingsRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="space-y-1 border-b border-border/70 pb-4 last:border-b-0 last:pb-0">
      <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium text-foreground">{value}</div>
      {detail ? <div className="text-sm leading-6 text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

export function SettingsForm() {
  const { user } = useUser();
  const fetcher = useAuthedFetcher();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetcher<{ settings: UserSettings } & EntitlementState>("/api/settings"),
    staleTime: 30_000,
  });
  const gmailStatusQuery = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => fetcher<{ gmail: GmailStatus }>("/api/gmail/status"),
    staleTime: 5_000,
  });
  const [form, setForm] = useState<UserSettings | null>(null);
  const [draftingRulesInput, setDraftingRulesInput] = useState("");
  const [flash, setFlash] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setForm(settingsQuery.data.settings);
      setDraftingRulesInput(settingsQuery.data.settings.draftingRules.join("\n"));
    }
  }, [settingsQuery.data]);

  const normalizeDraftingRules = (value: string) =>
    value
      .split("\n")
      .map((rule) => rule.trim())
      .filter((rule) => rule.length > 0);

  const saveMutation = useMutation({
    mutationFn: (next: UserSettings) =>
      fetcher<{ settings: UserSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(next),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setFlash({
        tone: "success",
        message: "Settings saved.",
      });
    },
    onError: (error) => {
      setFlash({
        tone: "error",
        message: (error as ApiError).message,
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () =>
      fetcher<{ ok: boolean }>("/api/gmail/disconnect", {
        method: "POST",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
      ]);
      setFlash({
        tone: "success",
        message: "Gmail account disconnected.",
      });
    },
    onError: (error) => {
      setFlash({
        tone: "error",
        message: (error as ApiError).message || "Could not disconnect Gmail.",
      });
    },
  });

  if (settingsQuery.isLoading || gmailStatusQuery.isLoading) {
    return <Card>Loading settings...</Card>;
  }

  const blockingError = settingsQuery.error ?? gmailStatusQuery.error;
  if (blockingError) {
    return <Card>Failed to load settings: {(blockingError as Error).message}</Card>;
  }

  if (!form) {
    return <Card>Failed to load settings.</Card>;
  }

  const settingsData = settingsQuery.data;
  if (!settingsData) {
    return <Card>Failed to load settings.</Card>;
  }

  const gmail = gmailStatusQuery.data?.gmail ?? null;
  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "No email available";
  const displayName = user?.fullName ?? user?.firstName ?? "Signed-in user";
  const lockedGeminiModel = defaultModelByProvider.gemini;
  const inboxFilterDescription =
    "in:inbox -category:spam -category:social -category:promotions -category:updates -category:forums";

  return (
    <div className="space-y-4">
      {flash ? <StatusBanner tone={flash.tone}>{flash.message}</StatusBanner> : null}

      <Card className="max-w-4xl space-y-8 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Settings</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
              Account and drafting settings
            </h1>
          </div>
        </div>

        <section className="space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Account</p>
            <h2 className="mt-2 text-lg font-semibold text-foreground">Workspace details</h2>
          </div>
          <div className="space-y-4 rounded-2xl border border-border/70 bg-white/60 p-5">
            <SettingsRow label="User" value={displayName} detail={primaryEmail} />
            <SettingsRow label="App account" value={primaryEmail} />
            <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-4 last:border-b-0 last:pb-0">
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  Connected inbox
                </div>
                <div className="text-sm font-medium text-foreground">
                  {gmail?.connected ? gmail.googleEmail ?? "Connected" : "Not connected"}
                </div>
              </div>
              {gmail?.connected ? (
                <Button
                  variant="outline"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect Gmail"}
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link to="/app">Connect Gmail</Link>
                </Button>
              )}
            </div>
            <SettingsRow label="Inbox filter" value={inboxFilterDescription} detail="Applied to monitoring and redo runs." />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                Drafting
              </p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">Agent settings</h2>
            </div>
            <Button
              onClick={() => {
                if (!form) return;
                saveMutation.mutate({
                  ...form,
                  draftingRules: normalizeDraftingRules(draftingRulesInput),
                  agentProvider: "gemini",
                  agentModel: lockedGeminiModel,
                });
              }}
              disabled={saveMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save settings"}
            </Button>
          </div>

          <div className="space-y-5 rounded-2xl border border-border/70 bg-white/60 p-5">
            <SettingsRow
              label="Provider"
              value="Gemini"
              detail="Only Gemini is enabled right now."
            />
            <SettingsRow
              label="Model"
              value={lockedGeminiModel}
              detail="Only Gemini 3 Flash is enabled right now."
            />

            <div className="space-y-2 border-b border-border/70 pb-5">
              <label className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                Drafting rules
              </label>
              <Textarea
                aria-label="Drafting rules"
                value={draftingRulesInput}
                onChange={(event) => {
                  setDraftingRulesInput(event.target.value);
                  setFlash(null);
                }}
              />
              <p className="text-sm leading-6 text-muted-foreground">
                Use short, plain-English rules here. Changes apply to the next sync and redo run.
              </p>
            </div>
          </div>
        </section>

      </Card>
    </div>
  );
}

export function SettingsPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <Card className="flex items-center gap-3">Checking auth...</Card>;
  }

  if (!isSignedIn) {
    return (
      <Card className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Sign in to open settings
        </h1>
        <p className="text-sm leading-7 text-muted-foreground">
          Manage your account and drafting configuration once you sign in.
        </p>
        <SignInButton mode="modal">
          <Button>Get started</Button>
        </SignInButton>
      </Card>
    );
  }

  return (
    <SettingsForm />
  );
}
