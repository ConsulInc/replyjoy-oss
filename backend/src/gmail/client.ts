import { google } from "googleapis";

import { env } from "../lib/env.js";

const GOOGLE_API_REQUEST_TIMEOUT_MS = 20_000;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

type GoogleTokens = {
  refreshToken: string;
  accessToken?: string | null;
  expiryDate?: number | null;
};

export function createOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `${env.APP_URL}/auth/google/callback`,
  );
}

function createAuthorizedOAuthClient(tokens: GoogleTokens) {
  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({
    refresh_token: tokens.refreshToken,
    access_token: tokens.accessToken ?? undefined,
    expiry_date: tokens.expiryDate ?? undefined,
  });

  return oauthClient;
}

export function createGmailClient(tokens: GoogleTokens) {
  const oauthClient = createAuthorizedOAuthClient(tokens);

  return google.gmail({
    version: "v1",
    auth: oauthClient,
    timeout: GOOGLE_API_REQUEST_TIMEOUT_MS,
  });
}

export function createCalendarClient(tokens: GoogleTokens) {
  const oauthClient = createAuthorizedOAuthClient(tokens);

  return google.calendar({
    version: "v3",
    auth: oauthClient,
    timeout: GOOGLE_API_REQUEST_TIMEOUT_MS,
  });
}

export function buildConsentUrl(state: string) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}
