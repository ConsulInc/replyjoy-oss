import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
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
  server: {
    port: 5173,
    fs: {
      allow: [frontendDir, path.dirname(commercialFrontendModulePath)],
    },
  },
});
