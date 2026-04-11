import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Inbox,
  LoaderCircle,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { commercialFrontendModule } from "@replyjoy/commercial-frontend";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Select } from "../components/ui/select";
import { StatusBanner } from "../components/ui/status-banner";
import { lookbackOptions } from "../lib/agent-config";
import {
  type EntitlementState,
  type GmailStatus,
  type SyncProgress,
  type UserSettings,
  useAuthedFetcher,
} from "../lib/api";
import { DraftWorkspace } from "./drafts-page";

type FlashBanner = {
  tone: "success" | "error";
  message: string;
};

const INBOX_FILTER_TITLE = "Inbox emails only";
const INBOX_FILTER_DESCRIPTION =
  "We monitor inbox threads and ignore spam, social, promotions, updates, and forums.";
const SYNC_GRACE_WINDOW_MS = 3_000;
const SYNC_POLL_EARLY_WINDOW_MS = 1_000;
const SYNC_POLL_LATE_WINDOW_MS = 5_000;

function getSyncStatusPollInterval(
  gmail: Pick<GmailStatus, "connected" | "syncStatus" | "lastSyncAttemptAt" | "lastPolledAt"> | null | undefined,
  now: number,
) {
  if (!gmail?.connected) {
    return false;
  }

  if (gmail.syncStatus === "syncing") {
    return 1_000;
  }

  const anchor = gmail.lastSyncAttemptAt ?? gmail.lastPolledAt;
  if (!anchor) {
    return false;
  }

  const nextSyncAt = new Date(anchor).getTime() + 60_000;
  if (now >= nextSyncAt - SYNC_POLL_EARLY_WINDOW_MS && now <= nextSyncAt + SYNC_POLL_LATE_WINDOW_MS) {
    return 1_000;
  }

  return false;
}

function formatLookbackLabel(lookback: UserSettings["initialAutodraftLookback"]) {
  return lookback === "1d"
    ? "1 day"
    : lookback === "2d"
      ? "2 days"
      : lookback === "3d"
        ? "3 days"
        : lookback === "4d"
          ? "4 days"
          : "5 days";
}

function formatCountdown(targetAt: number) {
  const remainingMs = Math.max(0, targetAt - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDashboardActionError(error: unknown, fallback: string) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message === "Sync already running for this account") {
    return "Wait for the current sync to finish, then try again.";
  }
  return message || fallback;
}

function hasApiStatus(error: unknown, status: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

function InitialProcessingModal({
  lookback,
  setLookback,
  onStart,
  onSkip,
  isStarting,
  isSkipping,
}: {
  lookback: UserSettings["initialAutodraftLookback"];
  setLookback: (value: UserSettings["initialAutodraftLookback"]) => void;
  onStart: () => void;
  onSkip: () => void;
  isStarting: boolean;
  isSkipping: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/10 px-4">
      <div className="absolute inset-0 bg-white/25 backdrop-blur-[3px]" />
      <Card className="relative z-10 w-full max-w-lg overflow-hidden border-border/80 bg-white/95 p-0 shadow-[0_28px_90px_-38px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Initial setup</p>
            <h2 className="mt-2 text-[2rem] font-semibold tracking-[-0.045em] text-foreground">
              Process older emails?
            </h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">
              Start with older inbox threads now, or skip this and only monitor new email going
              forward.
            </p>
          </div>
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-primary">
            <Inbox className="h-5 w-5" />
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-2xl border border-border/80 bg-slate-50/80 p-5">
            <label className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              Initial processing window
            </label>
            <p className="mt-2 text-sm text-muted-foreground">
              Pick how far back to scan before switching to new incoming mail only.
            </p>
            <div className="mt-4">
              <Select
                aria-label="Initial processing window"
                value={lookback}
                onChange={(event) =>
                  setLookback(event.target.value as UserSettings["initialAutodraftLookback"])
                }
              >
                {lookbackOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatLookbackLabel(option)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
            <Button variant="outline" onClick={onSkip} disabled={isStarting || isSkipping}>
              {isSkipping ? "Skipping..." : "Skip for now"}
            </Button>
            <Button onClick={onStart} disabled={isStarting || isSkipping}>
              {isStarting ? "Starting..." : "Start processing"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

type DashboardAction = "redo" | "clear";

function ActionConfirmationModal({
  action,
  lookbackLabel,
  onConfirm,
  onCancel,
  isConfirming,
  onClose,
}: {
  action: DashboardAction;
  lookbackLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
  onClose: () => void;
}) {
  const isRedo = action === "redo";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/10 px-4">
      <div className="absolute inset-0 bg-white/25 backdrop-blur-[3px]" />
      <Card className="relative z-10 w-full max-w-md overflow-hidden border-border/80 bg-white/95 p-0 shadow-[0_28px_90px_-38px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
              {isRedo ? "Re-run" : "Remove"}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.045em] text-foreground">
              {isRedo ? "Confirm redo draft run?" : "Clear latest app drafts?"}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">
              {isRedo
                ? `This will rerun the draft agent on inbox threads from the last ${lookbackLabel}, replacing any existing app-generated drafts from this range.`
                : `This will delete app-generated drafts from the last ${lookbackLabel} before continuing. Existing sent replies in Gmail are not affected.`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 px-6 py-5">
          <Button variant="outline" onClick={onCancel} disabled={isConfirming}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={isConfirming}
          >
            {isConfirming ? `${isRedo ? "Redoing" : "Clearing"}...` : `Confirm ${isRedo ? "redo" : "clear"}`}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function EmptyDashboard({
  connectPending,
  onConnect,
}: {
  connectPending: boolean;
  onConnect: () => void;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-6 py-6">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-primary">
          <Inbox className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-foreground">
          Connect Gmail to start drafting
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          Authorize your inbox once and the dashboard will start monitoring for matching email threads and
          generating ready-to-review drafts.
        </p>
        <div className="mt-6 flex max-w-sm flex-col gap-3">
          <Button onClick={onConnect} disabled={connectPending}>
            {connectPending ? "Connecting..." : "Connect Gmail"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function BillingRequiredDashboard() {
  const accessEntry = commercialFrontendModule.accessEntry;
  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
          Billing required
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
          Start a ReplyJoy plan or redeem an access code before connecting Gmail and loading drafts.
        </p>
      </div>
      {accessEntry ? (
        <Button asChild>
          <Link to={accessEntry.to}>{accessEntry.label}</Link>
        </Button>
      ) : null}
    </Card>
  );
}

function ConnectedDashboard({
  gmail,
  accessState,
  lookback,
  setLookback,
  processingThreadCount,
  syncProgress,
  onSync,
  syncPending,
  onRedo,
  redoPending,
  onClear,
  clearPending,
  advancedOpen,
  setAdvancedOpen,
}: {
  gmail: GmailStatus;
  accessState?: Pick<EntitlementState, "billingEnabled" | "hasAccess"> | null;
  lookback: UserSettings["initialAutodraftLookback"];
  setLookback: (value: UserSettings["initialAutodraftLookback"]) => void;
  onSync: () => void;
  syncPending: boolean;
  onRedo: () => void;
  redoPending: boolean;
  onClear: () => void;
  clearPending: boolean;
  advancedOpen: boolean;
  setAdvancedOpen: (open: boolean) => void;
  syncProgress: SyncProgress | null;
  processingThreadCount: number;
}) {
  const isProcessing = Boolean(
    syncProgress &&
      (syncProgress.active > 0 ||
        (syncProgress.total > 0 && syncProgress.completed < syncProgress.total))
  ) || processingThreadCount > 0;
  const syncBusy =
    gmail.syncStatus === "syncing" || syncPending || redoPending || clearPending || isProcessing;
  const [now, setNow] = useState(Date.now());
  const [pendingAction, setPendingAction] = useState<DashboardAction | null>(null);

  const redoHelpText = `Re-run app draft generation on inbox threads from the last ${formatLookbackLabel(
    lookback,
  )} and replace prior app drafts in that window.`;
  const clearHelpText = `Delete app-generated drafts from the last ${formatLookbackLabel(lookback)} only.`;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const lastPolledAt = gmail.lastPolledAt ? new Date(gmail.lastPolledAt).getTime() : null;
  const lastSyncAttemptAt = gmail.lastSyncAttemptAt
    ? new Date(gmail.lastSyncAttemptAt).getTime()
    : lastPolledAt;
  const nextScheduledSyncAt = lastSyncAttemptAt ? lastSyncAttemptAt + 60_000 : null;
  const isScheduledCheckStarting = Boolean(
    !syncBusy &&
      nextScheduledSyncAt &&
      now >= nextScheduledSyncAt &&
      now - nextScheduledSyncAt < SYNC_GRACE_WINDOW_MS,
  );
  const countdownText = useMemo(() => {
    if (syncBusy || isScheduledCheckStarting) {
      if (isProcessing) {
        return "Agent drafting";
      }
      return "Checking for new emails";
    }
    if (!lastSyncAttemptAt) {
      return null;
    }
    const nextSyncAt = nextScheduledSyncAt ?? lastSyncAttemptAt + 60_000;
    return `Next sync in ${formatCountdown(nextSyncAt)}`;
  }, [isProcessing, isScheduledCheckStarting, lastSyncAttemptAt, nextScheduledSyncAt, now, syncBusy]);

  const syncLabel = syncBusy || syncPending ? "Syncing..." : "Run sync now";
  const syncStatusLabel = syncBusy ? "syncing" : gmail.syncStatus ?? "unknown";

  const ActionInfoButton = ({ text, label }: { text: string; label: string }) => (
    <button
      type="button"
      onClick={(event) => event.preventDefault()}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-background/70 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      aria-label={label}
      title={text}
      tabIndex={0}
    >
      <CircleHelp className="h-4 w-4" />
    </button>
  );

  const ActionCard = ({
    title,
    description,
    button,
  }: {
    title: string;
    description: string;
    button: React.ReactNode;
  }) => (
    <div className="rounded-2xl border border-border/80 bg-white/75 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{button}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border/80 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Dashboard</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
                Review drafts and run inbox automation
              </h1>
              {gmail.googleEmail ? (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">Connected inbox: {gmail.googleEmail}</p>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                    Monitoring scope: <span className="font-medium text-foreground">{INBOX_FILTER_TITLE}</span>.{" "}
                    {INBOX_FILTER_DESCRIPTION}
                  </p>
                </>
              ) : null}
            </div>
            <div className="rounded-full border border-border/80 bg-slate-50 px-3 py-1.5 text-xs uppercase tracking-[0.22em] text-muted-foreground">
              {syncStatusLabel}
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              Last successful sync
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">
              {gmail.lastSuccessfulSyncAt
                ? new Date(gmail.lastSuccessfulSyncAt).toLocaleString()
                : "No successful sync yet"}
            </div>
            {gmail.syncStatus === "error" && gmail.lastSyncError ? (
              <StatusBanner tone="error" className="mt-3">
                Gmail sync failed: {gmail.lastSyncError}
              </StatusBanner>
            ) : null}
            {countdownText ? (
              <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-primary">
                {syncBusy || isScheduledCheckStarting ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {countdownText}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start justify-end gap-3 rounded-2xl border border-border/80 bg-slate-50 p-4">
            <Button variant="secondary" onClick={onSync} disabled={syncBusy || syncPending || redoPending || clearPending}>
              <RefreshCcw className={syncBusy || syncPending ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
              {syncLabel}
            </Button>
            <Button
              variant="outline"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              disabled={syncBusy || syncPending || redoPending || clearPending}
            >
              More options
              {advancedOpen ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
            </Button>

            {advancedOpen ? (
              <div className="w-full rounded-2xl border border-border/80 bg-white/70 p-4">
                <div className="space-y-2">
                  <label className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Process older emails
                  </label>
                  <Select
                    aria-label="Lookback window"
                    value={lookback}
                    onChange={(event) =>
                      setLookback(event.target.value as UserSettings["initialAutodraftLookback"])
                    }
                  >
                    {lookbackOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatLookbackLabel(option)}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        RERUN INITIAL WINDOW
                      </p>
                    </div>
                    <ActionInfoButton
                      label="Redo draft run details"
                      text={redoHelpText}
                    />
                  </div>
                  <ActionCard
                    title="Redo draft run"
                    description={`Rerun draft selection over inbox threads from the last ${formatLookbackLabel(
                      lookback,
                    )}, replacing any existing app drafts from that window.`}
                    button={
                      <Button
                        onClick={() => setPendingAction("redo")}
                        disabled={redoPending || clearPending || syncBusy || syncPending}
                        className="w-full sm:w-auto"
                      >
                        {redoPending ? "Redoing..." : "Redo drafts"}
                      </Button>
                    }
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        HOUSEKEEPING
                      </p>
                    </div>
                    <ActionInfoButton
                      label="Clear app draft details"
                      text={clearHelpText}
                    />
                  </div>
                  <ActionCard
                    title="Clear latest app drafts"
                    description={`Delete app-generated drafts for inbox threads from the last ${formatLookbackLabel(lookback)} only.`}
                    button={
                      <Button
                        variant="outline"
                        onClick={() => setPendingAction("clear")}
                        disabled={clearPending || redoPending || syncBusy || syncPending}
                        className="w-full sm:w-auto"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {clearPending ? "Clearing..." : "Clear latest app drafts"}
                      </Button>
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {pendingAction ? (
        <ActionConfirmationModal
          action={pendingAction}
          lookbackLabel={formatLookbackLabel(lookback)}
          isConfirming={pendingAction === "redo" ? redoPending : clearPending}
          onConfirm={() => {
            if (pendingAction === "redo") {
              onRedo();
            } else {
              onClear();
            }
          }}
          onCancel={() => setPendingAction(null)}
          onClose={() => setPendingAction(null)}
        />
      ) : null}

        <DraftWorkspace accessState={accessState} />
    </div>
  );
}

function DashboardContent() {
  const fetcher = useAuthedFetcher();
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<FlashBanner | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [lookback, setLookback] = useState<UserSettings["initialAutodraftLookback"]>("1d");
  const [initialChoiceDismissed, setInitialChoiceDismissed] = useState(false);

  useEffect(() => {
    if (!flash || flash.tone !== "success") {
      return;
    }
    const timeoutId = window.setTimeout(() => setFlash(null), 4_000);
    return () => window.clearTimeout(timeoutId);
  }, [flash]);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetcher<EntitlementState & { settings: UserSettings }>("/api/settings"),
    staleTime: 30_000,
  });

  const gmailStatusQuery = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => fetcher<{ gmail: GmailStatus }>("/api/gmail/status"),
    refetchInterval: (query) => getSyncStatusPollInterval(query.state.data?.gmail ?? null, Date.now()),
    refetchIntervalInBackground: true,
  });
  const accessDenied = Boolean(
    settingsQuery.data?.billingEnabled && !settingsQuery.data?.hasAccess,
  );
  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    queryFn: () =>
      fetcher<{
        drafts: Array<Record<string, unknown>>;
        processingThreads: Array<Record<string, unknown>>;
        syncProgress: SyncProgress | null;
      }>("/api/drafts"),
    enabled: Boolean(gmailStatusQuery.data?.gmail?.connected) && !accessDenied,
    retry: (failureCount, error) =>
      !hasApiStatus(error, 402) && failureCount < 2,
    refetchInterval: (query) => {
      if (accessDenied) {
        return false;
      }
      if (hasApiStatus(query.state.error, 402)) {
        return false;
      }
      return gmailStatusQuery.data?.gmail?.syncStatus === "syncing" ? 1_000 : 5_000;
    },
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (settingsQuery.data?.settings?.initialAutodraftLookback) {
      setLookback(settingsQuery.data.settings.initialAutodraftLookback);
    }
  }, [settingsQuery.data?.settings?.initialAutodraftLookback]);

  useEffect(() => {
    if (!gmailStatusQuery.data?.gmail?.connected) {
      setInitialChoiceDismissed(false);
    }
  }, [gmailStatusQuery.data?.gmail?.connected]);

  const setOptimisticSyncingStatus = async () => {
    await queryClient.cancelQueries({ queryKey: ["gmail-status"] });

    const previousStatus = queryClient.getQueryData<{ gmail: GmailStatus }>(["gmail-status"]);
    const startedAt = new Date().toISOString();

    queryClient.setQueryData<{ gmail: GmailStatus }>(["gmail-status"], (current) => {
      if (!current?.gmail) {
        return current;
      }

      return {
        gmail: {
          ...current.gmail,
          syncStatus: "syncing",
          lastSyncError: null,
          lastSyncAttemptAt: startedAt,
        },
      };
    });

    return { previousStatus };
  };

  const connectMutation = useMutation({
    mutationFn: () =>
      fetcher<{ url: string }>("/api/gmail/connect/start", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error) => {
      setFlash({
        tone: "error",
        message: formatDashboardActionError(error, "Could not start the Gmail connection."),
      });
    },
  });

  const startInitialProcessingMutation = useMutation({
    mutationFn: () =>
      fetcher<{ ok: boolean }>("/api/gmail/initial-processing", {
        method: "POST",
        body: JSON.stringify({ lookback }),
      }),
    onSuccess: async () => {
      setInitialChoiceDismissed(true);
      setFlash({ tone: "success", message: "Initial processing started." });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    },
    onError: (error) => {
      setFlash({
        tone: "error",
        message: formatDashboardActionError(error, "Could not start initial processing."),
      });
    },
  });

  const skipInitialProcessingMutation = useMutation({
    mutationFn: () =>
      fetcher<{ ok: boolean }>("/api/gmail/initial-processing/skip", {
        method: "POST",
      }),
    onSuccess: async () => {
      setInitialChoiceDismissed(true);
      setFlash({ tone: "success", message: "Initial processing skipped. New email will still be monitored." });
      await queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
    },
    onError: (error) => {
      setFlash({
        tone: "error",
        message: formatDashboardActionError(error, "Could not skip initial processing."),
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      fetcher<{
        ok: boolean;
        emailsFound?: number;
        draftsCreated?: number;
      }>("/api/gmail/resync", { method: "POST" }),
    onMutate: () => setOptimisticSyncingStatus(),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
      ]);
      const emailsFound = data.emailsFound ?? 0;
      const draftsCreated = data.draftsCreated ?? 0;
      const foundText =
        emailsFound === 0
          ? "No new emails found."
          : `${emailsFound} email${emailsFound === 1 ? "" : "s"} found.`;
      setFlash({
        tone: "success",
        message: `${foundText} ${draftsCreated} draft${draftsCreated === 1 ? "" : "s"} created.`,
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previousStatus) {
        queryClient.setQueryData(["gmail-status"], context.previousStatus);
      }
      setFlash({
        tone: "error",
        message: formatDashboardActionError(error, "Could not run a manual sync."),
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
      ]);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      fetcher<{ clearedCount: number }>("/api/drafts/clear-autodraft", {
        method: "POST",
        body: JSON.stringify({ lookback }),
      }),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
      ]);
      setFlash({
        tone: "success",
        message: `Cleared ${data.clearedCount} draft${data.clearedCount === 1 ? "" : "s"} from the last ${formatLookbackLabel(lookback)}.`,
      });
    },
    onError: (error) => {
      setFlash({
        tone: "error",
        message: formatDashboardActionError(error, "Could not clear drafts for this lookback window."),
      });
    },
  });

  const redoMutation = useMutation({
    mutationFn: async () => {
      const settings = settingsQuery.data?.settings;
      if (settings && settings.initialAutodraftLookback !== lookback) {
        await fetcher<{ settings: UserSettings }>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify({
            ...settings,
            initialAutodraftLookback: lookback,
          }),
        });
      }
      return fetcher<{ ok: boolean }>("/api/drafts/redo-autodraft", {
        method: "POST",
        body: JSON.stringify({ lookback }),
      });
    },
    onMutate: () => setOptimisticSyncingStatus(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
      ]);
      setFlash({ tone: "success", message: "Redo started." });
    },
    onError: (error, _variables, context) => {
      if (context?.previousStatus) {
        queryClient.setQueryData(["gmail-status"], context.previousStatus);
      }
      setFlash({
        tone: "error",
        message: formatDashboardActionError(error, "Could not redo drafts."),
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gmail-status"] }),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
      ]);
    },
  });

  const isLoading =
    settingsQuery.isLoading || gmailStatusQuery.isLoading;

  if (isLoading) {
    return (
      <Card className="flex items-center gap-3">
        <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
        Loading dashboard...
      </Card>
    );
  }

  const blockingError = settingsQuery.error ?? gmailStatusQuery.error;
  if (blockingError) {
    return <Card>Failed to load dashboard: {(blockingError as Error).message}</Card>;
  }

  const settings = settingsQuery.data?.settings;
  const accessState = settingsQuery.data ?? null;
  const gmail = gmailStatusQuery.data?.gmail ?? null;

  if (!settings) {
    return <Card>Failed to load dashboard.</Card>;
  }

  if (accessDenied) {
    return (
      <>
        {flash ? <StatusBanner tone={flash.tone}>{flash.message}</StatusBanner> : null}
        <BillingRequiredDashboard />
      </>
    );
  }

  const showInitialProcessingModal = Boolean(
    gmail?.connected && gmail.needsInitialProcessingChoice && !initialChoiceDismissed,
  );

  return (
    <>
      {flash ? <StatusBanner tone={flash.tone}>{flash.message}</StatusBanner> : null}

      {showInitialProcessingModal ? (
        <InitialProcessingModal
          lookback={lookback}
          setLookback={setLookback}
          onStart={() => startInitialProcessingMutation.mutate()}
          onSkip={() => skipInitialProcessingMutation.mutate()}
          isStarting={startInitialProcessingMutation.isPending}
          isSkipping={skipInitialProcessingMutation.isPending}
        />
      ) : null}

      {!gmail?.connected ? (
        <EmptyDashboard
          connectPending={connectMutation.isPending}
          onConnect={() => connectMutation.mutate()}
        />
      ) : (
      <ConnectedDashboard
          gmail={gmail}
          accessState={accessState}
          syncProgress={draftsQuery.data?.syncProgress ?? null}
          processingThreadCount={draftsQuery.data?.processingThreads?.length ?? 0}
          lookback={lookback}
          setLookback={setLookback}
          onSync={() => syncMutation.mutate()}
          syncPending={syncMutation.isPending}
          onRedo={() => redoMutation.mutate()}
          redoPending={redoMutation.isPending}
          onClear={() => clearMutation.mutate()}
          clearPending={clearMutation.isPending}
          advancedOpen={advancedOpen}
          setAdvancedOpen={setAdvancedOpen}
        />
      )}
    </>
  );
}

export function DashboardPage() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return <Card className="flex items-center gap-3">Checking auth…</Card>;
  }

  if (!isSignedIn) {
    return (
      <Card className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
          Sign in to open your dashboard
        </h1>
        <p className="text-sm leading-7 text-muted-foreground">
          Connect Gmail and review generated drafts from a single dashboard once you sign in.
        </p>
        <SignInButton mode="modal">
          <Button>Get started</Button>
        </SignInButton>
      </Card>
    );
  }

  return (
    <DashboardContent />
  );
}
