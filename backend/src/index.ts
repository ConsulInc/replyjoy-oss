import { createApp } from "./app.js";
import { loadCommercialModule } from "./commercial/load-commercial-module.js";
import { bootstrapDatabase } from "./db/bootstrap.js";
import { logger } from "./lib/logger.js";
import { env } from "./lib/env.js";
import { recoverAllOrphanedSyncs, syncAllAccounts } from "./services/gmail-sync.js";
const commercialModule = await loadCommercialModule();
const app = createApp({ commercialModule });

await bootstrapDatabase();
logger.info("Database migrations applied");
await recoverAllOrphanedSyncs();
logger.info("Recovered orphaned sync state");

app.listen(env.PORT, () => {
  logger.info("Backend listening", { port: env.PORT, appMode: env.APP_MODE });
});

setInterval(() => {
  void syncAllAccounts();
}, 60_000);

void syncAllAccounts();
