// src/collector/index.ts
import { loadConfig } from "../shared/config.js";
import { createDatabase } from "../shared/db/index.js";
import { initSchema } from "../shared/db/schema.js";
import { createAIProvider } from "../shared/ai/index.js";
import { createSTTProvider } from "../shared/stt/index.js";
import { createNotifiers } from "./notifier/index.js";
import { createGeWeChatWebhookServer, normalizeMessage } from "./gewechat.js";
import { KeywordMonitor } from "./monitor.js";
import { insertMessage, upsertGroup, getUntranscribedVoiceMessages, updateMessageContent, incrementTranscriptionRetries } from "../shared/db/queries.js";
import { cleanupOldMessages, cleanupOldReports } from "../shared/db/queries.js";
import cron from "node-cron";
import { resolve } from "path";
import "dotenv/config";

const configPath = resolve(process.env.CONFIG_PATH ?? "config.yaml");
const config = loadConfig(configPath);
const db = createDatabase(resolve(config.database.path));
initSchema(db);

const aiProvider = createAIProvider(config.ai);
const sttProvider = createSTTProvider(config.stt);
const notifiers = createNotifiers(config.notify);
const monitor = new KeywordMonitor(db, config, aiProvider, notifiers);

// ── GeweChat Webhook ──

const webhook = createGeWeChatWebhookServer(config.collector.port, (raw) => {
  // Only process group messages
  if (!raw.room_id) return;

  // Upsert group info
  upsertGroup(db, { id: raw.room_id, name: raw.room_name, member_count: 0 });

  // Normalize and store message
  const msg = normalizeMessage(raw);
  insertMessage(db, msg);
  console.log(`[Collector] Message from ${msg.sender_name} in ${raw.room_name}`);

  // Notify monitor
  monitor.onMessage({ ...msg, rowid: undefined });
});

// ── Voice Transcription Retry Job ──

const sttRetryJob = cron.schedule("*/5 * * * *", async () => {
  const untranscribed = getUntranscribedVoiceMessages(db);
  for (const msg of untranscribed) {
    if (!msg.media_url) continue;
    try {
      const text = await sttProvider.transcribe(msg.media_url);
      updateMessageContent(db, msg.id, text);
      console.log(`[STT] Transcribed voice message ${msg.id}`);
      // Re-check against monitor with transcribed content
      monitor.onMessage({ ...msg, content: text });
    } catch (err) {
      incrementTranscriptionRetries(db, msg.id);
      console.error(`[STT] Failed to transcribe ${msg.id}:`, err);
    }
  }
});

// ── Data Retention Cleanup ──

const cleanupJob = cron.schedule(config.retention.cleanup_cron, () => {
  const msgCount = cleanupOldMessages(db, config.retention.messages_days);
  const reportCount = cleanupOldReports(db, config.retention.reports_days);
  console.log(`[Cleanup] Removed ${msgCount} messages, ${reportCount} reports`);
});

// ── Start ──

async function main() {
  await webhook.start();
  monitor.startCronJobs();
  console.log(`[Collector] Started — webhook on port ${config.collector.port}`);
}

// ── Graceful Shutdown ──

process.on("SIGINT", () => {
  console.log("[Collector] Shutting down...");
  webhook.stop();
  monitor.stop();
  sttRetryJob.stop();
  cleanupJob.stop();
  db.close();
  process.exit(0);
});

main().catch((err) => {
  console.error("[Collector] Fatal error:", err);
  process.exit(1);
});
