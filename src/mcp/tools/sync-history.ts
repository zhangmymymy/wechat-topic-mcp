// src/mcp/tools/sync-history.ts
/**
 * MCP tool to trigger local WeChat DB decryption and history import.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../shared/types.js";
import { syncWeChat, importOnly } from "../../collector/sync.js";

export function registerSyncTools(
  server: McpServer,
  db: Database.Database,
  config: AppConfig,
): void {
  // ── sync_history ──
  server.tool(
    "sync_history",
    "Import historical WeChat messages from local encrypted databases. Requires: macOS with WeChat logged in, SIP disabled, Frida installed. Runs: key extraction → decryption → import.",
    {
      import_only: {
        type: "boolean",
        description:
          "If true, skip key extraction and decryption — only import from already-decrypted databases. Useful when databases were decrypted manually.",
      },
    },
    async ({ import_only }) => {
      try {
        const result = import_only
          ? importOnly(db, config)
          : syncWeChat(db, config);

        return {
          content: [
            {
              type: "text" as const,
              text: `History sync complete: ${result.newMessages} new messages imported, ${result.newGroups} new groups found.${result.lastTimestamp ? ` Latest message: ${result.lastTimestamp}` : ""}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Sync failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
