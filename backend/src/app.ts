import cors from "cors";
import express from "express";
import { ZodError } from "zod";

import type { CommercialModule } from "./commercial/module.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { publicRouter } from "./routes/public.js";
import { createProtectedRouter } from "./routes/protected.js";
import { ossEntitlements } from "./services/entitlements-oss.js";

export function createApp(options: { commercialModule?: CommercialModule | null } = {}) {
  const app = express();
  const commercialModule = options.commercialModule ?? null;
  const entitlements = commercialModule?.entitlements ?? ossEntitlements;

  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );

  commercialModule?.registerPreJsonRoutes?.(app);
  app.use(express.json({ limit: "2mb" }));

  app.use(publicRouter);
  app.use(
    "/api",
    createProtectedRouter({
      entitlements,
      commercialRouter: commercialModule?.protectedRouter,
    }),
  );

  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      logger.error("Request failed", {
        path: req.path,
        method: req.method,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof ZodError) {
        res.status(400).json({
          error: "Invalid request",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
        return;
      }

      const payload = {
        error: error instanceof Error ? error.message : "Internal server error",
      };

      if (req.path.startsWith("/api")) {
        res.status(500).json(payload);
        return;
      }

      res.status(500).send(payload.error);
    },
  );

  return app;
}
