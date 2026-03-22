// src/collector/index.ts
import { loadConfig } from "../shared/config.js";
import { createDatabase } from "../shared/db/index.js";
import { initSchema } from "../shared/db/schema.js";
import { createAIProvider } from "../shared/ai/index.js";
import { createNotifiers } from "./notifier/index.js";
import { KeywordMonitor } from "./monitor.js";
import { syncWeChat } from "./sync.js";
import { cleanupOldMessages, cleanupOldReports } from "../shared/db/queries.js";
import { ILinkPoller, loadCredentials } from "./ilink.js";
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

// ── iLink Real-time Polling ──

let poller: ILinkPoller | null = null;

function startILinkPolling(): void {
  const credentials = loadCredentials();
  if (!credentials) {
    console.log("[Collector] No iLink credentials found. Skipping real-time polling.");
    console.log("[Collector] Use connect_wechat MCP tool to authenticate.");
    return;
  }

  poller = new ILinkPoller(credentials);
  poller.start(db, () => {
    // On each new message, check subscriptions
    const now = new Date().toISOString();
    monitor
      .checkNewMessages(now)
      .catch((err) =>
        console.error("[Collector] Error checking new messages:", err),
      );
  }).catch((err) => {
    console.error("[Collector] iLink polling error:", err);
  });
}

// ── Start ──

async function main() {
  // Run a full local DB sync on startup
  console.log("[Collector] Running initial sync...");
  runSyncAndAnalyze();

  // Start iLink real-time polling if credentials exist
  startILinkPolling();

  // Start subscription cron jobs
  monitor.startCronJobs();

  console.log(
    `[Collector] Started — local sync: ${config.sync.cron}, iLink: ${poller ? "active" : "inactive"}`,
  );
}

// ── Graceful Shutdown ──

process.on("SIGINT", () => {
  console.log("[Collector] Shutting down...");
  poller?.stop();
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
