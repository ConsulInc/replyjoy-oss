import { type Response, type Router as ExpressRouter, Router } from "express";
import { clerkMiddleware, requireAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client.js";
import {
  defaultModelByProvider,
  lookbackOptions,
  isAllowedAgentModelSelection,
  normalizeAgentModel,
} from "../config/agent-config.js";
import {
  draftReplies,
  emailThreads,
  gmailAccounts,
  syncRuns,
  userSettings,
} from "../db/schema.js";
import { buildConsentUrl } from "../gmail/client.js";
import { signState } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import type { EntitlementsService } from "../services/entitlements.js";
import { ensureLocalUser } from "../services/users.js";
import {
  clearAutodraftBatch,
  clearAutodraftThread,
  clearAutodraftWindow,
  getCurrentSyncProgress,
  listProcessingThreads,
  listRecentDrafts,
  redoAutodraftBatch,
  redoAutodraftThread,
  suggestRuleFromFeedback,
  syncUserAccount,
} from "../services/gmail-sync.js";

const lookbackSchema = z.enum(lookbackOptions as [string, ...string[]]);
type Lookback = "1d" | "2d" | "3d" | "4d" | "5d";
const settingsSchema = z.object({
  draftingRules: z.array(z.string().trim().min(1).max(500)).default([]),
  agentProvider: z.literal("gemini"),
  agentModel: z.string().min(1).max(200),
  initialAutodraftLookback: lookbackSchema,
  autodraftEnabled: z.boolean().optional(),
});
const clearDraftsSchema = z.object({
  batchId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  lookback: lookbackSchema.optional(),
});
const redoDraftsSchema = z.object({
  lookback: lookbackSchema,
});
const ruleSuggestionSchema = z.object({
  threadId: z.string().min(1),
  feedback: z.string().trim().min(2).max(1_000),
  generatedText: z.string().max(8_000).optional(),
  selectionReason: z.string().max(1_000).optional(),
  subject: z.string().max(1_000).optional(),
  fromEmail: z.string().max(320).optional(),
});

const draftingRuleListSchema = z.array(z.string().trim().min(1).max(500));

function normalizeDraftingRules(rules: string[]) {
  return draftingRuleListSchema.parse(
    rules
      .flatMap((rule) => rule.split("\n"))
      .map((rule) => rule.trim())
      .filter((rule) => rule.length > 0),
  );
}
export function createProtectedRouter(input: {
  entitlements: EntitlementsService;
  commercialRouter?: ExpressRouter;
}) {
  const router = Router();

  async function requireBillingAccess(userId: string, res: Response) {
    const accessResult = await input.entitlements.requireAccess(userId);
    if (!accessResult.allowed) {
      res.status(accessResult.status).json({
        error: accessResult.error,
        appMode: accessResult.accessState.appMode,
        billingEnabled: accessResult.accessState.billingEnabled,
        subscription: accessResult.accessState.subscription,
        hasAccess: accessResult.accessState.hasAccess,
      });
      return false;
    }

    return true;
  }

  router.use(clerkMiddleware());
  router.use(requireAuth());
  if (input.commercialRouter) {
    router.use("/billing", input.commercialRouter);
  }

  router.get("/me", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const accessState = await input.entitlements.getAccessState(user.id);
      res.json({
        user: {
          id: user.id,
          email: user.email,
        },
        appMode: accessState.appMode,
        billingEnabled: accessState.billingEnabled,
        subscription: accessState.subscription,
        hasAccess: accessState.hasAccess,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const accessState = await input.entitlements.getAccessState(user.id);
      const settings = await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, user.id),
      });
      const agentProvider = "gemini" as const;
      const agentModel = normalizeAgentModel(
        agentProvider,
        settings?.agentProvider === "gemini" ? settings.agentModel : defaultModelByProvider.gemini,
      );
      const draftingRules = normalizeDraftingRules(settings?.draftingRules ?? []);

      res.json({
        appMode: accessState.appMode,
        billingEnabled: accessState.billingEnabled,
        subscription: accessState.subscription,
        hasAccess: accessState.hasAccess,
        settings: {
          draftingRules,
          agentProvider,
          agentModel,
          initialAutodraftLookback: settings?.initialAutodraftLookback ?? lookbackOptions[0],
          autodraftEnabled: settings?.autodraftEnabled ?? true,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/settings", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const payload = settingsSchema.parse(req.body);
      if (!isAllowedAgentModelSelection(payload.agentProvider, payload.agentModel)) {
        res.status(400).json({
          error: "Invalid request",
          issues: [
            {
              path: "agentModel",
              message:
                payload.agentProvider === "gemini"
                  ? `Gemini currently supports only ${defaultModelByProvider.gemini}.`
                  : "Invalid model",
            },
          ],
        });
        return;
      }
      const normalizedModel = normalizeAgentModel(payload.agentProvider, payload.agentModel);

      const [settings] = await db
        .update(userSettings)
        .set({
          draftingRules: normalizeDraftingRules(payload.draftingRules),
          agentProvider: payload.agentProvider,
          agentModel: normalizedModel,
          initialAutodraftLookback: payload.initialAutodraftLookback as Lookback,
          autodraftEnabled: payload.autodraftEnabled ?? true,
        })
        .where(eq(userSettings.userId, user.id))
        .returning();

      const draftingRules = normalizeDraftingRules(settings?.draftingRules ?? []);

      res.json({
        settings: {
          draftingRules,
          agentProvider: settings.agentProvider,
          agentModel: normalizeAgentModel(settings.agentProvider, settings.agentModel),
          initialAutodraftLookback: settings.initialAutodraftLookback,
          autodraftEnabled: settings.autodraftEnabled,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/gmail/status", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const account = await db.query.gmailAccounts.findFirst({
        where: eq(gmailAccounts.userId, user.id),
      });

      res.json({
        gmail: {
          connected: Boolean(account),
          googleEmail: account?.googleEmail ?? null,
        syncStatus: account?.syncStatus ?? null,
        lastSyncError: account?.lastSyncError ?? null,
        lastSuccessfulSyncAt: account?.lastSuccessfulSyncAt?.toISOString() ?? null,
        lastSyncAttemptAt: account?.lastSyncAttemptAt?.toISOString() ?? null,
        lastPolledAt: account?.lastPolledAt?.toISOString() ?? null,
        needsInitialProcessingChoice: Boolean(
          account &&
              !account.initialSyncStartedAt &&
              !account.initialSyncCompletedAt,
          ),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gmail/connect/start", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const state = signState({
        userId: user.id,
        lookback: null,
        exp: Date.now() + 10 * 60 * 1000,
      });
      res.json({ url: buildConsentUrl(state) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gmail/disconnect", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      await Promise.all([
        db.delete(draftReplies).where(eq(draftReplies.userId, user.id)),
        db.delete(syncRuns).where(eq(syncRuns.userId, user.id)),
        db.delete(emailThreads).where(eq(emailThreads.userId, user.id)),
        db.delete(gmailAccounts).where(eq(gmailAccounts.userId, user.id)),
      ]);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gmail/initial-processing", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const payload = redoDraftsSchema.parse(req.body);

      await db
        .update(userSettings)
        .set({ initialAutodraftLookback: payload.lookback as Lookback })
        .where(eq(userSettings.userId, user.id));

      await db
        .update(gmailAccounts)
        .set({
          initialSyncStartedAt: new Date(),
          initialSyncCompletedAt: null,
          syncStatus: "syncing",
          lastSyncError: null,
        })
        .where(eq(gmailAccounts.userId, user.id));

      void syncUserAccount(user.id, {
        runType: "oauth_connect",
        lookbackOverride: payload.lookback,
        forceFreshWindow: true,
      }).catch((error) => {
        logger.error("Initial processing failed", {
          userId: user.id,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gmail/initial-processing/skip", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const skippedAt = new Date();
      await db
        .update(gmailAccounts)
        .set({
        initialSyncStartedAt: skippedAt,
        initialSyncCompletedAt: skippedAt,
        lastSyncAttemptAt: skippedAt,
        lastPolledAt: skippedAt,
        lastSuccessfulSyncAt: skippedAt,
        syncStatus: "synced",
          lastSyncError: null,
        })
        .where(eq(gmailAccounts.userId, user.id));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/gmail/resync", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const result = await syncUserAccount(user.id, { runType: "manual" });
      res.json({
        ok: true,
        emailsFound: result.emailsFound,
        draftsCreated: result.draftsCreated,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/drafts", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const [drafts, processingThreads, syncProgress] = await Promise.all([
        listRecentDrafts(user.id),
        listProcessingThreads(user.id),
        getCurrentSyncProgress(user.id),
      ]);
      res.json({ drafts, processingThreads, syncProgress });
    } catch (error) {
      next(error);
    }
  });

  router.post("/drafts/clear-autodraft", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const payload = clearDraftsSchema.parse(req.body ?? {});

      const result = payload.threadId
        ? await clearAutodraftThread(user.id, payload.threadId)
        : payload.batchId
          ? await clearAutodraftBatch(user.id, payload.batchId)
          : payload.lookback
            ? await clearAutodraftWindow(user.id, payload.lookback)
            : await clearAutodraftBatch(user.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/drafts/:threadId/redo-autodraft", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const threadId = z.string().min(1).parse(req.params.threadId);

      const result = await redoAutodraftThread(user.id, threadId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/drafts/rules/suggest", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const payload = ruleSuggestionSchema.parse(req.body);
      const { rule } = await suggestRuleFromFeedback(user.id, {
        threadId: payload.threadId,
        feedback: payload.feedback,
        generatedText: payload.generatedText,
        selectionReason: payload.selectionReason,
        subject: payload.subject,
        fromEmail: payload.fromEmail,
      });

      res.json({ rule });
    } catch (error) {
      next(error);
    }
  });

  router.post("/drafts/redo-autodraft", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const payload = redoDraftsSchema.parse(req.body);
      const batch = await redoAutodraftBatch(user.id, payload.lookback);
      res.json({
        ok: true,
        batch,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/drafts/:id", async (req, res, next) => {
    try {
      const user = await ensureLocalUser(req);
      const hasAccess = await requireBillingAccess(user.id, res);
      if (!hasAccess) {
        return;
      }
      const drafts = await listRecentDrafts(user.id);
      const draft = drafts.find((item) => item.id === req.params.id);
      if (!draft) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }
      res.json({ draft });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
