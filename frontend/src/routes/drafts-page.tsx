import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle, MailPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { commercialFrontendModule } from "@replyjoy/commercial-frontend";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Select } from "../components/ui/select";
import { StatusBanner } from "../components/ui/status-banner";
import {
  type EntitlementState,
  type GmailStatus,
  type ProcessingThreadSummary,
  type ReviewSummary,
  type SyncProgress,
  useAuthedFetcher,
} from "../lib/api";
import { cn } from "../lib/utils";

const reviewFilterOptions = [
  { value: "with-draft", label: "Only with draft" },
  { value: "without-draft", label: "Only without draft" },
  { value: "all", label: "Show all" },
] as const;

const SYNC_POLL_EARLY_WINDOW_MS = 1_000;
const SYNC_POLL_LATE_WINDOW_MS = 5_000;

type ReviewFilter = (typeof reviewFilterOptions)[number]["value"];
const reviewFilterStorageKey = "draft-workspace-review-filter";

function getAvailableLocalStorage() {
  if (
    typeof window === "undefined" ||
    !window.localStorage ||
    typeof window.localStorage.getItem !== "function" ||
    typeof window.localStorage.setItem !== "function"
  ) {
    return null;
  }

  return window.localStorage;
}

function hasApiStatus(error: unknown, status: number) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

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

function ProcessingQueue({
  processingThreads,
  syncProgress,
}: {
  processingThreads: ProcessingThreadSummary[];
  syncProgress: SyncProgress | null;
}) {
  if (processingThreads.length === 0) {
    return null;
  }

  const completedText =
    syncProgress && syncProgress.total > 0
      ? `Completed ${Math.min(syncProgress.completed, syncProgress.total)}/${syncProgress.total}`
      : null;

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Agent activity</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Threads currently being drafted</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs text-primary">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          {processingThreads.length} active
        </div>
      </div>

      {completedText ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-medium text-primary">
          {completedText}
        </div>
      ) : null}

      <div className="max-h-[420px] overflow-y-auto pr-1">
        <div className="divide-y divide-border/80 rounded-2xl border border-border/80">
          {processingThreads.map((thread) => (
            <div key={thread.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {thread.subject || "(no subject)"}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {thread.fromName || thread.fromEmail || "Unknown sender"}
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-primary">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Agent drafting
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {thread.snippet || "The agent is reviewing this thread and drafting a reply."}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function EmptyDraftState({
  gmail,
}: {
  gmail: GmailStatus;
}) {
  return (
    <div className="space-y-4">
      {gmail.lastSyncError ? (
        <StatusBanner tone="error">Latest sync failed: {gmail.lastSyncError}</StatusBanner>
      ) : null}
      <Card className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <MailPlus className="h-6 w-6" />
        </div>
        <h2 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-foreground">
          No recent drafts
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
          Wait for the minute sync or run a manual sync from the dashboard. Reviewed threads will
          appear here whether the agent drafts a reply or decides to skip.
        </p>
        <Button asChild className="mt-8">
          <Link to="/app/settings">Open settings</Link>
        </Button>
      </Card>
    </div>
  );
}

function BillingRequiredState() {
  const accessEntry = commercialFrontendModule.accessEntry;
  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
          Billing required
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
          Start a ReplyJoy plan or redeem an access code in settings before loading drafts.
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

export function DraftWorkspace({
  accessState,
}: {
  accessState?: Pick<EntitlementState, "billingEnabled" | "hasAccess"> | null;
} = {}) {
  const fetcher = useAuthedFetcher();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const gmailStatusQuery = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => fetcher<{ gmail: GmailStatus }>("/api/gmail/status"),
    refetchInterval: (query) => getSyncStatusPollInterval(query.state.data?.gmail ?? null, now),
    refetchIntervalInBackground: true,
  });
  const accessDenied = Boolean(accessState?.billingEnabled && !accessState.hasAccess);
  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    queryFn: () =>
      fetcher<{
        drafts: ReviewSummary[];
        processingThreads: ProcessingThreadSummary[];
        syncProgress: SyncProgress | null;
      }>("/api/drafts"),
    enabled: !accessDenied,
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
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>(() => {
    const storage = getAvailableLocalStorage();
    if (!storage) {
      return "with-draft";
    }
    const stored = storage.getItem(reviewFilterStorageKey);
    return reviewFilterOptions.some((option) => option.value === stored)
      ? (stored as ReviewFilter)
      : "with-draft";
  });

  const reviews = draftsQuery.data?.drafts ?? [];
  const processingThreads = draftsQuery.data?.processingThreads ?? [];
  const syncProgress = draftsQuery.data?.syncProgress ?? null;
  const gmail = gmailStatusQuery.data?.gmail;
  const processingThreadIds = useMemo(
    () => new Set(processingThreads.map((thread) => thread.threadId)),
    [processingThreads],
  );
  const undraftedProcessingThreads = useMemo(
    () => processingThreads.filter((thread) => !reviews.some((review) => review.threadId === thread.threadId)),
    [processingThreads, reviews],
  );
  const filteredReviews = useMemo(() => {
    if (reviewFilter === "all") {
      return reviews;
    }
    if (reviewFilter === "without-draft") {
      return reviews.filter((review) => !review.hasDraft);
    }
    return reviews.filter((review) => review.hasDraft);
  }, [reviewFilter, reviews]);

  useEffect(() => {
    getAvailableLocalStorage()?.setItem(reviewFilterStorageKey, reviewFilter);
  }, [reviewFilter]);

  useEffect(() => {
    if (filteredReviews.length === 0) {
      setSelectedDraftId(null);
      return;
    }

    if (!selectedDraftId || !filteredReviews.some((review) => review.id === selectedDraftId)) {
      setSelectedDraftId(filteredReviews[0].id);
    }
  }, [filteredReviews, selectedDraftId]);

  const selectedDraft = useMemo(
    () => filteredReviews.find((review) => review.id === selectedDraftId) ?? filteredReviews[0] ?? null,
    [filteredReviews, selectedDraftId],
  );
  const selectedDraftIsProcessing = selectedDraft
    ? processingThreadIds.has(selectedDraft.threadId)
    : false;
  const billingRequiredError = hasApiStatus(draftsQuery.error, 402);

  if (accessDenied || billingRequiredError) {
    return <BillingRequiredState />;
  }

  if ((draftsQuery.isLoading && !draftsQuery.isFetched) || gmailStatusQuery.isLoading) {
    return <Card>Loading drafts...</Card>;
  }

  if (draftsQuery.isError || gmailStatusQuery.isError) {
    const error = (gmailStatusQuery.error ?? draftsQuery.error) as Error;
    return <Card>Failed to load drafts: {error.message}</Card>;
  }

  if (!gmail?.connected) {
    return (
      <Card className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">Connect Gmail first</h2>
          <p className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
            Drafts only appear for the Gmail account connected to the current Clerk user.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/settings">Open settings</Link>
        </Button>
      </Card>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="space-y-4">
        <ProcessingQueue processingThreads={processingThreads} syncProgress={syncProgress} />
        <EmptyDraftState gmail={gmail} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProcessingQueue
        processingThreads={processingThreads}
        syncProgress={syncProgress}
      />

      <Card className="overflow-hidden p-0">
        <div className="grid xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.3fr)]">
          <div className="flex flex-col border-b border-border/80 xl:border-b-0 xl:border-r">
            <div className="border-b border-border/80 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Queue
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-foreground">Recent reviews</h2>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    aria-label="Recent review filter"
                    className="min-w-[180px]"
                    value={reviewFilter}
                    onChange={(event) => setReviewFilter(event.target.value as ReviewFilter)}
                  >
                    {reviewFilterOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <div className="rounded-full border border-border/80 bg-background/55 px-3 py-1 text-xs text-muted-foreground">
                    {filteredReviews.length}
                  </div>
                </div>
              </div>
            </div>

            <div className="max-h-[720px] overflow-y-auto p-0">
              <div className="divide-y divide-border/80 rounded-2xl border border-border/80">
                {filteredReviews.map((draft) => {
                  const isActive = draft.id === selectedDraft?.id;
                  const isProcessing = processingThreadIds.has(draft.threadId);
                  const statusLabel =
                    draft.decision === "drafted"
                      ? "Drafted"
                      : draft.decision === "skipped"
                        ? "No draft"
                        : "Error";
                  return (
                    <button
                      key={draft.id}
                      type="button"
                      onClick={() => setSelectedDraftId(draft.id)}
                      className={cn(
                        "w-full border-0 px-4 py-4 text-left transition-all duration-150",
                        isActive
                          ? "bg-primary/10"
                          : "bg-background/35 hover:bg-secondary/45",
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">
                              {draft.subject || "(no subject)"}
                            </div>
                            <div
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                                draft.decision === "drafted"
                                  ? "border-emerald-300/70 bg-emerald-50 text-emerald-700"
                                  : draft.decision === "skipped"
                                    ? "border-slate-300/80 bg-slate-50 text-slate-600"
                                    : "border-rose-300/70 bg-rose-50 text-rose-700",
                              )}
                            >
                              {statusLabel}
                            </div>
                            {isProcessing ? (
                              <div className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-primary">
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                                Agent drafting
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {draft.fromName || draft.fromEmail || "Unknown sender"}
                          </div>
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          {new Date(draft.latestMessageAt).toLocaleDateString()}
                        </div>
                      </div>
                      {draft.selectionReason ? (
                        <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {draft.selectionReason}
                        </p>
                      ) : null}
                    </button>
                  );
                })}
                </div>
              {filteredReviews.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-background/35 px-4 py-8 text-center text-sm text-muted-foreground">
                  No reviews match this filter yet.
                </div>
              ) : null}
            </div>
          </div>

          <div>
            {selectedDraft ? (
              <>
                <div className="border-b border-border/80 px-5 py-5 sm:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                        Selected draft
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">
                          {selectedDraft.subject || "(no subject)"}
                        </h2>
                        <div
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em]",
                            selectedDraft.decision === "drafted"
                              ? "border-emerald-300/70 bg-emerald-50 text-emerald-700"
                              : selectedDraft.decision === "skipped"
                                ? "border-slate-300/80 bg-slate-50 text-slate-600"
                                : "border-rose-300/70 bg-rose-50 text-rose-700",
                          )}
                        >
                          {selectedDraft.decision === "drafted"
                            ? "Draft ready"
                            : selectedDraft.decision === "skipped"
                              ? "No draft"
                              : "Error"}
                        </div>
                        {selectedDraftIsProcessing ? (
                          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-primary">
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            Agent drafting
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {selectedDraft.fromName || selectedDraft.fromEmail || "Unknown sender"} ·{" "}
                        {new Date(selectedDraft.latestMessageAt).toLocaleString()}
                      </p>
                    </div>

                  <a
                    className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/55 px-4 py-2 text-sm text-foreground"
                    href={
                        selectedDraft.gmailDraftId
                          ? `https://mail.google.com/mail/u/0/#drafts/${selectedDraft.gmailThreadId}`
                          : `https://mail.google.com/mail/u/0/#inbox/${selectedDraft.gmailThreadId}`
                      }
                      rel="noreferrer"
                      target="_blank"
                    >
                      {selectedDraft.gmailDraftId ? "Open draft in Gmail" : "Open thread in Gmail"}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  {selectedDraftIsProcessing ? (
                    <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
                      The agent is still drafting this reply. The note and draft body below will refresh
                      automatically when processing finishes.
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4 px-5 py-5 sm:px-6">
                  <div
                    className={cn(
                      "rounded-2xl border border-emerald-200/70 bg-emerald-50/50 p-5 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)] transition-opacity",
                      selectedDraftIsProcessing && "opacity-75",
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-700/80">
                        {selectedDraft.hasDraft ? "Draft body" : "Result"}
                      </p>
                      {selectedDraftIsProcessing ? (
                        <div className="inline-flex items-center gap-2 text-xs text-primary">
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          Updating draft
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 whitespace-pre-wrap rounded-xl border border-emerald-200/80 bg-white/85 p-4 text-[15px] leading-8 text-slate-950">
                      {selectedDraft.generatedText ??
                        (selectedDraft.decision === "skipped"
                          ? "The agent reviewed this thread and decided not to draft a reply."
                          : "The agent hit an error while reviewing this thread.")}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/75 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                      Agent reasoning
                    </p>
                    <p className="mt-3 rounded-lg border border-slate-200/90 bg-white/80 p-3 text-sm leading-7 text-muted-foreground">
                      {selectedDraft.selectionReason ?? "No note was recorded for this draft."}
                    </p>
                  </div>

                  {selectedDraft.attachments.length > 0 ? (
                    <div className="rounded-2xl border border-border/80 bg-background/45 p-4">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                        Attachments
                      </p>
                      <div className="mt-3 space-y-3">
                        {selectedDraft.attachments.map((attachment) => (
                          <div
                            key={`${attachment.messageId}:${attachment.attachmentId}`}
                            className="rounded-xl border border-border/70 bg-white/80 px-3 py-3"
                          >
                            <div className="text-sm font-medium text-foreground">
                              {attachment.filename || "Untitled attachment"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {attachment.mimeType ?? "Attachment"}
                              {attachment.size != null
                                ? ` · ${(attachment.size / 1024).toFixed(1)} KB`
                                : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Card>

    </div>
  );
}

export function DraftsPage() {
  return <Navigate to="/app" replace />;
}
