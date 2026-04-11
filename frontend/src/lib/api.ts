import { useAuth } from "@clerk/clerk-react";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type UserSettings = {
  draftingRules: string[];
  agentProvider: "gemini";
  agentModel: string;
  initialAutodraftLookback: "1d" | "2d" | "3d" | "4d" | "5d";
  autodraftEnabled: boolean;
};

export type GmailStatus = {
  connected: boolean;
  googleEmail: string | null;
  syncStatus: string | null;
  lastSyncError: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastPolledAt: string | null;
  needsInitialProcessingChoice: boolean;
};

export type SubscriptionSummary = {
  id: string;
  status: string;
  accessSource: string;
  accessCodeLabel: string | null;
};

export type AppMode = "oss" | "saas";

export type EntitlementState = {
  appMode: AppMode;
  billingEnabled: boolean;
  hasAccess: boolean;
  subscription: SubscriptionSummary | null;
};

export type BillingStatus = EntitlementState;

export type BillingSubscription = {
  id: string;
  userId: string;
  tierKey: string;
  cadence: "monthly" | "annual";
  status: string;
  accessSource: string;
  accessCodeLabel: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};

export type ViewerState = EntitlementState & {
  user: {
    id: string;
    email: string;
  };
};

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type ReviewSummary = {
  id: string;
  threadId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  latestMessageAt: string;
  selectionReason: string | null;
  attachments: Array<{
    messageId: string;
    attachmentId: string;
    filename: string;
    mimeType: string | null;
    size: number | null;
  }>;
  generatedText: string | null;
  gmailDraftId: string | null;
  gmailThreadId: string;
  decision: "drafted" | "skipped" | "error";
  hasDraft: boolean;
};

export type ProcessingThreadSummary = {
  id: string;
  threadId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  latestMessageAt: string;
  snippet: string | null;
  gmailThreadId: string;
};

export type SyncProgress = {
  total: number;
  completed: number;
  active: number;
};

export type AutodraftBatchSummary = {
  id: string;
  runType: string;
  draftsCount: number;
  startedAt: string;
  finishedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
};

async function readError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json()) as {
      error?: string;
      issues?: Array<{ path?: string; message?: string }>;
    };
    const issueText = body.issues?.map((issue) => issue.message).filter(Boolean).join(", ");
    return body.error || issueText || `Request failed with ${response.status}`;
  }

  return (await response.text()) || `Request failed with ${response.status}`;
}

export async function submitSupportRequest(payload: {
  title: string;
  body: string;
  email: string;
}) {
  const response = await fetch(`${API_URL}/api/public/support`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }

  return response.json() as Promise<{ ok: true }>;
}

export function useAuthedFetcher() {
  const { getToken } = useAuth();

  return async <T>(path: string, init?: RequestInit): Promise<T> => {
    const token = await getToken();
    const headers = new Headers(init?.headers ?? {});
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new ApiError(await readError(response), response.status);
    }

    return response.json() as Promise<T>;
  };
}
