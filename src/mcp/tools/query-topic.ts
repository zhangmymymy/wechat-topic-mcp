// src/mcp/tools/query-topic.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { AIProvider, AppConfig } from "../../shared/types.js";
import { getMessagesByGroup, getAllGroups, searchMessages, insertReport, matchesKeyword } from "../../shared/db/queries.js";
import { analyzeTopicFromMessages, buildContextMessages, buildReportFromAnalysis } from "../../shared/analyzer/index.js";

export function registerQueryTopicTool(
  server: McpServer,
  db: Database.Database,
  aiProvider: AIProvider,
  config: AppConfig,
): void {
  server.tool(
    "query_topic",
    "Query and analyze discussions about a keyword in WeChat groups. Returns a structured report with summary, sentiment, opinions, disputes, and action items.",
    {
      keyword: z.string().describe("The topic keyword to search for"),
      group: z.string().optional().describe("Group ID to search in (omit for all groups)"),
      time_from: z.string().optional().describe("Start time (ISO 8601). Defaults to 24 hours ago"),
      time_to: z.string().optional().describe("End time (ISO 8601). Defaults to now"),
    },
    async ({ keyword, group, time_from, time_to }) => {
      const now = new Date().toISOString();
      const from = time_from ?? new Date(Date.now() - 86400000).toISOString();
      const to = time_to ?? now;

      const groupIds = group ? [group] : getAllGroups(db).map((g) => g.id);
      const allMessages = [];

      for (const gid of groupIds) {
        const msgs = getMessagesByGroup(db, gid, from, to);
        const anchors = msgs.filter(
          (m) => m.content && matchesKeyword(m.content, keyword, "fuzzy")
        );
        if (anchors.length === 0) continue;

        const context = buildContextMessages(db, anchors.map((a) => a.id), gid, config.analysis);
        allMessages.push(...context);
      }

      if (allMessages.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No discussions found about "${keyword}" in the specified time range.` }],
        };
      }

      const result = await analyzeTopicFromMessages(
        allMessages, keyword, aiProvider, config.ai.max_context_messages
      );

      const report = buildReportFromAnalysis(result, {
        keyword,
        groupId: group,
        timeFrom: from,
        timeTo: to,
      });

      insertReport(db, report);

      return {
        content: [{ type: "text" as const, text: report.full_report }],
      };
    },
  );
}
