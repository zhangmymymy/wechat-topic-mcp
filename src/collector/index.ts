// src/collector/index.ts
import { loadConfig } from "../shared/config.js";
import { createDatabase } from "../shared/db/index.js";
import { initSchema } from "../shared/db/schema.js";
import { createAIProvider } from "../shared/ai/index.js";
import { createNotifiers } from "./notifier/index.js";
import { KeywordMonitor } from "./monitor.js";
import { syncWeChat } from "./sync.js";
import { cleanupOldMessages, cleanupOldReports } from "../shared/db/queries.js";
import cron from "node-cron";
import { resolve } from "path";
import "dotenv/config";

const configPath = resolve(process.env.CONFIG_PATH ?? "config.yaml");
const config = loadConfig(configPath);
const db = createDatabase(resolve(config.database.path));
initSchema(db);

const aiProvider = createAIProvider(config.ai);
const notifiers = createNotifiers(config.notify);
const monitor = new KeywordMonitor(db, config, aiProvider, notifiers);

// ── Sync and Analyze ──

let lastSyncTime: string | null = null;

function runSyncAndAnalyze(): void {
  try {
    const result = syncWeChat(db, config);
    console.log(
      `[Collector] Sync complete: ${result.newMessages} new messages, ${result.newGroups} new groups`,
    );

    // After sync, check new messages against subscriptions
    if (result.newMessages > 0 && lastSyncTime) {
      monitor
        .checkNewMessages(lastSyncTime)
        .catch((err) =>
          console.error("[Collector] Error checking new messages:", err),
        );
    }

    // Update lastSyncTime for next run
    lastSyncTime = result.lastTimestamp ?? new Date().toISOString();
  } catch (err) {
    console.error("[Collector] Sync failed:", err);
  }
}

// ── Periodic Sync Job ──

const syncJob = cron.schedule(config.sync.cron, () => {
  console.log("[Collector] Running scheduled sync...");
  runSyncAndAnalyze();
});

// ── Data Retention Cleanup ──

const cleanupJob = cron.schedule(config.retention.cleanup_cron, () => {
  const msgCount = cleanupOldMessages(db, config.retention.messages_days);
  const reportCount = cleanupOldReports(db, config.retention.reports_days);
  console.log(`[Cleanup] Removed ${msgCount} messages, ${reportCount} reports`);
});

// ── Start ──

async function main() {
  // Run a full sync on startup
  console.log("[Collector] Running initial sync...");
  runSyncAndAnalyze();

  // Start subscription cron jobs
  monitor.startCronJobs();

  console.log(
    `[Collector] Started — sync scheduled at: ${config.sync.cron}`,
  );
}

// ── Graceful Shutdown ──

process.on("SIGINT", () => {
  console.log("[Collector] Shutting down...");
  monitor.stop();
  syncJob.stop();
  cleanupJob.stop();
  db.close();
  process.exit(0);
});

main().catch((err) => {
  console.error("[Collector] Fatal error:", err);
  process.exit(1);
});
