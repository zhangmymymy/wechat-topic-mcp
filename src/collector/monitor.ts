// src/collector/monitor.ts
import type Database from "better-sqlite3";
import type { Message, Subscription, AppConfig, AIProvider, Report } from "../shared/types.js";
import type { Notifier } from "../shared/types.js";
import { getEnabledSubscriptions, getMessagesByGroup, getAllGroups, insertReport, insertMessageTopicLinks, matchesKeyword } from "../shared/db/queries.js";
import { analyzeTopicFromMessages, buildContextMessages, buildReportFromAnalysis } from "../shared/analyzer/index.js";
import cron from "node-cron";

// Re-export matchesKeyword for convenience
export { matchesKeyword } from "../shared/db/queries.js";

// ── Monitor State ──

interface ThresholdState {
  anchorIds: string[];
  lastPush: number; // timestamp ms
}

export class KeywordMonitor {
  private db: Database.Database;
  private config: AppConfig;
  private aiProvider: AIProvider;
  private notifiers: Map<string, Notifier>;
  private thresholdState: Map<string, ThresholdState> = new Map();
  private cronJobs: cron.ScheduledTask[] = [];
  private lastCronRun: Map<string, string> = new Map(); // subscription_id → last run ISO

  constructor(
    db: Database.Database,
    config: AppConfig,
    aiProvider: AIProvider,
    notifiers: Map<string, Notifier>,
  ) {
    this.db = db;
    this.config = config;
    this.aiProvider = aiProvider;
    this.notifiers = notifiers;
  }

  // Called for every incoming message
  async onMessage(msg: Message): Promise<void> {
    const subs = getEnabledSubscriptions(this.db);

    for (const sub of subs) {
      // Check if this message's group is in scope
      if (sub.groups && !sub.groups.includes(msg.group_id)) continue;

      // Check keyword match
      if (!msg.content || !matchesKeyword(msg.content, sub.keyword, sub.match_mode)) continue;

      // This is an anchor message — track for threshold trigger
      if (sub.threshold) {
        this.trackThreshold(sub, msg);
      }
    }
  }

  // Start cron jobs for all subscriptions
  startCronJobs(): void {
    const subs = getEnabledSubscriptions(this.db);
    for (const sub of subs) {
      if (sub.schedule_cron && sub.auto_push) {
        const job = cron.schedule(sub.schedule_cron, () => {
          this.runScheduledAnalysis(sub).catch((err) =>
            console.error(`[Monitor] Scheduled analysis failed for ${sub.keyword}:`, err)
          );
        });
        this.cronJobs.push(job);
        console.log(`[Monitor] Cron job started for "${sub.keyword}": ${sub.schedule_cron}`);
      }
    }
  }

  /**
   * Check messages newer than the given timestamp against all enabled subscriptions.
   * Called after each sync to process newly imported messages.
   */
  async checkNewMessages(since: string): Promise<void> {
    const subs = getEnabledSubscriptions(this.db);
    if (subs.length === 0) return;

    const now = new Date().toISOString();
    const groups = getAllGroups(this.db);

    for (const group of groups) {
      const messages = getMessagesByGroup(this.db, group.id, since, now);
      if (messages.length === 0) continue;

      for (const msg of messages) {
        for (const sub of subs) {
          if (sub.groups && !sub.groups.includes(msg.group_id)) continue;
          if (!msg.content || !matchesKeyword(msg.content, sub.keyword, sub.match_mode)) continue;

          // Track threshold triggers
          if (sub.threshold) {
            this.trackThreshold(sub, msg);
          }
        }
      }
    }

    console.log(`[Monitor] Checked ${groups.length} groups for new messages since ${since}`);
  }

  stop(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];
  }

  private trackThreshold(sub: Subscription, anchor: Message): void {
    const state = this.thresholdState.get(sub.id) ?? { anchorIds: [], lastPush: 0 };

    // Check cooldown
    const cooldownMs = this.config.analysis.cooldown_minutes * 60 * 1000;
    if (Date.now() - state.lastPush < cooldownMs) return;

    // Clean old anchors outside the window
    const windowMs = (sub.threshold_window ?? 600) * 1000;
    const cutoff = Date.now() - windowMs;
    state.anchorIds = state.anchorIds.filter((id) => {
      const msg = this.db.prepare("SELECT timestamp FROM messages WHERE id = ?").get(id) as { timestamp: string } | undefined;
      return msg && new Date(msg.timestamp).getTime() > cutoff;
    });

    state.anchorIds.push(anchor.id);
    this.thresholdState.set(sub.id, state);

    // Check if threshold reached
    if (state.anchorIds.length >= (sub.threshold ?? Infinity)) {
      state.lastPush = Date.now();
      this.runThresholdAnalysis(sub, state.anchorIds, anchor.group_id).catch((err) =>
        console.error(`[Monitor] Threshold analysis failed for ${sub.keyword}:`, err)
      );
      state.anchorIds = [];
    }
  }

  private async runScheduledAnalysis(sub: Subscription): Promise<void> {
    const now = new Date().toISOString();
    const lastRun = this.lastCronRun.get(sub.id) ?? new Date(Date.now() - 3600000).toISOString();
    this.lastCronRun.set(sub.id, now);

    const groups = sub.groups ?? getAllGroups(this.db).map((g) => g.id);

    for (const groupId of groups) {
      const messages = getMessagesByGroup(this.db, groupId, lastRun, now);
      // Find anchors in this batch
      const anchors = messages.filter(
        (m) => m.content && matchesKeyword(m.content, sub.keyword, sub.match_mode)
      );
      if (anchors.length === 0) continue;

      const contextMessages = buildContextMessages(
        this.db, anchors.map((a) => a.id), groupId, this.config.analysis
      );

      const result = await analyzeTopicFromMessages(
        contextMessages, sub.keyword, this.aiProvider, this.config.ai.max_context_messages
      );

      if (result.related_message_ids.length === 0) continue;

      const report = buildReportFromAnalysis(result, {
        keyword: sub.keyword,
        groupId,
        timeFrom: lastRun,
        timeTo: now,
        subscriptionId: sub.id,
      });

      insertReport(this.db, report);

      // Persist message-topic links
      const links = result.related_message_ids.map((mid) => ({
        message_id: mid, subscription_id: sub.id,
        anchor_id: anchors[0].id, relevance: 1.0, method: "semantic" as const,
      }));
      insertMessageTopicLinks(this.db, links);

      await this.pushReport(sub, report, groupId);
    }
  }

  private async runThresholdAnalysis(sub: Subscription, anchorIds: string[], groupId: string): Promise<void> {
    const contextMessages = buildContextMessages(this.db, anchorIds, groupId, this.config.analysis);

    const result = await analyzeTopicFromMessages(
      contextMessages, sub.keyword, this.aiProvider, this.config.ai.max_context_messages
    );

    if (result.related_message_ids.length === 0) return;

    const now = new Date().toISOString();
    const earliest = contextMessages[0]?.timestamp ?? now;

    const report = buildReportFromAnalysis(result, {
      keyword: sub.keyword,
      groupId,
      timeFrom: earliest,
      timeTo: now,
      subscriptionId: sub.id,
    });

    insertReport(this.db, report);

    // Persist message-topic links
    const links = result.related_message_ids.map((mid) => ({
      message_id: mid, subscription_id: sub.id,
      anchor_id: anchorIds[0], relevance: 1.0, method: "semantic" as const,
    }));
    insertMessageTopicLinks(this.db, links);

    await this.pushReport(sub, report, groupId);
  }

  private async pushReport(sub: Subscription, report: Report, groupId: string): Promise<void> {
    const group = this.db.prepare("SELECT name FROM groups WHERE id = ?").get(groupId) as { name: string } | undefined;
    const groupName = group?.name ?? groupId;

    for (const channel of sub.notify_channels) {
      const notifier = this.notifiers.get(channel);
      if (!notifier) continue;

      try {
        await notifier.send(report, groupName);
      } catch (err) {
        console.error(`[Monitor] Failed to push to ${channel}:`, err);
      }
    }
  }
}
