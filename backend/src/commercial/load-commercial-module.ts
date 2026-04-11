import path from "node:path";
import { pathToFileURL } from "node:url";

import { env } from "../lib/env.js";
import type { CommercialModule, CommercialModuleFactory } from "./module.js";
import { createCommercialContext } from "./module.js";
import { loadInstalledCommercialModule } from "./installed-module.js";

function resolveCommercialModuleSpecifier(specifier: string) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return pathToFileURL(path.resolve(process.cwd(), specifier)).href;
  }

  return specifier;
}

export async function loadCommercialModule(): Promise<CommercialModule | null> {
  if (env.APP_MODE !== "saas") {
    return null;
  }

  if (!env.COMMERCIAL_MODULE_PATH) {
    return loadInstalledCommercialModule(createCommercialContext());
  }

  const imported = await import(resolveCommercialModuleSpecifier(env.COMMERCIAL_MODULE_PATH));
  const factory = imported.createCommercialModule as CommercialModuleFactory | undefined;

  if (typeof factory !== "function") {
    throw new Error("Commercial module must export createCommercialModule(context).");
  }

  return factory(createCommercialContext());
}
