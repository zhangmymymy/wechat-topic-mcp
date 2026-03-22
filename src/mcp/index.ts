// src/mcp/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../shared/config.js";
import { createDatabase } from "../shared/db/index.js";
import { initSchema } from "../shared/db/schema.js";
import { createAIProvider } from "../shared/ai/index.js";
import { registerQueryTopicTool } from "./tools/query-topic.js";
import { registerSubscriptionTools } from "./tools/subscriptions.js";
import { registerReportTools } from "./tools/reports.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerConnectTools } from "./tools/connect.js";
import { registerSyncTools } from "./tools/sync-history.js";
import { resolve } from "path";
import "dotenv/config";

const configPath = resolve(process.env.CONFIG_PATH ?? "config.yaml");
const config = loadConfig(configPath);
const db = createDatabase(resolve(config.database.path));
initSchema(db);
const aiProvider = createAIProvider(config.ai);

const server = new McpServer({
  name: "wechat-topic-mcp",
  version: "1.0.0",
});

// Register all tools
registerQueryTopicTool(server, db, aiProvider, config);
registerSubscriptionTools(server, db);
registerReportTools(server, db);
registerGroupTools(server, db);
registerConnectTools(server);
registerSyncTools(server, db, config);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Server started via stdio");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
