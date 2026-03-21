// src/mcp/tools/subscriptions.ts
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import {
  getEnabledSubscriptions,
  insertSubscription,
  updateSubscription,
  deleteSubscription,
  getSubscriptionById,
} from "../../shared/db/queries.js";

export function registerSubscriptionTools(server: McpServer, db: Database.Database): void {
  // List subscriptions
  server.tool(
    "list_subscriptions",
    "List all keyword subscriptions for auto-push monitoring.",
    {},
    async () => {
      const subs = getEnabledSubscriptions(db);
      if (subs.length === 0) {
        return { content: [{ type: "text" as const, text: "No active subscriptions." }] };
      }
      const text = subs.map((s) =>
        `• **${s.keyword}** (${s.match_mode}) — ${s.notify_channels.join(", ")} | cron: ${s.schedule_cron ?? "none"} | threshold: ${s.threshold ?? "none"}`
      ).join("\n");
      return { content: [{ type: "text" as const, text: `Active subscriptions:\n${text}` }] };
    },
  );

  // Add subscription
  server.tool(
    "add_subscription",
    "Add a keyword subscription for automatic monitoring and push notifications.",
    {
      keyword: z.string().describe("Keyword or regex to monitor"),
      match_mode: z.enum(["exact", "fuzzy", "regex"]).optional().default("fuzzy"),
      groups: z.array(z.string()).optional().describe("Group IDs to monitor (omit for all)"),
      notify_channels: z.array(z.enum(["telegram", "slack"])).describe("Channels to push reports to"),
      schedule_cron: z.string().optional().describe("Cron expression for scheduled analysis"),
      threshold: z.number().optional().describe("Message count to trigger analysis"),
      threshold_window: z.number().optional().describe("Time window in seconds for threshold counting"),
    },
    async ({ keyword, match_mode, groups, notify_channels, schedule_cron, threshold, threshold_window }) => {
      const id = uuidv4();
      insertSubscription(db, {
        id,
        keyword,
        match_mode: match_mode ?? "fuzzy",
        groups: groups ?? null,
        notify_channels,
        auto_push: true,
        schedule_cron: schedule_cron ?? null,
        threshold: threshold ?? null,
        threshold_window: threshold_window ?? null,
        enabled: true,
        created_at: new Date().toISOString(),
      });
      return {
        content: [{ type: "text" as const, text: `Subscription created (${id}): monitoring "${keyword}" → ${notify_channels.join(", ")}` }],
      };
    },
  );

  // Update subscription
  server.tool(
    "update_subscription",
    "Update an existing keyword subscription.",
    {
      id: z.string().describe("Subscription ID"),
      keyword: z.string().optional(),
      match_mode: z.enum(["exact", "fuzzy", "regex"]).optional(),
      enabled: z.boolean().optional(),
      schedule_cron: z.string().optional(),
      threshold: z.number().optional(),
    },
    async ({ id, ...updates }) => {
      const existing = getSubscriptionById(db, id);
      if (!existing) {
        return { content: [{ type: "text" as const, text: `Subscription ${id} not found.` }] };
      }
      updateSubscription(db, id, updates);
      return { content: [{ type: "text" as const, text: `Subscription ${id} updated.` }] };
    },
  );

  // Remove subscription
  server.tool(
    "remove_subscription",
    "Remove a keyword subscription.",
    { id: z.string().describe("Subscription ID") },
    async ({ id }) => {
      deleteSubscription(db, id);
      return { content: [{ type: "text" as const, text: `Subscription ${id} removed.` }] };
    },
  );
}
