import type Database from "better-sqlite3";
import type { Message, Subscription, Report, MessageTopicLink, Group } from "../types.js";

// ── Row types (as stored in SQLite) ──

interface MessageRow {
  rowid: number;
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string;
  content: string | null;
  media_url: string | null;
  msg_type: string;
  is_transcribed: number;
  transcription_retries: number;
  timestamp: string;
}

interface SubscriptionRow {
  id: string;
  keyword: string;
  match_mode: string;
  groups: string | null;
  notify_channels: string;
  auto_push: number;
  schedule_cron: string | null;
  threshold: number | null;
  threshold_window: number | null;
  enabled: number;
  created_at: string;
}

interface ReportRow {
  id: string;
  subscription_id: string | null;
  keyword: string;
  group_id: string | null;
  time_from: string;
  time_to: string;
  summary: string;
  sentiment: string;
  key_opinions: string;
  disputes: string;
  action_items: string;
  trends: string;
  full_report: string;
  created_at: string;
}

// ── Helpers ──

function rowToMessage(row: MessageRow): Message {
  return {
    rowid: row.rowid,
    id: row.id,
    group_id: row.group_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    content: row.content,
    media_url: row.media_url,
    msg_type: row.msg_type as Message["msg_type"],
    is_transcribed: row.is_transcribed === 1,
    timestamp: row.timestamp,
  };
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    keyword: row.keyword,
    match_mode: row.match_mode as Subscription["match_mode"],
    groups: row.groups ? (JSON.parse(row.groups) as string[]) : null,
    notify_channels: JSON.parse(row.notify_channels) as Subscription["notify_channels"],
    auto_push: row.auto_push === 1,
    schedule_cron: row.schedule_cron,
    threshold: row.threshold,
    threshold_window: row.threshold_window,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    keyword: row.keyword,
    group_id: row.group_id,
    time_from: row.time_from,
    time_to: row.time_to,
    summary: row.summary,
    sentiment: JSON.parse(row.sentiment),
    key_opinions: JSON.parse(row.key_opinions),
    disputes: JSON.parse(row.disputes),
    action_items: JSON.parse(row.action_items),
    trends: JSON.parse(row.trends),
    full_report: row.full_report,
    created_at: row.created_at,
  };
}

// ── Message functions ──

export function insertMessage(db: Database.Database, msg: Omit<Message, "rowid">): void {
  db.prepare(`
    INSERT OR IGNORE INTO messages
      (id, group_id, sender_id, sender_name, content, media_url, msg_type, is_transcribed, timestamp)
    VALUES
      (@id, @group_id, @sender_id, @sender_name, @content, @media_url, @msg_type, @is_transcribed, @timestamp)
  `).run({
    ...msg,
    is_transcribed: msg.is_transcribed ? 1 : 0,
  });
}

export function getMessagesByGroup(
  db: Database.Database,
  groupId: string,
  from: string,
  to: string
): Message[] {
  const rows = db.prepare(`
    SELECT rowid, * FROM messages
    WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(groupId, from, to) as MessageRow[];
  return rows.map(rowToMessage);
}

export function searchMessages(
  db: Database.Database,
  query: string,
  groupId?: string,
  limit = 50
): Message[] {
  let sql: string;
  let params: unknown[];

  if (groupId) {
    sql = `
      SELECT m.rowid, m.*
      FROM messages m
      JOIN messages_fts fts ON fts.rowid = m.rowid
      WHERE messages_fts MATCH ?
        AND m.group_id = ?
      ORDER BY m.timestamp DESC
      LIMIT ?
    `;
    params = [query, groupId, limit];
  } else {
    sql = `
      SELECT m.rowid, m.*
      FROM messages m
      JOIN messages_fts fts ON fts.rowid = m.rowid
      WHERE messages_fts MATCH ?
      ORDER BY m.timestamp DESC
      LIMIT ?
    `;
    params = [query, limit];
  }

  const rows = db.prepare(sql).all(...params) as MessageRow[];
  return rows.map(rowToMessage);
}

export function getContextWindow(
  db: Database.Database,
  messageId: string,
  groupId: string,
  before: number,
  after: number
): Message[] {
  const anchor = db.prepare(`
    SELECT rowid, timestamp FROM messages WHERE id = ?
  `).get(messageId) as { rowid: number; timestamp: string } | undefined;

  if (!anchor) return [];

  const rows = db.prepare(`
    SELECT rowid, * FROM messages
    WHERE group_id = ?
      AND (
        (timestamp < ? OR (timestamp = ? AND rowid < ?))
        OR rowid = ?
        OR (timestamp > ? OR (timestamp = ? AND rowid > ?))
      )
    ORDER BY timestamp ASC, rowid ASC
    LIMIT ?
  `).all(
    groupId,
    anchor.timestamp, anchor.timestamp, anchor.rowid,
    anchor.rowid,
    anchor.timestamp, anchor.timestamp, anchor.rowid,
    before + 1 + after
  ) as MessageRow[];

  // More precise: get before and after separately then merge
  const beforeRows = db.prepare(`
    SELECT rowid, * FROM messages
    WHERE group_id = ?
      AND (timestamp < ? OR (timestamp = ? AND rowid < ?))
    ORDER BY timestamp DESC, rowid DESC
    LIMIT ?
  `).all(groupId, anchor.timestamp, anchor.timestamp, anchor.rowid, before) as MessageRow[];

  const anchorRow = db.prepare(`
    SELECT rowid, * FROM messages WHERE id = ?
  `).get(messageId) as MessageRow | undefined;

  const afterRows = db.prepare(`
    SELECT rowid, * FROM messages
    WHERE group_id = ?
      AND (timestamp > ? OR (timestamp = ? AND rowid > ?))
    ORDER BY timestamp ASC, rowid ASC
    LIMIT ?
  `).all(groupId, anchor.timestamp, anchor.timestamp, anchor.rowid, after) as MessageRow[];

  const combined = [
    ...beforeRows.reverse(),
    ...(anchorRow ? [anchorRow] : []),
    ...afterRows,
  ];

  return combined.map(rowToMessage);
}

export function getUntranscribedVoiceMessages(
  db: Database.Database,
  maxRetries = 3
): Message[] {
  const rows = db.prepare(`
    SELECT rowid, * FROM messages
    WHERE msg_type = 'voice'
      AND is_transcribed = 0
      AND transcription_retries < ?
    ORDER BY timestamp ASC
  `).all(maxRetries) as MessageRow[];
  return rows.map(rowToMessage);
}

export function incrementTranscriptionRetries(db: Database.Database, messageId: string): void {
  db.prepare(`
    UPDATE messages SET transcription_retries = transcription_retries + 1 WHERE id = ?
  `).run(messageId);
}

export function updateMessageContent(
  db: Database.Database,
  messageId: string,
  content: string,
  isTranscribed = false
): void {
  db.prepare(`
    UPDATE messages SET content = ?, is_transcribed = ? WHERE id = ?
  `).run(content, isTranscribed ? 1 : 0, messageId);
}

// ── Group functions ──

export function upsertGroup(db: Database.Database, group: Omit<Group, "created_at" | "updated_at">): void {
  db.prepare(`
    INSERT INTO groups (id, name, member_count, updated_at)
    VALUES (@id, @name, @member_count, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      member_count = excluded.member_count,
      updated_at = datetime('now')
  `).run(group);
}

export function getAllGroups(db: Database.Database): Group[] {
  return db.prepare(`
    SELECT * FROM groups ORDER BY name ASC
  `).all() as Group[];
}

export function getGroupActivity(
  db: Database.Database,
  groupId: string,
  from: string,
  to: string
): { message_count: number; active_users: number } {
  const result = db.prepare(`
    SELECT
      COUNT(*) AS message_count,
      COUNT(DISTINCT sender_id) AS active_users
    FROM messages
    WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
  `).get(groupId, from, to) as { message_count: number; active_users: number };
  return result;
}

// ── Subscription functions ──

export function insertSubscription(db: Database.Database, sub: Subscription): void {
  db.prepare(`
    INSERT OR REPLACE INTO subscriptions
      (id, keyword, match_mode, groups, notify_channels, auto_push, schedule_cron,
       threshold, threshold_window, enabled, created_at)
    VALUES
      (@id, @keyword, @match_mode, @groups, @notify_channels, @auto_push, @schedule_cron,
       @threshold, @threshold_window, @enabled, @created_at)
  `).run({
    ...sub,
    groups: sub.groups ? JSON.stringify(sub.groups) : null,
    notify_channels: JSON.stringify(sub.notify_channels),
    auto_push: sub.auto_push ? 1 : 0,
    enabled: sub.enabled ? 1 : 0,
  });
}

export function getEnabledSubscriptions(db: Database.Database): Subscription[] {
  const rows = db.prepare(`
    SELECT * FROM subscriptions WHERE enabled = 1 ORDER BY created_at ASC
  `).all() as SubscriptionRow[];
  return rows.map(rowToSubscription);
}

export function getSubscriptionById(db: Database.Database, id: string): Subscription | null {
  const row = db.prepare(`
    SELECT * FROM subscriptions WHERE id = ?
  `).get(id) as SubscriptionRow | undefined;
  return row ? rowToSubscription(row) : null;
}

export function updateSubscription(
  db: Database.Database,
  id: string,
  updates: Partial<Omit<Subscription, "id" | "created_at">>
): void {
  const current = getSubscriptionById(db, id);
  if (!current) return;

  const merged = { ...current, ...updates };
  insertSubscription(db, merged);
}

export function deleteSubscription(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
}

// ── Report functions ──

export function insertReport(db: Database.Database, report: Report): void {
  db.prepare(`
    INSERT OR REPLACE INTO reports
      (id, subscription_id, keyword, group_id, time_from, time_to,
       summary, sentiment, key_opinions, disputes, action_items, trends, full_report, created_at)
    VALUES
      (@id, @subscription_id, @keyword, @group_id, @time_from, @time_to,
       @summary, @sentiment, @key_opinions, @disputes, @action_items, @trends, @full_report, @created_at)
  `).run({
    ...report,
    sentiment: JSON.stringify(report.sentiment),
    key_opinions: JSON.stringify(report.key_opinions),
    disputes: JSON.stringify(report.disputes),
    action_items: JSON.stringify(report.action_items),
    trends: JSON.stringify(report.trends),
  });
}

export function getReportById(db: Database.Database, id: string): Report | null {
  const row = db.prepare(`
    SELECT * FROM reports WHERE id = ?
  `).get(id) as ReportRow | undefined;
  return row ? rowToReport(row) : null;
}

export function getReportsByKeyword(
  db: Database.Database,
  keyword: string,
  limit = 20
): Report[] {
  const rows = db.prepare(`
    SELECT * FROM reports WHERE keyword = ? ORDER BY created_at DESC LIMIT ?
  `).all(keyword, limit) as ReportRow[];
  return rows.map(rowToReport);
}

// ── Message-topic link functions ──

export function insertMessageTopicLinks(
  db: Database.Database,
  links: MessageTopicLink[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO message_topic_links
      (message_id, subscription_id, anchor_id, relevance, method)
    VALUES
      (@message_id, @subscription_id, @anchor_id, @relevance, @method)
  `);
  const insertMany = db.transaction((items: MessageTopicLink[]) => {
    for (const link of items) {
      stmt.run(link);
    }
  });
  insertMany(links);
}

// ── Keyword matching ──

export function matchesKeyword(
  content: string,
  keyword: string,
  mode: "exact" | "fuzzy" | "regex"
): boolean {
  if (!content) return false;

  switch (mode) {
    case "exact":
      return content === keyword;
    case "fuzzy": {
      const lowerContent = content.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      // Split keyword into words and check if all appear in the content
      const words = lowerKeyword.split(/\s+/).filter(Boolean);
      return words.every((word) => lowerContent.includes(word));
    }
    case "regex": {
      try {
        const re = new RegExp(keyword, "i");
        return re.test(content);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ── Cleanup functions ──

export function cleanupOldMessages(db: Database.Database, olderThanDays: number): number {
  const result = db.prepare(`
    DELETE FROM messages
    WHERE timestamp < datetime('now', ? || ' days')
  `).run(`-${olderThanDays}`);
  return result.changes;
}

export function cleanupOldReports(db: Database.Database, olderThanDays: number): number {
  const result = db.prepare(`
    DELETE FROM reports
    WHERE created_at < datetime('now', ? || ' days')
  `).run(`-${olderThanDays}`);
  return result.changes;
}
