import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/client.js";
import { gmailAccounts } from "../db/schema.js";
import { exchangeCodeForTokens, createGmailClient } from "../gmail/client.js";
import { encryptSecret, verifyState } from "../lib/crypto.js";
import { env } from "../lib/env.js";
import { createId } from "../lib/id.js";
import { logger } from "../lib/logger.js";

const router = Router();
const supportInbox = env.SUPPORT_TO_EMAIL;
const supportFromEmail = env.SUPPORT_FROM_EMAIL;

const supportRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5_000),
  email: z.string().trim().email(),
});

async function sendSupportEmail(input: { title: string; body: string; email: string }) {
  if (!env.RESEND_API_KEY || !supportInbox || !supportFromEmail) {
    return { ok: false as const, error: "Support email is not configured." };
  }

  const submittedAt = new Date().toISOString();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: supportFromEmail,
      to: [supportInbox],
      subject: `Support request: ${input.title}`,
      text: [
        `From: ${input.email}`,
        `Submitted at: ${submittedAt}`,
        "",
        `Title: ${input.title}`,
        "",
        input.body,
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const message = (await response.text()) || "Unable to send support email.";
    return { ok: false as const, error: message };
  }

  return { ok: true as const };
}

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.post("/api/public/support", async (req, res, next) => {
  try {
    const payload = supportRequestSchema.parse(req.body);
    const result = await sendSupportEmail(payload);

    if (!result.ok) {
      logger.error("Failed to send support email", {
        errorMessage: result.error,
      });
      res.status(502).json({ error: result.error });
      return;
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/google/callback", async (req, res, next) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).send("Missing code or state");
      return;
    }

    const parsed = verifyState<{ userId: string; lookback: string | null; exp: number }>(state);
    if (parsed.exp < Date.now()) {
      res.status(400).send("Expired OAuth state");
      return;
    }

    const tokens = await exchangeCodeForTokens(code);
    const gmail = createGmailClient({
      refreshToken: tokens.refresh_token ?? "",
      accessToken: tokens.access_token,
      expiryDate: tokens.expiry_date,
    });
    const profile = await gmail.users.getProfile({ userId: "me" });

    const existing = await db.query.gmailAccounts.findFirst({
      where: eq(gmailAccounts.userId, parsed.userId),
    });

    const refreshToken = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : existing?.refreshTokenEncrypted;
    if (!refreshToken) {
      throw new Error("Missing refresh token from Google OAuth");
    }

    const accessToken = tokens.access_token ? encryptSecret(tokens.access_token) : null;

    if (existing) {
      await db
        .update(gmailAccounts)
        .set({
          googleEmail: profile.data.emailAddress ?? existing.googleEmail,
          googleSub: existing.googleSub,
          lastHistoryId: profile.data.historyId ?? existing.lastHistoryId,
          refreshTokenEncrypted: refreshToken,
          accessTokenEncrypted: accessToken,
          tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          scopes: tokens.scope ?? existing.scopes,
          connectedAt: new Date(),
          syncStatus: "connected",
          lastSyncError: null,
        })
        .where(eq(gmailAccounts.id, existing.id));
    } else {
      await db.insert(gmailAccounts).values({
        id: createId("gmail"),
        userId: parsed.userId,
        googleEmail: profile.data.emailAddress ?? null,
        googleSub: null,
        lastHistoryId: profile.data.historyId ?? null,
        refreshTokenEncrypted: refreshToken,
        accessTokenEncrypted: accessToken,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: tokens.scope ?? null,
        syncStatus: "connected",
        lastSyncError: null,
      });
    }

    logger.info("Connected Gmail account", {
      userId: parsed.userId,
      googleEmail: profile.data.emailAddress ?? null,
      hasRefreshToken: Boolean(tokens.refresh_token || existing?.refreshTokenEncrypted),
    });

    res.redirect(`${env.FRONTEND_URL}/app?gmail=connected`);
  } catch (error) {
    next(error);
  }
});

export { router as publicRouter };
