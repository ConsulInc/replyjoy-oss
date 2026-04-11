import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const commercialFrontendModulePath = process.env.REPLYJOY_COMMERCIAL_FRONTEND_MODULE
  ? path.resolve(frontendDir, process.env.REPLYJOY_COMMERCIAL_FRONTEND_MODULE)
  : path.resolve(frontendDir, "src/commercial/installed-module.tsx");

export default defineConfig({
  envDir: process.env.REPLYJOY_ENV_DIR
    ? path.resolve(frontendDir, process.env.REPLYJOY_ENV_DIR)
    : "..",
  plugins: [react()],
  resolve: {
    alias: {
      "@replyjoy/commercial-frontend": commercialFrontendModulePath,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
