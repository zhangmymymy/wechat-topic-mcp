import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id            TEXT PRIMARY KEY,
      name          TEXT,
      member_count  INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT (datetime('now')),
      updated_at    DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      rowid         INTEGER PRIMARY KEY AUTOINCREMENT,
      id            TEXT UNIQUE NOT NULL,
      group_id      TEXT,
      sender_id     TEXT,
      sender_name   TEXT,
      content       TEXT,
      media_url     TEXT,
      msg_type      TEXT NOT NULL DEFAULT 'text',
      is_transcribed INTEGER DEFAULT 0,
      transcription_retries INTEGER DEFAULT 0,
      timestamp     DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_group_time
      ON messages (group_id, timestamp);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id              TEXT PRIMARY KEY,
      keyword         TEXT NOT NULL,
      match_mode      TEXT NOT NULL DEFAULT 'fuzzy',
      groups          TEXT,
      notify_channels TEXT NOT NULL DEFAULT '[]',
      auto_push       INTEGER DEFAULT 1,
      schedule_cron   TEXT,
      threshold       INTEGER,
      threshold_window INTEGER,
      enabled         INTEGER DEFAULT 1,
      created_at      DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS message_topic_links (
      message_id      TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      anchor_id       TEXT NOT NULL,
      relevance       REAL DEFAULT 1.0,
      method          TEXT NOT NULL DEFAULT 'direct',
      PRIMARY KEY (message_id, subscription_id, anchor_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id              TEXT PRIMARY KEY,
      subscription_id TEXT,
      keyword         TEXT NOT NULL,
      group_id        TEXT,
      time_from       DATETIME,
      time_to         DATETIME,
      summary         TEXT,
      sentiment       TEXT,
      key_opinions    TEXT,
      disputes        TEXT,
      action_items    TEXT,
      trends          TEXT,
      full_report     TEXT,
      created_at      DATETIME DEFAULT (datetime('now'))
    );
  `);

  const ftsExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
    .get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=rowid
      );

      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
          VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
          VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
  }
}
