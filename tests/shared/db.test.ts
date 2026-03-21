import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../../src/shared/db/index.js";
import { initSchema } from "../../src/shared/db/schema.js";
import {
  insertMessage,
  getMessagesByGroup,
  searchMessages,
  getContextWindow,
  upsertGroup,
  insertSubscription,
  getEnabledSubscriptions,
  insertReport,
  getReportById,
  getReportsByKeyword,
  getGroupActivity,
} from "../../src/shared/db/queries.js";
import type { Message, Subscription } from "../../src/shared/types.js";
import { unlinkSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";

describe("Database", () => {
  const dbPath = join(import.meta.dirname, "../../tmp-test/test.db");
  let db: Database.Database;

  beforeEach(() => {
    db = createDatabase(dbPath);
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it("creates all tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("groups");
    expect(names).toContain("messages");
    expect(names).toContain("subscriptions");
    expect(names).toContain("message_topic_links");
    expect(names).toContain("reports");
  });

  it("creates FTS5 virtual table", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("enables WAL mode", () => {
    const result = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
  });

  it("FTS trigger syncs on insert", () => {
    db.prepare(
      `INSERT INTO messages (id, group_id, sender_id, sender_name, content, msg_type, timestamp)
       VALUES ('msg1', 'g1', 's1', 'Alice', 'hello world test', 'text', '2026-03-21T10:00:00Z')`
    ).run();

    const results = db
      .prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'hello'")
      .all();
    expect(results).toHaveLength(1);
  });
});

describe("Query functions", () => {
  const dbPath = join(import.meta.dirname, "../../tmp-test/test-queries.db");
  let db: Database.Database;

  beforeEach(() => {
    db = createDatabase(dbPath);
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(dbPath); } catch {}
  });

  it("inserts and retrieves messages by group", () => {
    insertMessage(db, {
      id: "m1", group_id: "g1", sender_id: "s1", sender_name: "Alice",
      content: "hello", media_url: null, msg_type: "text",
      is_transcribed: false, timestamp: "2026-03-21T10:00:00Z",
    });
    const msgs = getMessagesByGroup(db, "g1", "2026-03-21T00:00:00Z", "2026-03-22T00:00:00Z");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].sender_name).toBe("Alice");
  });

  it("searches messages via FTS5", () => {
    insertMessage(db, {
      id: "m1", group_id: "g1", sender_id: "s1", sender_name: "Alice",
      content: "discussing AI agents today", media_url: null, msg_type: "text",
      is_transcribed: false, timestamp: "2026-03-21T10:00:00Z",
    });
    insertMessage(db, {
      id: "m2", group_id: "g1", sender_id: "s2", sender_name: "Bob",
      content: "the weather is nice", media_url: null, msg_type: "text",
      is_transcribed: false, timestamp: "2026-03-21T10:01:00Z",
    });
    const results = searchMessages(db, "AI agents");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("m1");
  });

  it("gets context window around a message", () => {
    for (let i = 0; i < 20; i++) {
      insertMessage(db, {
        id: `m${i}`, group_id: "g1", sender_id: "s1", sender_name: "Alice",
        content: `message ${i}`, media_url: null, msg_type: "text",
        is_transcribed: false,
        timestamp: `2026-03-21T10:${String(i).padStart(2, "0")}:00Z`,
      });
    }
    const window = getContextWindow(db, "m10", "g1", 5, 10);
    expect(window.length).toBeGreaterThanOrEqual(15);
    expect(window[0].id).toBe("m5");
  });

  it("inserts and retrieves subscriptions", () => {
    insertSubscription(db, {
      id: "sub1", keyword: "AI Agent", match_mode: "fuzzy",
      groups: null, notify_channels: ["telegram"],
      auto_push: true, schedule_cron: "0 * * * *",
      threshold: null, threshold_window: null,
      enabled: true, created_at: "2026-03-21T00:00:00Z",
    });
    const subs = getEnabledSubscriptions(db);
    expect(subs).toHaveLength(1);
    expect(subs[0].keyword).toBe("AI Agent");
  });

  it("gets group activity stats", () => {
    for (let i = 0; i < 5; i++) {
      insertMessage(db, {
        id: `m${i}`, group_id: "g1",
        sender_id: i < 3 ? "s1" : "s2",
        sender_name: i < 3 ? "Alice" : "Bob",
        content: `msg ${i}`, media_url: null, msg_type: "text",
        is_transcribed: false,
        timestamp: `2026-03-21T10:0${i}:00Z`,
      });
    }
    const activity = getGroupActivity(db, "g1", "2026-03-21T00:00:00Z", "2026-03-22T00:00:00Z");
    expect(activity.message_count).toBe(5);
    expect(activity.active_users).toBe(2);
  });
});
