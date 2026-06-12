import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { initAgentLoader } from "./services/agentLoader.service.js";
import { AGENT_HOOKS } from "./agents/hooks.js";
import { registerAgentHooks } from "./services/agentLoader.service.js";
import { startBackgroundSchedulers } from "./workers/background.scheduler.js";
import { startChatWorker } from "./workers/chat.worker.js";
import { startFileWorker } from "./workers/file.worker.js";
import { startNotificationWorker } from "./workers/notification.worker.js";
import { startBenchmarkWorker } from "./workers/benchmark.worker.js";
import { logger } from "./utils/logger.js";

// Register hook implementations before loading agents so they get attached.
registerAgentHooks(AGENT_HOOKS);

// Load all agents from DB before the server starts accepting requests.
await initAgentLoader();

const app = buildApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "http_listening");
  startBackgroundSchedulers();
  startChatWorker();
  startFileWorker();
  startNotificationWorker();
  startBenchmarkWorker();
  logger.info("queue_workers_started");
});

const gracefulShutdown = (signal: string) => {
  logger.info({ signal }, "shutdown_started");
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "shutdown_failed");
      process.exit(1);
    }
    logger.info("shutdown_completed");
    process.exit(0);
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
