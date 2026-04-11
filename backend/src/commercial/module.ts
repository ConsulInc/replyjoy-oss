import type { Express, Request, Router } from "express";

import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { EntitlementsService } from "../services/entitlements.js";
import { ensureLocalUser } from "../services/users.js";

export interface CommercialContext {
  env: typeof env;
  logger: typeof logger;
}

export interface CommercialUser {
  id: string;
  email: string;
}

export interface CommercialModule {
  entitlements: EntitlementsService;
  protectedRouter?: Router;
  registerPreJsonRoutes?: (app: Express) => void;
}

export type CommercialModuleFactory =
  (context: CommercialContext) => Promise<CommercialModule> | CommercialModule;

export async function resolveCommercialUser(req: Request): Promise<CommercialUser> {
  const user = await ensureLocalUser(req);
  if (!user.email) {
    throw new Error("Commercial features require a local user with an email address.");
  }

  return {
    id: user.id,
    email: user.email,
  };
}

export function createCommercialContext(): CommercialContext {
  return {
    env,
    logger,
  };
}
