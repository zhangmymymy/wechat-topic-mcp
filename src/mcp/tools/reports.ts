// src/mcp/tools/reports.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { getReportById, getReportsByKeyword } from "../../shared/db/queries.js";

export function registerReportTools(server: McpServer, db: Database.Database): void {
  server.tool(
    "get_report",
    "Retrieve a specific analysis report by its ID.",
    { report_id: z.string().describe("Report ID") },
    async ({ report_id }) => {
      const report = getReportById(db, report_id);
      if (!report) {
        return { content: [{ type: "text" as const, text: `Report ${report_id} not found.` }] };
      }
      return { content: [{ type: "text" as const, text: report.full_report }] };
    },
  );

  server.tool(
    "list_reports",
    "Browse historical analysis reports with optional filters.",
    {
      keyword: z.string().optional().describe("Filter by keyword"),
      group: z.string().optional().describe("Filter by group ID"),
      time_from: z.string().optional().describe("Start time (ISO 8601)"),
      time_to: z.string().optional().describe("End time (ISO 8601)"),
    },
    async ({ keyword, group, time_from, time_to }) => {
      const reports = getReportsByKeyword(db, keyword, group, time_from, time_to);
      if (reports.length === 0) {
        return { content: [{ type: "text" as const, text: "No reports found." }] };
      }
      const list = reports.map((r) =>
        `• [${r.id}] "${r.keyword}" — ${r.time_from} ~ ${r.time_to} | ${r.trends.message_count} msgs`
      ).join("\n");
      return { content: [{ type: "text" as const, text: `Reports:\n${list}` }] };
    },
  );
}
