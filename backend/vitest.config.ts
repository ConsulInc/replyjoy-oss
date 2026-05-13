import { defineConfig } from "vitest/config";

process.env.CLERK_SECRET_KEY ??= "test_clerk_secret_key";
process.env.DATABASE_URL ??= "file::memory:";
process.env.GOOGLE_CLIENT_ID ??= "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
process.env.GMAIL_TOKEN_ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef"; // pragma: allowlist secret

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
