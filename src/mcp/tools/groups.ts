// src/mcp/tools/groups.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { getAllGroups, getGroupActivity } from "../../shared/db/queries.js";

export function registerGroupTools(server: McpServer, db: Database.Database): void {
  server.tool(
    "list_groups",
    "List all monitored WeChat groups.",
    {},
    async () => {
      const groups = getAllGroups(db);
      if (groups.length === 0) {
        return { content: [{ type: "text" as const, text: "No groups being monitored yet." }] };
      }
      const text = groups.map((g) => `• ${g.name} (${g.id}) — ${g.member_count} members`).join("\n");
      return { content: [{ type: "text" as const, text: `Monitored groups:\n${text}` }] };
    },
  );

  server.tool(
    "get_group_activity",
    "Get activity statistics for a WeChat group.",
    {
      group_id: z.string().describe("Group ID"),
      time_from: z.string().optional().describe("Start time (ISO 8601). Defaults to 7 days ago"),
      time_to: z.string().optional().describe("End time (ISO 8601). Defaults to now"),
    },
    async ({ group_id, time_from, time_to }) => {
      const from = time_from ?? new Date(Date.now() - 7 * 86400000).toISOString();
      const to = time_to ?? new Date().toISOString();
      const activity = getGroupActivity(db, group_id, from, to);

      const topUsersText = activity.top_users
        .map((u, i) => `  ${i + 1}. ${u.sender_name} — ${u.count} messages`)
        .join("\n");

      const text = [
        `Group Activity: ${group_id}`,
        `Period: ${from} ~ ${to}`,
        `Total Messages: ${activity.message_count}`,
        `Active Users: ${activity.active_users}`,
        ``,
        `Top Contributors:`,
        topUsersText,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
