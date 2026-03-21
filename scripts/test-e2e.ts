#!/usr/bin/env npx tsx
/**
 * End-to-end test: analyze real WeChat messages and push report to Telegram.
 */
import "dotenv/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../src/shared/config.js";
import { createDatabase } from "../src/shared/db/index.js";
import { initSchema } from "../src/shared/db/schema.js";
import { createAIProvider } from "../src/shared/ai/index.js";
import {
  getMessagesByGroup,
  getAllGroups,
  matchesKeyword,
  insertReport,
} from "../src/shared/db/queries.js";
import {
  analyzeTopicFromMessages,
  buildContextMessages,
  buildReportFromAnalysis,
} from "../src/shared/analyzer/index.js";
import { TelegramNotifier } from "../src/collector/notifier/telegram.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const config = loadConfig(resolve(__dirname, "../config.yaml"));
  const db = createDatabase(resolve(__dirname, "..", config.database.path));
  initSchema(db);
  const aiProvider = createAIProvider(config.ai);

  // List groups
  const groups = getAllGroups(db);
  console.log(`\n=== ${groups.length} groups in database ===`);
  for (const g of groups) {
    console.log(`  ${g.name} (${g.id})`);
  }

  // Pick the most active group: "2526 可可托海见" (1961 messages)
  const targetGroup = "57970013451@chatroom";
  const keyword = "滑雪";

  console.log(`\n=== Analyzing keyword "${keyword}" in group ===`);

  // Get all messages from this group
  const messages = getMessagesByGroup(db, targetGroup, "2025-01-01", "2027-01-01");
  console.log(`Total messages in group: ${messages.length}`);

  // Find anchor messages containing the keyword
  const anchors = messages.filter(
    (m) => m.content && matchesKeyword(m.content, keyword, "fuzzy")
  );
  console.log(`Anchor messages for "${keyword}": ${anchors.length}`);

  if (anchors.length === 0) {
    console.log("No anchors found.");
    db.close();
    return;
  }

  // Build context window around anchors
  const contextMsgs = buildContextMessages(
    db,
    anchors.map((a) => a.id),
    targetGroup,
    config.analysis
  );
  console.log(`Context messages for analysis: ${contextMsgs.length}`);

  // Call AI for analysis
  console.log("\nCalling AI for analysis...");
  const result = await analyzeTopicFromMessages(
    contextMsgs,
    keyword,
    aiProvider,
    config.ai.max_context_messages
  );
  console.log("Analysis complete!");
  console.log(`Related messages: ${result.related_message_ids.length}`);
  console.log(`Summary: ${result.report.summary}`);

  // Build and save report
  const groupName = groups.find((g) => g.id === targetGroup)?.name || targetGroup;
  const report = buildReportFromAnalysis(result, {
    keyword,
    groupId: targetGroup,
    timeFrom: messages[0]?.timestamp || "",
    timeTo: messages[messages.length - 1]?.timestamp || "",
  });
  insertReport(db, report);
  console.log("\nReport saved to DB");

  // Push to Telegram
  if (config.notify?.telegram?.bot_token) {
    const tg = new TelegramNotifier(
      config.notify.telegram.bot_token,
      config.notify.telegram.chat_id
    );
    console.log("Pushing to Telegram...");
    await tg.send(report, groupName);
    console.log("Telegram push done! Check your TG.");
  } else {
    console.log("No Telegram config, skipping push.");
  }

  db.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
