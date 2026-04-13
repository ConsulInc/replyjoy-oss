import { createApp } from "./app.js";
import { loadCommercialModule } from "./commercial/load-commercial-module.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import { logger } from "./lib/logger.js";
import { env } from "./lib/env.js";
import {
  cleanupOldSyncRuns,
  recoverAllOrphanedSyncs,
  syncAllAccounts,
} from "./services/gmail-sync.js";
const commercialModule = await loadCommercialModule();
const app = createApp({ commercialModule });
const SYNC_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let syncCleanupRunning = false;

await bootstrapDatabase();
logger.info("Database migrations applied");
await recoverAllOrphanedSyncs();
logger.info("Recovered orphaned sync state");
try {
  await cleanupOldSyncRuns();
} catch (error) {
  logger.error("Initial sync run retention cleanup failed", {
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

app.listen(env.PORT, () => {
  logger.info("Backend listening", { port: env.PORT, appMode: env.APP_MODE });
});

setInterval(() => {
  void syncAllAccounts();
}, 60_000);

setInterval(() => {
  if (syncCleanupRunning) {
    return;
  }
  syncCleanupRunning = true;
  void cleanupOldSyncRuns()
    .catch((error) => {
      logger.error("Sync run retention cleanup failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      syncCleanupRunning = false;
    });
}, SYNC_CLEANUP_INTERVAL_MS);

void syncAllAccounts();
