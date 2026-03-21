# WeChat Topic MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP Server + Collector Service that monitors WeChat group messages, performs AI-powered topic analysis, and pushes reports to Telegram/Slack.

**Architecture:** Dual-process design — a Collector Service (GeweChat → SQLite → AI Analysis → TG/Slack) and an MCP Server (MCP Protocol → SQLite → On-demand Analysis). Both share a SQLite database with WAL mode.

**Tech Stack:** TypeScript, Node.js 20+, @modelcontextprotocol/sdk, better-sqlite3, OpenAI SDK, grammy (Telegram), @slack/web-api (Slack), tsup, Docker

**Spec:** `docs/superpowers/specs/2026-03-21-wechat-topic-mcp-design.md`

---

## File Map

### New Files

| File | Responsibility |
|---|---|
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |
| `tsup.config.ts` | Build config for dual entry points |
| `.env.example` | Environment variable template |
| `config.yaml` | Default configuration |
| `src/shared/types.ts` | All shared TypeScript types and interfaces |
| `src/shared/config.ts` | Config loading (yaml + env var interpolation) |
| `src/shared/db/index.ts` | DB connection factory (SQLite with WAL mode) |
| `src/shared/db/schema.ts` | Table creation, FTS5, triggers, migrations |
| `src/shared/db/queries.ts` | Shared query functions (messages, groups, subscriptions, reports) |
| `src/shared/ai/index.ts` | AI provider factory |
| `src/shared/ai/openai.ts` | OpenAI provider implementation |
| `src/shared/ai/prompts.ts` | Analysis prompt templates |
| `src/shared/stt/index.ts` | STT provider factory |
| `src/shared/stt/openai-whisper.ts` | Whisper transcription |
| `src/shared/analyzer/index.ts` | Core analysis function |
| `src/shared/analyzer/segmenter.ts` | Message volume segmentation |
| `src/collector/index.ts` | Collector entry point |
| `src/collector/gewechat.ts` | GeweChat adapter (webhook receiver, message normalization) |
| `src/collector/monitor.ts` | Keyword monitor (cron + threshold triggers) |
| `src/collector/notifier/index.ts` | Notifier factory |
| `src/collector/notifier/telegram.ts` | Telegram push |
| `src/collector/notifier/slack.ts` | Slack push |
| `src/collector/notifier/formatter.ts` | Report formatting (shared between TG/Slack) |
| `src/mcp/index.ts` | MCP Server entry point |
| `src/mcp/tools/query-topic.ts` | query_topic tool |
| `src/mcp/tools/subscriptions.ts` | Subscription CRUD tools |
| `src/mcp/tools/reports.ts` | Report retrieval tools |
| `src/mcp/tools/groups.ts` | Group listing and activity tools |
| `Dockerfile` | Multi-stage build |
| `docker-compose.yml` | Full stack deployment |
| `tests/shared/db.test.ts` | Database layer tests |
| `tests/shared/ai.test.ts` | AI provider tests |
| `tests/shared/analyzer.test.ts` | Analyzer tests |
| `tests/shared/config.test.ts` | Config loading tests |
| `tests/collector/monitor.test.ts` | Keyword monitor tests |
| `tests/collector/gewechat.test.ts` | GeweChat adapter tests |
| `tests/collector/notifier.test.ts` | Notifier tests |

---

## Chunk 1: Project Scaffolding, Types, and Config

### Task 1: Initialize project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `.env.example`

- [ ] **Step 1: Initialize npm project**

Run: `npm init -y`

- [ ] **Step 2: Install production dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk better-sqlite3 openai grammy @slack/web-api node-cron yaml dotenv uuid zod
```

- [ ] **Step 3: Install dev dependencies**

Run:
```bash
npm install -D typescript tsup tsx @types/node @types/better-sqlite3 @types/uuid vitest
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create tsup.config.ts**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "collector/index": "src/collector/index.ts",
    "mcp/index": "src/mcp/index.ts",
  },
  format: ["esm"],
  target: "node20",
  splitting: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
```

- [ ] **Step 6: Update package.json scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsup",
    "dev:collector": "tsx src/collector/index.ts",
    "dev:mcp": "tsx src/mcp/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 7: Create .env.example**

```
OPENAI_API_KEY=sk-your-key-here
TG_BOT_TOKEN=your-telegram-bot-token
TG_CHAT_ID=your-telegram-chat-id
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_CHANNEL=your-slack-channel-id
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts .env.example package-lock.json
git commit -m "feat: initialize project with dependencies and build config"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write type definitions**

```typescript
// src/shared/types.ts

// ── Database Models ──

export interface Group {
  id: string;
  name: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  rowid?: number;
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string;
  content: string | null;
  media_url: string | null;
  msg_type: "text" | "voice" | "image" | "link" | "file";
  is_transcribed: boolean;
  timestamp: string;
}

export interface Subscription {
  id: string;
  keyword: string;
  match_mode: "exact" | "fuzzy" | "regex";
  groups: string[] | null; // null = all groups
  notify_channels: ("telegram" | "slack")[];
  auto_push: boolean;
  schedule_cron: string | null;
  threshold: number | null;
  threshold_window: number | null; // seconds
  enabled: boolean;
  created_at: string;
}

export interface MessageTopicLink {
  message_id: string;
  subscription_id: string;
  anchor_id: string;
  relevance: number;
  method: "direct" | "context" | "semantic";
}

export interface Report {
  id: string;
  subscription_id: string | null;
  keyword: string;
  group_id: string | null;
  time_from: string;
  time_to: string;
  summary: string;
  sentiment: SentimentResult;
  key_opinions: KeyOpinion[];
  disputes: Dispute[];
  action_items: ActionItem[];
  trends: TrendMetrics;
  full_report: string;
  created_at: string;
}

// ── Analysis Types ──

export interface SentimentResult {
  positive: number;
  neutral: number;
  negative: number;
}

export interface KeyOpinion {
  sender: string;
  opinion: string;
  stance: "positive" | "neutral" | "negative";
}

export interface Dispute {
  topic: string;
  sides: { who: string; position: string }[];
}

export interface ActionItem {
  item: string;
  assignee: string | null;
  deadline: string | null;
}

export interface TrendMetrics {
  message_count: number;
  participant_count: number;
  density_per_hour: number;
  duration_minutes: number;
}

export interface AnalysisResult {
  related_message_ids: string[];
  report: {
    summary: string;
    sentiment: SentimentResult;
    key_opinions: KeyOpinion[];
    disputes: Dispute[];
    action_items: ActionItem[];
    trends: TrendMetrics;
  };
}

// ── Config Types ──

export interface AppConfig {
  gewechat: {
    base_url: string;
    callback_url: string;
  };
  database: {
    type: "sqlite" | "postgres";
    path: string;
    url?: string;
  };
  ai: {
    provider: "openai" | "claude" | "ollama";
    api_key: string;
    base_url?: string; // Required for claude/ollama, optional for openai
    model: string;
    max_context_messages: number;
  };
  stt: {
    provider: "openai" | "azure" | "local";
    api_key: string;
    model: string;
  };
  notify: {
    telegram: {
      bot_token: string;
      chat_id: string;
    };
    slack: {
      bot_token: string;
      channel: string;
    };
  };
  analysis: {
    context_before: number;
    context_after: number;
    cooldown_minutes: number;
  };
  retention: {
    messages_days: number;
    reports_days: number;
    cleanup_cron: string;
  };
  mcp: {
    port: number;
  };
  collector: {
    port: number;
  };
}

// ── AI Provider Interface ──

export interface AIProvider {
  analyze(messages: Message[], keyword: string): Promise<AnalysisResult>;
  mergeReports(reports: AnalysisResult[], keyword: string): Promise<AnalysisResult>;
}

// ── STT Provider Interface ──

export interface STTProvider {
  transcribe(audioUrl: string): Promise<string>;
}

// ── Notifier Interface ──

export interface Notifier {
  send(report: Report, groupName: string): Promise<void>;
}

// ── GeweChat Callback Types ──

export interface GeWeChatMessage {
  msg_id: string;
  from_user: string;
  from_user_name: string;
  to_user: string;
  msg_type: number;
  content: string;
  create_time: number;
  room_id: string;
  room_name: string;
  // Voice messages
  voice_url?: string;
  voice_duration?: number;
  // Image messages
  image_url?: string;
  // Link messages
  link_url?: string;
  link_title?: string;
}

// ── Time Range ──

export interface TimeRange {
  from: string; // ISO 8601
  to: string;   // ISO 8601
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared TypeScript type definitions"
```

---

### Task 3: Config loading

**Files:**
- Create: `config.yaml`
- Create: `src/shared/config.ts`
- Create: `tests/shared/config.test.ts`

- [ ] **Step 1: Create default config.yaml**

```yaml
gewechat:
  base_url: "http://localhost:2531"
  callback_url: "http://localhost:3001/webhook"

database:
  type: "sqlite"
  path: "./data/wechat.db"

ai:
  provider: "openai"
  api_key: "${OPENAI_API_KEY}"
  # base_url: "https://api.example.com/v1"  # Required for claude/ollama providers
  model: "gpt-4o"
  max_context_messages: 200

stt:
  provider: "openai"
  api_key: "${OPENAI_API_KEY}"
  model: "whisper-1"

notify:
  telegram:
    bot_token: "${TG_BOT_TOKEN}"
    chat_id: "${TG_CHAT_ID}"
  slack:
    bot_token: "${SLACK_BOT_TOKEN}"
    channel: "${SLACK_CHANNEL}"

analysis:
  context_before: 5
  context_after: 10
  cooldown_minutes: 30

retention:
  messages_days: 90
  reports_days: 365
  cleanup_cron: "0 3 * * *"

mcp:
  port: 3000

collector:
  port: 3001
```

- [ ] **Step 2: Write the failing test for config loading**

```typescript
// tests/shared/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/shared/config.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

describe("loadConfig", () => {
  const testDir = join(import.meta.dirname, "../../tmp-test");
  const configPath = join(testDir, "config.yaml");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch {}
  });

  it("loads yaml config and interpolates env vars", () => {
    process.env.TEST_API_KEY = "sk-test-123";
    writeFileSync(
      configPath,
      `ai:\n  provider: "openai"\n  api_key: "\${TEST_API_KEY}"\n  model: "gpt-4o"\n  max_context_messages: 200\n`
    );

    const config = loadConfig(configPath);
    expect(config.ai.api_key).toBe("sk-test-123");
    expect(config.ai.provider).toBe("openai");
    delete process.env.TEST_API_KEY;
  });

  it("throws if config file does not exist", () => {
    expect(() => loadConfig("/nonexistent/config.yaml")).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shared/config.test.ts`
Expected: FAIL — module `../../src/shared/config.js` not found

- [ ] **Step 4: Write config loader**

```typescript
// src/shared/config.ts
import { readFileSync } from "fs";
import { parse } from "yaml";
import type { AppConfig } from "./types.js";

function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw);
  return interpolateEnvVars(parsed) as AppConfig;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add config.yaml src/shared/config.ts tests/shared/config.test.ts
git commit -m "feat: add config loading with env var interpolation"
```

---

## Chunk 2: Database Layer

### Task 4: Database connection and schema

**Files:**
- Create: `src/shared/db/index.ts`
- Create: `src/shared/db/schema.ts`
- Create: `tests/shared/db.test.ts`

- [ ] **Step 1: Write the failing test for DB initialization and schema**

```typescript
// tests/shared/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../../src/shared/db/index.js";
import { initSchema } from "../../src/shared/db/schema.js";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/db.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write database connection factory**

```typescript
// src/shared/db/index.ts
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function createDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}
```

- [ ] **Step 4: Write schema initialization**

```typescript
// src/shared/db/schema.ts
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

  // FTS5 virtual table — separate because CREATE VIRTUAL TABLE IF NOT EXISTS
  // is supported in SQLite 3.37+
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shared/db.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/db/ tests/shared/db.test.ts
git commit -m "feat: add database layer with schema, FTS5, and WAL mode"
```

---

### Task 5: Database query functions

**Files:**
- Create: `src/shared/db/queries.ts`
- Modify: `tests/shared/db.test.ts`

- [ ] **Step 1: Write failing tests for query functions**

Append to `tests/shared/db.test.ts`:

```typescript
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
    // m10 as anchor, 5 before, 10 after
    const window = getContextWindow(db, "m10", "g1", 5, 10);
    // Should get m5..m10..m20 but m20 doesn't exist, so m5..m19
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/db.test.ts`
Expected: FAIL — imports not found

- [ ] **Step 3: Write query functions**

```typescript
// src/shared/db/queries.ts
import type Database from "better-sqlite3";
import type { Message, Subscription, Report } from "../types.js";

// ── Messages ──

export function insertMessage(db: Database.Database, msg: Omit<Message, "rowid">): void {
  db.prepare(`
    INSERT OR IGNORE INTO messages (id, group_id, sender_id, sender_name, content, media_url, msg_type, is_transcribed, timestamp)
    VALUES (@id, @group_id, @sender_id, @sender_name, @content, @media_url, @msg_type, @is_transcribed, @timestamp)
  `).run({
    ...msg,
    is_transcribed: msg.is_transcribed ? 1 : 0,
  });
}

export function getMessagesByGroup(
  db: Database.Database, groupId: string, from: string, to: string
): Message[] {
  return db.prepare(`
    SELECT * FROM messages WHERE group_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC
  `).all(groupId, from, to) as Message[];
}

export function searchMessages(db: Database.Database, query: string): Message[] {
  return db.prepare(`
    SELECT m.* FROM messages m
    JOIN messages_fts fts ON m.rowid = fts.rowid
    WHERE messages_fts MATCH ?
    ORDER BY m.timestamp DESC
  `).all(query) as Message[];
}

export function getContextWindow(
  db: Database.Database, anchorId: string, groupId: string, before: number, after: number
): Message[] {
  const anchor = db.prepare(
    "SELECT rowid, timestamp FROM messages WHERE id = ?"
  ).get(anchorId) as { rowid: number; timestamp: string } | undefined;

  if (!anchor) return [];

  return db.prepare(`
    SELECT * FROM messages
    WHERE group_id = ? AND rowid >= (
      SELECT COALESCE(MIN(rowid), 0) FROM (
        SELECT rowid FROM messages WHERE group_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?
      )
    ) AND rowid <= (
      SELECT COALESCE(MAX(rowid), ?) FROM (
        SELECT rowid FROM messages WHERE group_id = ? AND rowid > ? ORDER BY rowid ASC LIMIT ?
      )
    )
    ORDER BY rowid ASC
  `).all(groupId, groupId, anchor.rowid, before, anchor.rowid, groupId, anchor.rowid, after) as Message[];
}

export function getUntranscribedVoiceMessages(db: Database.Database, maxRetries: number = 3): Message[] {
  return db.prepare(`
    SELECT * FROM messages
    WHERE msg_type = 'voice' AND is_transcribed = 0 AND content IS NULL
      AND media_url IS NOT NULL AND transcription_retries < ?
    LIMIT 50
  `).all(maxRetries) as Message[];
}

export function incrementTranscriptionRetries(db: Database.Database, id: string): void {
  db.prepare("UPDATE messages SET transcription_retries = transcription_retries + 1 WHERE id = ?").run(id);
}

export function updateMessageContent(db: Database.Database, id: string, content: string): void {
  db.prepare("UPDATE messages SET content = ?, is_transcribed = 1 WHERE id = ?").run(content, id);
}

// ── Groups ──

export function upsertGroup(db: Database.Database, id: string, name: string, memberCount: number): void {
  db.prepare(`
    INSERT INTO groups (id, name, member_count, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, member_count = excluded.member_count, updated_at = datetime('now')
  `).run(id, name, memberCount);
}

export function getAllGroups(db: Database.Database): { id: string; name: string; member_count: number }[] {
  return db.prepare("SELECT id, name, member_count FROM groups ORDER BY name").all() as any[];
}

export function getGroupActivity(
  db: Database.Database, groupId: string, from: string, to: string
): { message_count: number; active_users: number; top_users: { sender_name: string; count: number }[] } {
  const stats = db.prepare(`
    SELECT COUNT(*) as message_count, COUNT(DISTINCT sender_id) as active_users
    FROM messages WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
  `).get(groupId, from, to) as { message_count: number; active_users: number };

  const topUsers = db.prepare(`
    SELECT sender_name, COUNT(*) as count FROM messages
    WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
    GROUP BY sender_id ORDER BY count DESC LIMIT 10
  `).all(groupId, from, to) as { sender_name: string; count: number }[];

  return { ...stats, top_users: topUsers };
}

// ── Subscriptions ──

export function insertSubscription(db: Database.Database, sub: Subscription): void {
  db.prepare(`
    INSERT INTO subscriptions (id, keyword, match_mode, groups, notify_channels, auto_push, schedule_cron, threshold, threshold_window, enabled, created_at)
    VALUES (@id, @keyword, @match_mode, @groups, @notify_channels, @auto_push, @schedule_cron, @threshold, @threshold_window, @enabled, @created_at)
  `).run({
    ...sub,
    groups: sub.groups ? JSON.stringify(sub.groups) : null,
    notify_channels: JSON.stringify(sub.notify_channels),
    auto_push: sub.auto_push ? 1 : 0,
    enabled: sub.enabled ? 1 : 0,
  });
}

export function getEnabledSubscriptions(db: Database.Database): Subscription[] {
  const rows = db.prepare("SELECT * FROM subscriptions WHERE enabled = 1").all() as any[];
  return rows.map(deserializeSubscription);
}

export function getSubscriptionById(db: Database.Database, id: string): Subscription | undefined {
  const row = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as any;
  return row ? deserializeSubscription(row) : undefined;
}

export function updateSubscription(db: Database.Database, id: string, updates: Partial<Subscription>): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "id") continue;
    if (key === "groups") {
      fields.push("groups = ?");
      values.push(value ? JSON.stringify(value) : null);
    } else if (key === "notify_channels") {
      fields.push("notify_channels = ?");
      values.push(JSON.stringify(value));
    } else if (key === "auto_push" || key === "enabled") {
      fields.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE subscriptions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteSubscription(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
}

function deserializeSubscription(row: any): Subscription {
  return {
    ...row,
    groups: row.groups ? JSON.parse(row.groups) : null,
    notify_channels: JSON.parse(row.notify_channels),
    auto_push: Boolean(row.auto_push),
    enabled: Boolean(row.enabled),
  };
}

// ── Reports ──

export function insertReport(db: Database.Database, report: Report): void {
  db.prepare(`
    INSERT INTO reports (id, subscription_id, keyword, group_id, time_from, time_to, summary, sentiment, key_opinions, disputes, action_items, trends, full_report, created_at)
    VALUES (@id, @subscription_id, @keyword, @group_id, @time_from, @time_to, @summary, @sentiment, @key_opinions, @disputes, @action_items, @trends, @full_report, @created_at)
  `).run({
    ...report,
    sentiment: JSON.stringify(report.sentiment),
    key_opinions: JSON.stringify(report.key_opinions),
    disputes: JSON.stringify(report.disputes),
    action_items: JSON.stringify(report.action_items),
    trends: JSON.stringify(report.trends),
  });
}

export function getReportById(db: Database.Database, id: string): Report | undefined {
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as any;
  return row ? deserializeReport(row) : undefined;
}

export function getReportsByKeyword(
  db: Database.Database, keyword?: string, groupId?: string, from?: string, to?: string
): Report[] {
  let sql = "SELECT * FROM reports WHERE 1=1";
  const params: unknown[] = [];

  if (keyword) { sql += " AND keyword = ?"; params.push(keyword); }
  if (groupId) { sql += " AND group_id = ?"; params.push(groupId); }
  if (from) { sql += " AND time_from >= ?"; params.push(from); }
  if (to) { sql += " AND time_to <= ?"; params.push(to); }

  sql += " ORDER BY created_at DESC LIMIT 50";
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(deserializeReport);
}

function deserializeReport(row: any): Report {
  return {
    ...row,
    sentiment: JSON.parse(row.sentiment),
    key_opinions: JSON.parse(row.key_opinions),
    disputes: JSON.parse(row.disputes),
    action_items: JSON.parse(row.action_items),
    trends: JSON.parse(row.trends),
  };
}

// ── Message Topic Links ──

export function insertMessageTopicLinks(
  db: Database.Database,
  links: { message_id: string; subscription_id: string; anchor_id: string; relevance: number; method: string }[],
): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO message_topic_links (message_id, subscription_id, anchor_id, relevance, method)
    VALUES (@message_id, @subscription_id, @anchor_id, @relevance, @method)
  `);
  const insertMany = db.transaction((rows: typeof links) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(links);
}

// ── Keyword Matching (shared utility) ──

export function matchesKeyword(content: string, keyword: string, mode: string): boolean {
  switch (mode) {
    case "exact":
      return content === keyword;
    case "fuzzy":
      return content.toLowerCase().includes(keyword.toLowerCase());
    case "regex":
      return new RegExp(keyword).test(content);
    default:
      return content.toLowerCase().includes(keyword.toLowerCase());
  }
}

// ── Cleanup ──

export function cleanupOldMessages(db: Database.Database, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();

  // Delete orphaned topic links first
  db.prepare(`
    DELETE FROM message_topic_links
    WHERE message_id IN (SELECT id FROM messages WHERE timestamp < ?)
  `).run(cutoff);

  // Delete old messages (FTS trigger handles cleanup)
  const result = db.prepare("DELETE FROM messages WHERE timestamp < ?").run(cutoff);

  // Safety net: rebuild FTS index
  db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");

  return result.changes;
}

export function cleanupOldReports(db: Database.Database, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  const result = db.prepare("DELETE FROM reports WHERE created_at < ?").run(cutoff);
  return result.changes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/db.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/db/queries.ts tests/shared/db.test.ts
git commit -m "feat: add database query functions with FTS search and cleanup"
```

---

## Chunk 3: AI Provider and Analyzer

### Task 6: AI provider (OpenAI)

**Files:**
- Create: `src/shared/ai/prompts.ts`
- Create: `src/shared/ai/openai.ts`
- Create: `src/shared/ai/index.ts`
- Create: `tests/shared/ai.test.ts`

- [ ] **Step 1: Write prompt templates**

```typescript
// src/shared/ai/prompts.ts
import type { Message } from "../types.js";

export function buildAnalysisPrompt(messages: Message[], keyword: string): string {
  const messagesJson = messages.map((m) => ({
    id: m.id,
    sender: m.sender_name,
    content: m.content,
    timestamp: m.timestamp,
    type: m.msg_type,
  }));

  return `You are a WeChat group message analyst.

## Task
From the following group chat messages, identify discussions related to the topic "${keyword}" and generate an analysis report.

## Messages
${JSON.stringify(messagesJson, null, 2)}

## Instructions
1. Identify which messages belong to this topic's discussion (note: multiple topics may interleave; consider @mentions, quoted replies, and time proximity)
2. Generate:
   - Core summary (3-5 sentences)
   - Key opinions list (who said what)
   - Sentiment distribution (positive/neutral/negative percentages, must sum to 1.0)
   - Opinion disputes (differing viewpoints and who holds them)
   - Action items (decisions made, tasks mentioned, deadlines)
   - Activity metrics (participant count, message density per hour, duration in minutes)

## Output Format
Return ONLY valid JSON matching this exact schema, no other text:
{
  "related_message_ids": ["msg_id_1", "msg_id_2"],
  "report": {
    "summary": "string (3-5 sentences)",
    "sentiment": { "positive": 0.48, "neutral": 0.35, "negative": 0.17 },
    "key_opinions": [{ "sender": "name", "opinion": "string", "stance": "positive" }],
    "disputes": [{ "topic": "string", "sides": [{ "who": "name", "position": "string" }] }],
    "action_items": [{ "item": "string", "assignee": null, "deadline": null }],
    "trends": { "message_count": 0, "participant_count": 0, "density_per_hour": 0, "duration_minutes": 0 }
  }
}`;
}

export function buildMergePrompt(reports: Record<string, unknown>[]): string {
  const keyword = (reports[0] as any)?.keyword ?? "unknown";
  return `You are a WeChat group message analyst. Merge these segment reports about "${keyword}" into one unified report.

## Segment Reports
${JSON.stringify(reports, null, 2)}

## Instructions
Combine all segments into a single coherent report. Deduplicate opinions, merge sentiment scores (weighted by message count), consolidate action items, and compute overall trends.

Return ONLY valid JSON with the same schema as the individual reports (related_message_ids + report object).`;
}
```

- [ ] **Step 2: Write failing test for OpenAI provider**

```typescript
// tests/shared/ai.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildAnalysisPrompt } from "../../src/shared/ai/prompts.js";
import type { Message } from "../../src/shared/types.js";

describe("AI Prompts", () => {
  it("builds analysis prompt with messages and keyword", () => {
    const messages: Message[] = [
      {
        id: "m1", group_id: "g1", sender_id: "s1", sender_name: "Alice",
        content: "I think AI agents are great", media_url: null,
        msg_type: "text", is_transcribed: false, timestamp: "2026-03-21T10:00:00Z",
      },
    ];

    const prompt = buildAnalysisPrompt(messages, "AI agents");
    expect(prompt).toContain("AI agents");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("I think AI agents are great");
    expect(prompt).toContain("related_message_ids");
  });
});
```

- [ ] **Step 3: Run test to verify it passes** (prompts.ts is pure, should pass)

Run: `npx vitest run tests/shared/ai.test.ts`
Expected: PASS

- [ ] **Step 4: Write OpenAI provider**

```typescript
// src/shared/ai/openai.ts
import OpenAI from "openai";
import type { AIProvider, AnalysisResult, Message } from "../types.js";
import { buildAnalysisPrompt, buildMergePrompt } from "./prompts.js";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    this.model = model;
  }

  async analyze(messages: Message[], keyword: string): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(messages, keyword);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");
    return JSON.parse(content) as AnalysisResult;
  }

  async mergeReports(reports: AnalysisResult[], keyword: string): Promise<AnalysisResult> {
    const segmentData = reports.map((r) => ({ ...r.report, keyword }));
    const prompt = buildMergePrompt(segmentData);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI merge response");
    return JSON.parse(content) as AnalysisResult;
  }
}
```

- [ ] **Step 5: Write AI provider factory**

```typescript
// src/shared/ai/index.ts
import type { AIProvider, AppConfig } from "../types.js";
import { OpenAIProvider } from "./openai.js";

export function createAIProvider(config: AppConfig["ai"]): AIProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAIProvider(config.api_key, config.model, config.base_url);
    case "claude":
      if (!config.base_url) throw new Error("Claude provider requires ai.base_url in config");
      return new OpenAIProvider(config.api_key, config.model, config.base_url);
    case "ollama":
      return new OpenAIProvider(config.api_key, config.model, config.base_url ?? "http://localhost:11434/v1");
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

export type { AIProvider };
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/ai/ tests/shared/ai.test.ts
git commit -m "feat: add AI provider with OpenAI implementation and analysis prompts"
```

---

### Task 7: Analyzer (core analysis + segmenter)

**Files:**
- Create: `src/shared/analyzer/segmenter.ts`
- Create: `src/shared/analyzer/index.ts`
- Create: `tests/shared/analyzer.test.ts`

- [ ] **Step 1: Write failing test for segmenter**

```typescript
// tests/shared/analyzer.test.ts
import { describe, it, expect } from "vitest";
import { segmentMessages } from "../../src/shared/analyzer/segmenter.js";
import type { Message } from "../../src/shared/types.js";

function makeMsg(id: string, timestamp: string, content: string): Message {
  return {
    id, group_id: "g1", sender_id: "s1", sender_name: "Alice",
    content, media_url: null, msg_type: "text",
    is_transcribed: false, timestamp,
  };
}

describe("segmentMessages", () => {
  it("keeps small batches as a single segment", () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`m${i}`, `2026-03-21T10:${String(i).padStart(2, "0")}:00Z`, `msg ${i}`)
    );
    const segments = segmentMessages(msgs, 150);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(10);
  });

  it("splits at >5 min gaps", () => {
    const msgs = [
      makeMsg("m0", "2026-03-21T10:00:00Z", "hello"),
      makeMsg("m1", "2026-03-21T10:01:00Z", "world"),
      // 10 min gap
      makeMsg("m2", "2026-03-21T10:11:00Z", "new topic"),
      makeMsg("m3", "2026-03-21T10:12:00Z", "indeed"),
    ];
    const segments = segmentMessages(msgs, 150);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(2);
  });

  it("splits at max message count", () => {
    const msgs = Array.from({ length: 200 }, (_, i) =>
      makeMsg(`m${i}`, `2026-03-21T10:00:${String(i % 60).padStart(2, "0")}Z`, `msg ${i}`)
    );
    const segments = segmentMessages(msgs, 100);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0].length).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/analyzer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write segmenter**

```typescript
// src/shared/analyzer/segmenter.ts
import type { Message } from "../types.js";

const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export function segmentMessages(messages: Message[], maxPerSegment: number = 150): Message[][] {
  if (messages.length === 0) return [];
  if (messages.length <= maxPerSegment && !hasLargeGap(messages)) {
    return [messages];
  }

  const segments: Message[][] = [];
  let current: Message[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prevTime = new Date(messages[i - 1].timestamp).getTime();
    const currTime = new Date(messages[i].timestamp).getTime();
    const gap = currTime - prevTime;

    if (gap > GAP_THRESHOLD_MS || current.length >= maxPerSegment) {
      segments.push(current);
      current = [messages[i]];
    } else {
      current.push(messages[i]);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function hasLargeGap(messages: Message[]): boolean {
  for (let i = 1; i < messages.length; i++) {
    const gap = new Date(messages[i].timestamp).getTime() - new Date(messages[i - 1].timestamp).getTime();
    if (gap > GAP_THRESHOLD_MS) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/analyzer.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Write core analyzer**

```typescript
// src/shared/analyzer/index.ts
import type { AIProvider, AnalysisResult, Message, Report, AppConfig } from "../types.js";
import type Database from "better-sqlite3";
import { segmentMessages } from "./segmenter.js";
import { getContextWindow } from "../db/queries.js";
import { v4 as uuidv4 } from "uuid";

export interface AnalyzeOptions {
  keyword: string;
  groupId?: string;
  timeFrom: string;
  timeTo: string;
  subscriptionId?: string;
}

export async function analyzeTopicFromMessages(
  messages: Message[],
  keyword: string,
  aiProvider: AIProvider,
  maxPerSegment: number = 150,
): Promise<AnalysisResult> {
  if (messages.length === 0) {
    return emptyResult();
  }

  const segments = segmentMessages(messages, maxPerSegment);

  if (segments.length === 1) {
    return aiProvider.analyze(segments[0], keyword);
  }

  // Analyze segments in parallel
  const segmentResults = await Promise.all(
    segments.map((seg) => aiProvider.analyze(seg, keyword))
  );

  // Merge results
  return aiProvider.mergeReports(segmentResults, keyword);
}

export function buildContextMessages(
  db: Database.Database,
  anchorIds: string[],
  groupId: string,
  config: AppConfig["analysis"],
): Message[] {
  const seen = new Set<string>();
  const allMessages: Message[] = [];

  for (const anchorId of anchorIds) {
    const window = getContextWindow(db, anchorId, groupId, config.context_before, config.context_after);
    for (const msg of window) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        allMessages.push(msg);
      }
    }
  }

  // Sort by timestamp
  allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return allMessages;
}

export function buildReportFromAnalysis(
  result: AnalysisResult,
  opts: AnalyzeOptions,
): Report {
  const fullReport = formatMarkdownReport(result, opts.keyword);

  return {
    id: uuidv4(),
    subscription_id: opts.subscriptionId ?? null,
    keyword: opts.keyword,
    group_id: opts.groupId ?? null,
    time_from: opts.timeFrom,
    time_to: opts.timeTo,
    summary: result.report.summary,
    sentiment: result.report.sentiment,
    key_opinions: result.report.key_opinions,
    disputes: result.report.disputes,
    action_items: result.report.action_items,
    trends: result.report.trends,
    full_report: fullReport,
    created_at: new Date().toISOString(),
  };
}

function formatMarkdownReport(result: AnalysisResult, keyword: string): string {
  const r = result.report;
  let md = `# Topic Report: ${keyword}\n\n`;
  md += `## Summary\n${r.summary}\n\n`;
  md += `## Key Opinions\n`;
  for (const o of r.key_opinions) {
    md += `- **${o.sender}** (${o.stance}): ${o.opinion}\n`;
  }
  md += `\n## Sentiment\n`;
  md += `Positive: ${(r.sentiment.positive * 100).toFixed(0)}% | `;
  md += `Neutral: ${(r.sentiment.neutral * 100).toFixed(0)}% | `;
  md += `Negative: ${(r.sentiment.negative * 100).toFixed(0)}%\n\n`;
  if (r.disputes.length > 0) {
    md += `## Disputes\n`;
    for (const d of r.disputes) {
      md += `### ${d.topic}\n`;
      for (const s of d.sides) {
        md += `- **${s.who}**: ${s.position}\n`;
      }
    }
    md += `\n`;
  }
  if (r.action_items.length > 0) {
    md += `## Action Items\n`;
    for (const a of r.action_items) {
      md += `- ${a.item}`;
      if (a.assignee) md += ` (${a.assignee})`;
      if (a.deadline) md += ` — by ${a.deadline}`;
      md += `\n`;
    }
    md += `\n`;
  }
  md += `## Activity\n`;
  md += `- Messages: ${r.trends.message_count}\n`;
  md += `- Participants: ${r.trends.participant_count}\n`;
  md += `- Density: ${r.trends.density_per_hour}/hour\n`;
  md += `- Duration: ${r.trends.duration_minutes} minutes\n`;
  return md;
}

function emptyResult(): AnalysisResult {
  return {
    related_message_ids: [],
    report: {
      summary: "No relevant messages found.",
      sentiment: { positive: 0, neutral: 1, negative: 0 },
      key_opinions: [],
      disputes: [],
      action_items: [],
      trends: { message_count: 0, participant_count: 0, density_per_hour: 0, duration_minutes: 0 },
    },
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/analyzer/ tests/shared/analyzer.test.ts
git commit -m "feat: add analyzer with message segmentation and report generation"
```

---

## Chunk 4: STT and GeweChat Adapter

### Task 8: STT provider (Whisper)

**Files:**
- Create: `src/shared/stt/openai-whisper.ts`
- Create: `src/shared/stt/index.ts`

- [ ] **Step 1: Write Whisper STT provider**

```typescript
// src/shared/stt/openai-whisper.ts
import OpenAI, { toFile } from "openai";
import type { STTProvider } from "../types.js";

export class WhisperSTTProvider implements STTProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "whisper-1") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(audioUrl: string): Promise<string> {
    // Download audio file
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = await toFile(buffer, "audio.amr", { type: "audio/amr" });

    const transcription = await this.client.audio.transcriptions.create({
      model: this.model,
      file,
      language: "zh",
    });

    return transcription.text;
  }
}
```

- [ ] **Step 2: Write STT provider factory**

```typescript
// src/shared/stt/index.ts
import type { STTProvider, AppConfig } from "../types.js";
import { WhisperSTTProvider } from "./openai-whisper.js";

export function createSTTProvider(config: AppConfig["stt"]): STTProvider {
  switch (config.provider) {
    case "openai":
      return new WhisperSTTProvider(config.api_key, config.model);
    default:
      throw new Error(`Unknown STT provider: ${config.provider}`);
  }
}

export type { STTProvider };
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/stt/
git commit -m "feat: add STT provider with OpenAI Whisper implementation"
```

---

### Task 9: GeweChat adapter

**Files:**
- Create: `src/collector/gewechat.ts`
- Create: `tests/collector/gewechat.test.ts`

- [ ] **Step 1: Write failing test for message normalization**

```typescript
// tests/collector/gewechat.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMessage } from "../../src/collector/gewechat.js";
import type { GeWeChatMessage } from "../../src/shared/types.js";

describe("GeweChat Adapter", () => {
  it("normalizes a text message", () => {
    const raw: GeWeChatMessage = {
      msg_id: "123456",
      from_user: "wxid_abc",
      from_user_name: "Alice",
      to_user: "wxid_group",
      msg_type: 1,
      content: "Hello everyone!",
      create_time: 1742544000,
      room_id: "room_001",
      room_name: "Tech Group",
    };

    const msg = normalizeMessage(raw);
    expect(msg.id).toBe("123456");
    expect(msg.group_id).toBe("room_001");
    expect(msg.sender_name).toBe("Alice");
    expect(msg.content).toBe("Hello everyone!");
    expect(msg.msg_type).toBe("text");
    expect(msg.media_url).toBeNull();
  });

  it("normalizes a voice message", () => {
    const raw: GeWeChatMessage = {
      msg_id: "789",
      from_user: "wxid_abc",
      from_user_name: "Bob",
      to_user: "wxid_group",
      msg_type: 34,
      content: "",
      create_time: 1742544000,
      room_id: "room_001",
      room_name: "Tech Group",
      voice_url: "https://example.com/voice.amr",
    };

    const msg = normalizeMessage(raw);
    expect(msg.msg_type).toBe("voice");
    expect(msg.media_url).toBe("https://example.com/voice.amr");
    expect(msg.content).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collector/gewechat.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write GeweChat adapter**

```typescript
// src/collector/gewechat.ts
import type { Message, GeWeChatMessage } from "../shared/types.js";

// WeChat message type codes
const MSG_TYPE_MAP: Record<number, Message["msg_type"]> = {
  1: "text",
  3: "image",
  34: "voice",
  49: "link",
};

export function normalizeMessage(raw: GeWeChatMessage): Omit<Message, "rowid"> {
  const msgType = MSG_TYPE_MAP[raw.msg_type] ?? "text";

  let content: string | null = raw.content || null;
  let mediaUrl: string | null = null;

  if (msgType === "voice") {
    content = null; // Will be filled by STT
    mediaUrl = raw.voice_url ?? null;
  } else if (msgType === "image") {
    mediaUrl = raw.image_url ?? null;
  }

  return {
    id: raw.msg_id,
    group_id: raw.room_id,
    sender_id: raw.from_user,
    sender_name: raw.from_user_name,
    content,
    media_url: mediaUrl,
    msg_type: msgType,
    is_transcribed: false,
    timestamp: new Date(raw.create_time * 1000).toISOString(),
  };
}

export interface GeWeChatClient {
  onMessage(handler: (msg: GeWeChatMessage) => void): void;
  start(callbackPort: number): Promise<void>;
  stop(): void;
}

export function createGeWeChatWebhookServer(
  port: number,
  onMessage: (raw: GeWeChatMessage) => void,
): { start: () => Promise<void>; stop: () => void } {
  let server: ReturnType<typeof import("http").createServer> | null = null;

  return {
    async start() {
      const http = await import("http");
      server = http.createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/webhook") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString());
          try {
            onMessage(body);
          } catch (err) {
            console.error("[GeweChat] Error processing message:", err);
          }
          res.writeHead(200);
          res.end("ok");
        } else if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve) => {
        server!.listen(port, () => {
          console.log(`[GeweChat] Webhook server listening on port ${port}`);
          resolve();
        });
      });
    },
    stop() {
      server?.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/collector/gewechat.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/collector/gewechat.ts tests/collector/gewechat.test.ts
git commit -m "feat: add GeweChat adapter with message normalization and webhook server"
```

---

## Chunk 5: Keyword Monitor and Notifier

### Task 10: Keyword monitor

**Files:**
- Create: `src/collector/monitor.ts`
- Create: `tests/collector/monitor.test.ts`

- [ ] **Step 1: Write failing test for keyword matching**

```typescript
// tests/collector/monitor.test.ts
import { describe, it, expect } from "vitest";
import { matchesKeyword } from "../../src/shared/db/queries.js";

describe("Keyword matching", () => {
  it("matches exact keywords", () => {
    expect(matchesKeyword("AI Agent", "AI Agent", "exact")).toBe(true);
    expect(matchesKeyword("ai agent", "AI Agent", "exact")).toBe(false);
    expect(matchesKeyword("I like AI Agents", "AI Agent", "exact")).toBe(false);
  });

  it("matches fuzzy keywords (case-insensitive substring)", () => {
    expect(matchesKeyword("I think AI agents are great", "AI agent", "fuzzy")).toBe(true);
    expect(matchesKeyword("nothing relevant here", "AI agent", "fuzzy")).toBe(false);
  });

  it("matches regex keywords", () => {
    expect(matchesKeyword("GPT-4o is amazing", "GPT-\\d", "regex")).toBe(true);
    expect(matchesKeyword("no match", "GPT-\\d", "regex")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collector/monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write keyword monitor**

```typescript
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
        anchor_id: anchors[0].id, relevance: 1.0, method: "semantic",
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
      anchor_id: anchorIds[0], relevance: 1.0, method: "semantic",
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/collector/monitor.test.ts`
Expected: All 3 matching tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/collector/monitor.ts tests/collector/monitor.test.ts
git commit -m "feat: add keyword monitor with cron scheduling and threshold triggers"
```

---

### Task 11: Notifier (Telegram + Slack)

**Files:**
- Create: `src/collector/notifier/formatter.ts`
- Create: `src/collector/notifier/telegram.ts`
- Create: `src/collector/notifier/slack.ts`
- Create: `src/collector/notifier/index.ts`
- Create: `tests/collector/notifier.test.ts`

- [ ] **Step 1: Write failing test for report formatting**

```typescript
// tests/collector/notifier.test.ts
import { describe, it, expect } from "vitest";
import { formatReportText } from "../../src/collector/notifier/formatter.js";
import type { Report } from "../../src/shared/types.js";

const sampleReport: Report = {
  id: "r1",
  subscription_id: "sub1",
  keyword: "AI Agent",
  group_id: "g1",
  time_from: "2026-03-21T09:00:00Z",
  time_to: "2026-03-21T12:00:00Z",
  summary: "The group discussed AI Agent capabilities extensively.",
  sentiment: { positive: 0.48, neutral: 0.35, negative: 0.17 },
  key_opinions: [
    { sender: "Alice", opinion: "Agents need human oversight", stance: "neutral" },
    { sender: "Bob", opinion: "CrewAI works well in production", stance: "positive" },
  ],
  disputes: [
    { topic: "Production readiness", sides: [
      { who: "Alice", position: "Not mature enough" },
      { who: "Bob", position: "Already usable" },
    ]},
  ],
  action_items: [
    { item: "Test CrewAI framework", assignee: "Bob", deadline: "next week" },
  ],
  trends: { message_count: 23, participant_count: 6, density_per_hour: 7.7, duration_minutes: 180 },
  full_report: "",
  created_at: "2026-03-21T12:00:00Z",
};

describe("Report formatter", () => {
  it("formats a report for TG/Slack text", () => {
    const text = formatReportText(sampleReport, "Web3 Builder Group");
    expect(text).toContain("AI Agent");
    expect(text).toContain("Web3 Builder Group");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("48%");
    expect(text).toContain("Production readiness");
    expect(text).toContain("Test CrewAI framework");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collector/notifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write report formatter**

```typescript
// src/collector/notifier/formatter.ts
import type { Report } from "../../shared/types.js";

export function formatReportText(report: Report, groupName: string): string {
  const lines: string[] = [];

  lines.push(`📊 Topic Monitor Report: ${report.keyword}`);
  lines.push(``);
  lines.push(`🏷 Group: ${groupName}`);
  lines.push(`🕐 Time: ${formatTime(report.time_from)} ~ ${formatTime(report.time_to)}`);
  lines.push(`💬 Messages: ${report.trends.message_count} / ${report.trends.participant_count} participants`);
  lines.push(``);
  lines.push(`【Summary】`);
  lines.push(report.summary);
  lines.push(``);

  if (report.key_opinions.length > 0) {
    lines.push(`【Key Opinions】`);
    for (const o of report.key_opinions) {
      lines.push(`• ${o.sender}: ${o.opinion}`);
    }
    lines.push(``);
  }

  lines.push(`【Sentiment】`);
  lines.push(
    `Positive ${pct(report.sentiment.positive)} | ` +
    `Neutral ${pct(report.sentiment.neutral)} | ` +
    `Negative ${pct(report.sentiment.negative)}`
  );
  lines.push(``);

  if (report.disputes.length > 0) {
    lines.push(`【Disputes】`);
    for (const d of report.disputes) {
      const sides = d.sides.map((s) => `${s.who}`).join(" vs ");
      lines.push(`🔴 ${d.topic}: ${sides}`);
    }
    lines.push(``);
  }

  if (report.action_items.length > 0) {
    lines.push(`【Action Items】`);
    for (const a of report.action_items) {
      let line = `• ${a.item}`;
      if (a.assignee) line += ` (${a.assignee})`;
      if (a.deadline) line += ` — by ${a.deadline}`;
      lines.push(line);
    }
  }

  return lines.join("\n");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collector/notifier.test.ts`
Expected: PASS

- [ ] **Step 5: Write Telegram notifier**

```typescript
// src/collector/notifier/telegram.ts
import { Bot } from "grammy";
import type { Notifier, Report } from "../../shared/types.js";
import { formatReportText } from "./formatter.js";

export class TelegramNotifier implements Notifier {
  private bot: Bot;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
  }

  async send(report: Report, groupName: string): Promise<void> {
    const text = formatReportText(report, groupName);

    // Telegram has a 4096 char limit per message
    if (text.length <= 4096) {
      await this.bot.api.sendMessage(this.chatId, text);
    } else {
      // Split into chunks
      const chunks = splitText(text, 4096);
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.chatId, chunk);
      }
    }
  }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx === -1) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
```

- [ ] **Step 6: Write Slack notifier**

```typescript
// src/collector/notifier/slack.ts
import { WebClient } from "@slack/web-api";
import type { Notifier, Report } from "../../shared/types.js";
import { formatReportText } from "./formatter.js";

export class SlackNotifier implements Notifier {
  private client: WebClient;
  private channel: string;

  constructor(botToken: string, channel: string) {
    this.client = new WebClient(botToken);
    this.channel = channel;
  }

  async send(report: Report, groupName: string): Promise<void> {
    const text = formatReportText(report, groupName);

    await this.client.chat.postMessage({
      channel: this.channel,
      text,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `📊 ${report.keyword} — ${groupName}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Time:* ${report.time_from} ~ ${report.time_to}\n*Messages:* ${report.trends.message_count} / ${report.trends.participant_count} participants` },
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Summary*\n${report.summary}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Sentiment:* Positive ${(report.sentiment.positive * 100).toFixed(0)}% | Neutral ${(report.sentiment.neutral * 100).toFixed(0)}% | Negative ${(report.sentiment.negative * 100).toFixed(0)}%`,
          },
        },
      ],
    });
  }
}
```

- [ ] **Step 7: Write notifier factory**

```typescript
// src/collector/notifier/index.ts
import type { Notifier, AppConfig } from "../../shared/types.js";
import { TelegramNotifier } from "./telegram.js";
import { SlackNotifier } from "./slack.js";

export function createNotifiers(config: AppConfig["notify"]): Map<string, Notifier> {
  const notifiers = new Map<string, Notifier>();

  if (config.telegram.bot_token) {
    notifiers.set("telegram", new TelegramNotifier(config.telegram.bot_token, config.telegram.chat_id));
  }

  if (config.slack.bot_token) {
    notifiers.set("slack", new SlackNotifier(config.slack.bot_token, config.slack.channel));
  }

  return notifiers;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/collector/notifier/ tests/collector/notifier.test.ts
git commit -m "feat: add Telegram and Slack notifiers with report formatting"
```

---

## Chunk 6: Collector Service Entry Point

### Task 12: Collector service

**Files:**
- Create: `src/collector/index.ts`

- [ ] **Step 1: Write collector entry point**

```typescript
// src/collector/index.ts
import { loadConfig } from "../shared/config.js";
import { createDatabase } from "../shared/db/index.js";
import { initSchema } from "../shared/db/schema.js";
import { createAIProvider } from "../shared/ai/index.js";
import { createSTTProvider } from "../shared/stt/index.js";
import { createNotifiers } from "./notifier/index.js";
import { createGeWeChatWebhookServer, normalizeMessage } from "./gewechat.js";
import { KeywordMonitor } from "./monitor.js";
import { insertMessage, upsertGroup, getUntranscribedVoiceMessages, updateMessageContent, incrementTranscriptionRetries } from "../shared/db/queries.js";
import { cleanupOldMessages, cleanupOldReports } from "../shared/db/queries.js";
import cron from "node-cron";
import { resolve } from "path";
import "dotenv/config";

const configPath = resolve(process.env.CONFIG_PATH ?? "config.yaml");
const config = loadConfig(configPath);
const db = createDatabase(resolve(config.database.path));
initSchema(db);

const aiProvider = createAIProvider(config.ai);
const sttProvider = createSTTProvider(config.stt);
const notifiers = createNotifiers(config.notify);
const monitor = new KeywordMonitor(db, config, aiProvider, notifiers);

// ── GeweChat Webhook ──

const webhook = createGeWeChatWebhookServer(config.collector.port, (raw) => {
  // Only process group messages
  if (!raw.room_id) return;

  // Upsert group info
  upsertGroup(db, raw.room_id, raw.room_name, 0);

  // Normalize and store message
  const msg = normalizeMessage(raw);
  insertMessage(db, msg);
  console.log(`[Collector] Message from ${msg.sender_name} in ${raw.room_name}`);

  // Notify monitor
  monitor.onMessage({ ...msg, rowid: undefined });
});

// ── Voice Transcription Retry Job ──

const sttRetryJob = cron.schedule("*/5 * * * *", async () => {
  const untranscribed = getUntranscribedVoiceMessages(db);
  for (const msg of untranscribed) {
    if (!msg.media_url) continue;
    try {
      const text = await sttProvider.transcribe(msg.media_url);
      updateMessageContent(db, msg.id, text);
      console.log(`[STT] Transcribed voice message ${msg.id}`);
      // Re-check against monitor with transcribed content
      monitor.onMessage({ ...msg, content: text });
    } catch (err) {
      incrementTranscriptionRetries(db, msg.id);
      console.error(`[STT] Failed to transcribe ${msg.id}:`, err);
    }
  }
});

// ── Data Retention Cleanup ──

const cleanupJob = cron.schedule(config.retention.cleanup_cron, () => {
  const msgCount = cleanupOldMessages(db, config.retention.messages_days);
  const reportCount = cleanupOldReports(db, config.retention.reports_days);
  console.log(`[Cleanup] Removed ${msgCount} messages, ${reportCount} reports`);
});

// ── Start ──

async function main() {
  await webhook.start();
  monitor.startCronJobs();
  console.log(`[Collector] Started — webhook on port ${config.collector.port}`);
}

// ── Graceful Shutdown ──

process.on("SIGINT", () => {
  console.log("[Collector] Shutting down...");
  webhook.stop();
  monitor.stop();
  sttRetryJob.stop();
  cleanupJob.stop();
  db.close();
  process.exit(0);
});

main().catch((err) => {
  console.error("[Collector] Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/collector/index.ts
git commit -m "feat: add collector service entry point with webhook, STT retry, and cleanup"
```

---

## Chunk 7: MCP Server and Tools

### Task 13: MCP Server entry point

**Files:**
- Create: `src/mcp/index.ts`

- [ ] **Step 1: Write MCP Server entry point**

```typescript
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Server started via stdio");
}

main().catch((err) => {
  console.error("[MCP] Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/index.ts
git commit -m "feat: add MCP server entry point with stdio transport"
```

---

### Task 14: MCP tools — query_topic

**Files:**
- Create: `src/mcp/tools/query-topic.ts`

- [ ] **Step 1: Write query_topic tool**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/query-topic.ts
git commit -m "feat: add query_topic MCP tool"
```

---

### Task 15: MCP tools — subscriptions

**Files:**
- Create: `src/mcp/tools/subscriptions.ts`

- [ ] **Step 1: Write subscription tools**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/mcp/tools/subscriptions.ts
git commit -m "feat: add subscription CRUD MCP tools"
```

---

### Task 16: MCP tools — reports and groups

**Files:**
- Create: `src/mcp/tools/reports.ts`
- Create: `src/mcp/tools/groups.ts`

- [ ] **Step 1: Write report tools**

```typescript
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
```

- [ ] **Step 2: Write group tools**

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools/reports.ts src/mcp/tools/groups.ts
git commit -m "feat: add report and group MCP tools"
```

---

## Chunk 8: Deployment and Integration

### Task 17: Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
# Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist dist/
COPY config.yaml ./
RUN mkdir -p data
EXPOSE 3000 3001
```

- [ ] **Step 2: Write docker-compose.yml**

```yaml
# docker-compose.yml
services:
  gewechat:
    image: gewechat/gewechat
    ports:
      - "2531:2531"
      - "2532:2532"
    volumes:
      - ./data/gewechat:/data
    restart: unless-stopped

  collector:
    build: .
    command: node dist/collector/index.js
    volumes:
      - ./data:/app/data
      - ./config.yaml:/app/config.yaml:ro
    depends_on:
      - gewechat
    env_file: .env
    ports:
      - "3001:3001"
    restart: unless-stopped

  mcp-server:
    build: .
    command: node dist/mcp/index.js
    volumes:
      - ./data:/app/data
      - ./config.yaml:/app/config.yaml:ro
    env_file: .env
    ports:
      - "3000:3000"
    restart: unless-stopped
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add Docker and docker-compose deployment config"
```

---

### Task 18: Build and verify

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds, outputs in `dist/collector/index.js` and `dist/mcp/index.js`

- [ ] **Step 3: Verify MCP server starts**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/mcp/index.js`
Expected: JSON response with server capabilities

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify build and tests pass"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|---|---|---|
| 1 | 1-3 | Project setup, types, config loading |
| 2 | 4-5 | Database layer (schema, FTS5, queries) |
| 3 | 6-7 | AI provider, analyzer, segmenter |
| 4 | 8-9 | STT (Whisper), GeweChat adapter |
| 5 | 10-11 | Keyword monitor, TG/Slack notifiers |
| 6 | 12 | Collector service entry point |
| 7 | 13-16 | MCP server + all tools |
| 8 | 17-18 | Docker deployment, build verification |
