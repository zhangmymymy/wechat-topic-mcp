# WeChat Topic MCP — Design Spec

## Overview

An MCP Server + Collector Service that monitors WeChat group messages via GeweChat (iPad protocol), performs AI-powered topic analysis, and delivers structured reports via Telegram and Slack.

## Goals

- Monitor WeChat group messages passively (read-only, no sending)
- Match messages to keyword subscriptions with contextual awareness
- Generate deep analysis reports: summary, sentiment, opinions, trends, action items
- Support both manual query (via MCP tools) and automatic push (cron / threshold)
- Deliver reports to Telegram and Slack
- Cross-platform deployment (Mac/Linux/Windows via Docker)

## Non-Goals (for now)

- Sending messages in WeChat groups
- Multi-agent debate analysis
- PII anonymization
- WeChat Work (enterprise WeChat) integration
- Multi-platform crawling (Weibo, Xiaohongshu, etc.)
- Audio summary output

---

## Architecture

### Dual-Process Design

Two independent processes sharing a SQLite database:

```
Process 1: Collector Service
  GeweChat ←→ Message Collection → SQLite → Auto Analysis → TG/Slack Push

Process 2: MCP Server
  Claude/IDE ←→ MCP Protocol → SQLite → On-demand Analysis → Response
```

**Why dual-process:**
- Collector crash doesn't affect MCP query capability
- MCP Server stays stateless, aligned with MCP design philosophy
- Each can be deployed and scaled independently
- SQLite as shared storage is simple enough for this data volume

**SQLite Concurrency Strategy:**
Both processes access the same SQLite database. To handle concurrent access safely:
- Enable WAL (Write-Ahead Logging) mode on connection init
- Set `busy_timeout` to 5000ms in both processes
- The Collector is the primary writer (messages, topic links, reports); the MCP Server writes infrequently (subscriptions, on-demand reports)
- This is acceptable for the expected data volume. For high-throughput scenarios, switch to Postgres.

### Core Modules

| Module | Responsibility | Process |
|---|---|---|
| **GeweChat Adapter** | Connect to GeweChat REST API, receive group message callbacks, normalize message format | Collector |
| **Message Store** | Persist messages to SQLite, provide query interface with FTS5 full-text search | Shared |
| **Keyword Monitor** | Manage keyword subscriptions, match messages, trigger analysis (cron + threshold) | Collector |
| **Analyzer** | Call AI API for context-aware topic extraction, summarization, sentiment analysis, action items. Lives in `src/shared/analyzer/`, used by both processes. | Shared |
| **Notifier** | Push analysis reports to Telegram / Slack | Collector |
| **MCP Tools** | Expose MCP tools for manual query and subscription management | MCP Server |

---

## Data Model

### Tables

Note: The SQL below is conceptual. Actual DDL will use valid SQLite syntax including separate `CREATE INDEX` statements and FTS5 virtual tables.

```sql
-- Group information
CREATE TABLE groups (
  id            TEXT PRIMARY KEY,     -- WeChat group ID
  name          TEXT,                 -- Group name
  member_count  INTEGER,
  created_at    DATETIME,
  updated_at    DATETIME
);

-- Raw messages (uses INTEGER rowid for FTS5 compatibility)
CREATE TABLE messages (
  rowid         INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT UNIQUE NOT NULL, -- WeChat message ID
  group_id      TEXT,                 -- Group reference
  sender_id     TEXT,                 -- Sender WeChat ID
  sender_name   TEXT,                 -- Sender nickname
  content       TEXT,                 -- Message content (text or transcribed voice)
  media_url     TEXT,                 -- Original media file URL (voice/image/file)
  msg_type      TEXT,                 -- text | voice | image | link | file
  is_transcribed BOOLEAN DEFAULT false, -- Whether voice was transcribed
  timestamp     DATETIME
);

CREATE INDEX idx_group_time ON messages (group_id, timestamp);

-- FTS5 virtual table for full-text search on message content
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=rowid
);

-- Sync triggers: external-content FTS5 tables do NOT auto-update.
-- These triggers keep the FTS index in sync with the messages table.
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Keyword subscriptions
CREATE TABLE subscriptions (
  id            TEXT PRIMARY KEY,
  keyword       TEXT,                 -- Keyword or regex
  match_mode    TEXT,                 -- exact | fuzzy | regex
  groups        TEXT,                 -- JSON array, null = all groups (e.g. ["group_id_1"] or null)
  notify_channels TEXT,               -- JSON ["telegram", "slack"]
  auto_push     BOOLEAN DEFAULT true,
  schedule_cron TEXT,                 -- Cron expression, e.g. "0 * * * *"
  threshold     INTEGER,              -- Message count to trigger
  threshold_window INTEGER,           -- Threshold time window (seconds)
  enabled       BOOLEAN DEFAULT true,
  created_at    DATETIME
);

-- Message-topic association
-- When context windows of multiple anchors overlap, one row per anchor is created
CREATE TABLE message_topic_links (
  message_id    TEXT,
  subscription_id TEXT,
  anchor_id     TEXT,                 -- The nearest anchor message that triggered matching
  relevance     REAL,                 -- AI-judged relevance score 0-1
  method        TEXT,                 -- direct | context | semantic
  PRIMARY KEY (message_id, subscription_id, anchor_id)
);

-- Analysis reports
-- subscription_id is nullable: null for on-demand reports (query_topic),
-- set for auto-push reports. keyword is denormalized for on-demand queries.
CREATE TABLE reports (
  id            TEXT PRIMARY KEY,
  subscription_id TEXT,               -- Associated subscription (for auto-push), nullable
  keyword       TEXT,                 -- Denormalized for on-demand reports
  group_id      TEXT,                 -- Single group or null = cross-group
  time_from     DATETIME,
  time_to       DATETIME,
  summary       TEXT,                 -- 3-5 sentence summary
  sentiment     TEXT,                 -- JSON { positive: %, neutral: %, negative: % }
  key_opinions  TEXT,                 -- JSON [{ sender, opinion, stance }]
  disputes      TEXT,                 -- JSON [{ topic, sides: [{ who, position }] }]
  action_items  TEXT,                 -- JSON [{ item, assignee?, deadline? }]
  trends        TEXT,                 -- JSON { message_count, participant_count, density, duration }
  full_report   TEXT,                 -- Complete structured report (Markdown)
  created_at    DATETIME
);
```

### Postgres Compatibility

When `database.type` is set to `postgres`:
- FTS5 is replaced by Postgres `tsvector`/`tsquery` with `zhparser` extension for Chinese
- `messages_fts` virtual table is replaced by a GIN index on a `tsvector` column
- SQLite concurrency concerns do not apply
- All other table definitions remain the same

---

## Context-Aware Topic Matching

### Three-Layer Strategy

**Layer 1 — Direct Match:** Message contains the keyword → marked as "anchor message."

**Layer 2 — Context Window:** Anchor message ± N messages (default: 5 before, 10 after) become "candidate context."

**Layer 3 — AI Semantic Judgment:** Candidates are sent to AI in batch to determine actual relevance.

### Additional Signals

- **Quote/Reply relations:** WeChat quoted messages have explicit pointers → direct association
- **@mentions:** If A posted the anchor and B @A in reply → likely related
- **Time density:** Same-topic discussion is usually time-dense; >5 min gap may indicate topic switch

### Batch Analysis Approach (chosen over real-time)

Messages are stored immediately with lightweight keyword tagging. When a cron job fires or threshold is reached:

1. Fetch anchor messages + context windows from DB
2. Send to AI in one call that does both: (a) filter relevant messages, (b) generate analysis report
3. Store results in `message_topic_links` and `reports` tables

This merges "semantic judgment" and "report generation" into a single AI call, saving cost and latency.

### AI Prompt Design

```
You are a WeChat group message analyst.

## Task
From the following group chat messages, identify discussions related to the topic "{keyword}" and generate an analysis report.

## Messages
{messages_json}

## Instructions
1. Identify which messages belong to this topic's discussion (note: multiple topics may interleave; consider @mentions, quoted replies, and time proximity)
2. Generate:
   - Core summary (3-5 sentences)
   - Key opinions list (who said what)
   - Sentiment distribution (positive/neutral/negative percentages)
   - Opinion disputes (differing viewpoints and who holds them)
   - Action items (decisions made, tasks mentioned, deadlines)
   - Activity metrics (participant count, message density, duration)

## Output Format
Return JSON matching this schema:
{
  "related_message_ids": ["msg_id_1", "msg_id_2"],
  "report": {
    "summary": "string (3-5 sentences)",
    "sentiment": { "positive": 0.48, "neutral": 0.35, "negative": 0.17 },
    "key_opinions": [{ "sender": "name", "opinion": "string", "stance": "positive|neutral|negative" }],
    "disputes": [{ "topic": "string", "sides": [{ "who": "name", "position": "string" }] }],
    "action_items": [{ "item": "string", "assignee": "name|null", "deadline": "string|null" }],
    "trends": { "message_count": 0, "participant_count": 0, "density_per_hour": 0, "duration_minutes": 0 }
  }
}
```

When using OpenAI, prefer structured output (response_format / function calling) to guarantee parseable JSON.

### Large Volume Segmentation

For message volumes exceeding the AI context window:
- Split at natural conversation gaps (>5 min silence) or at 150 messages, whichever comes first
- Analyze each segment independently
- Run a merge summarization pass that combines segment reports into a final unified report
- Segment boundaries respect conversation threads — avoid splitting mid-discussion

---

## Voice Message Transcription

WeChat groups commonly contain voice messages. The Collector will:

1. Receive voice message via GeweChat callback (audio file URL)
2. Store the original audio URL in `messages.media_url`
3. Download the audio file
4. Transcribe using OpenAI Whisper API (or configurable STT provider)
5. Store transcribed text in `messages.content` with `is_transcribed = true`
6. Voice messages participate in keyword matching and analysis like text messages

**Transcription failure handling:** If STT fails (API down, rate limited), store the message with `content = null` and `media_url` preserved. A background retry job picks up untranscribed voice messages every 5 minutes (max 3 retries).

---

## MCP Tools

| Tool | Parameters | Description |
|---|---|---|
| `query_topic` | `keyword`, `group?`, `time_range?` | Core tool — query keyword discussions, return analysis report |
| `list_groups` | — | List all monitored groups |
| `list_subscriptions` | — | List all keyword subscriptions |
| `add_subscription` | `keyword`, `match_mode?`, `groups?`, `notify_channels`, `schedule_cron?`, `threshold?`, `threshold_window?` | Add keyword subscription for auto-push |
| `update_subscription` | `id`, updatable fields | Modify subscription config |
| `remove_subscription` | `id` | Delete subscription |
| `get_report` | `report_id` | Retrieve a historical analysis report |
| `list_reports` | `keyword?`, `group?`, `time_range?` | Browse historical reports |
| `get_group_activity` | `group_id`, `time_range?` | Group activity stats (message volume, active users, etc.) |

### Usage Examples

- "Summarize today's discussion about AI Agent in the Web3 group" → `query_topic`
- "Whenever someone discusses MCP, push to my TG" → `add_subscription`
- "Which group was most active this week?" → `get_group_activity`
- Interactive follow-up is naturally supported by MCP — user continues asking in Claude conversation

---

## Notification Design

### Report Format (Telegram / Slack)

```
Topic Monitor Report: {keyword}

Group: {group_name}
Time Range: {time_from} ~ {time_to}
Related Messages: {count} messages / {participant_count} participants

[Summary]
{3-5 sentence summary}

[Key Opinions]
- {sender}: {opinion}
- {sender}: {opinion}

[Sentiment]
Positive {x}% | Neutral {y}% | Negative {z}%

[Disputes]
{topic}: {side_a} vs {side_b}

[Action Items]
- {item} (assignee: {who}, deadline: {when})
```

Telegram: plain text with emoji formatting.
Slack: Block Kit structured message with collapsible sections.

### Push Strategies

| Trigger | Logic |
|---|---|
| **Scheduled** | Cron fires → query anchor messages since last run → batch analyze → push. No messages = no push. |
| **Threshold** | Sliding window: anchor count >= threshold → trigger analysis → push. Cooldown period (default 30 min) prevents spam. |

### Deduplication

- Threshold triggers have a cooldown period per subscription
- Scheduled summaries only cover messages after the last summary
- Reports are stored in DB — no duplicate generation

---

## Configuration

### config.yaml

```yaml
gewechat:
  base_url: "http://localhost:2531"
  callback_url: "http://localhost:3001/webhook"

database:
  type: "sqlite"               # sqlite | postgres
  path: "./data/wechat.db"

ai:
  provider: "openai"           # openai | claude | ollama
  api_key: "${OPENAI_API_KEY}"
  model: "gpt-4o"
  max_context_messages: 200

stt:
  provider: "openai"           # openai | azure | local
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

### Environment Variables

All secrets via env vars: `OPENAI_API_KEY`, `TG_BOT_TOKEN`, `TG_CHAT_ID`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL`.

---

## Deployment

### docker-compose.yml

```yaml
services:
  gewechat:
    image: gewechat/gewechat
    ports: [2531:2531, 2532:2532]
    volumes: [./data/gewechat:/data]

  collector:
    build: .
    command: node dist/collector/index.js
    volumes: [./data:/app/data, ./config.yaml:/app/config.yaml]
    depends_on: [gewechat]
    env_file: .env

  mcp-server:
    build: .
    command: node dist/mcp/index.js
    volumes: [./data:/app/data, ./config.yaml:/app/config.yaml]
    env_file: .env
```

MCP Server can also run locally (without Docker) for Claude Desktop / Claude Code integration via stdio transport.

### MCP Transport

- **stdio**: For local use with Claude Desktop / Claude Code (default)
- **SSE (Server-Sent Events)**: For Docker/remote deployment, exposed on the configured port

---

## Project Structure

```
wechat-topic-mcp/
├── src/
│   ├── shared/
│   │   ├── db/
│   │   │   ├── index.ts          # DB connection factory (SQLite/Postgres)
│   │   │   ├── schema.ts         # Table definitions and migrations
│   │   │   └── queries.ts        # Shared query functions
│   │   ├── ai/
│   │   │   ├── index.ts          # Provider factory
│   │   │   ├── openai.ts         # OpenAI provider
│   │   │   ├── claude.ts         # Claude provider
│   │   │   ├── ollama.ts         # Ollama provider
│   │   │   └── prompts.ts        # Analysis prompt templates
│   │   ├── stt/
│   │   │   ├── index.ts          # STT provider factory
│   │   │   └── openai-whisper.ts # Whisper transcription
│   │   ├── analyzer/
│   │   │   ├── index.ts          # Core analysis function (used by both processes)
│   │   │   └── segmenter.ts      # Message volume segmentation logic
│   │   └── types.ts              # Shared type definitions
│   ├── collector/
│   │   ├── index.ts              # Entry point
│   │   ├── gewechat.ts           # GeweChat Adapter
│   │   ├── monitor.ts            # Keyword Monitor (cron + threshold)
│   │   └── notifier/
│   │       ├── index.ts          # Notifier factory
│   │       ├── telegram.ts       # Telegram Bot push
│   │       └── slack.ts          # Slack Bot push
│   └── mcp/
│       ├── index.ts              # MCP Server entry point
│       └── tools/
│           ├── query-topic.ts    # query_topic tool
│           ├── subscriptions.ts  # add/update/remove/list subscriptions
│           ├── reports.ts        # get/list reports
│           └── groups.ts         # list_groups, get_group_activity
├── config.yaml
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20+ / TypeScript |
| MCP SDK | @modelcontextprotocol/sdk |
| WeChat | GeweChat (iPad protocol, Docker) |
| Database | better-sqlite3 (SQLite) / pg (Postgres) |
| Full-text search | SQLite FTS5 |
| AI | OpenAI SDK (default), configurable |
| STT | OpenAI Whisper API |
| Telegram | grammy (Telegram Bot framework) |
| Slack | @slack/bolt |
| Cron | node-cron |
| Config | yaml + dotenv |
| Build | tsup |
| Docker | docker-compose |

---

## Error Handling & Resilience

| Component | Failure | Strategy |
|---|---|---|
| **GeweChat** | Connection lost | Auto-reconnect with exponential backoff (1s, 2s, 4s, max 60s). Log warning after 3 failures. |
| **AI API** | Rate limit / timeout | Retry 3 times with backoff. If analysis fails, skip this cycle and retry next trigger. Report is not created until successful. |
| **STT (Whisper)** | Transcription fails | Store message with null content, preserve media_url. Retry job every 5 min, max 3 retries. |
| **Telegram/Slack** | Push fails | Retry 3 times. On persistent failure, store report in DB (accessible via MCP `get_report`), log error. |
| **SQLite** | SQLITE_BUSY | WAL mode + 5000ms busy_timeout handles most cases. If still fails, retry once after 1s. |

### Health Check

Collector exposes `GET /health` endpoint returning:
- GeweChat connection status
- Last message received timestamp (alert if >10 min gap during expected active hours)
- Database accessible (read/write test)
- Pending voice transcription queue size

---

## Data Retention

Configurable in `config.yaml`:

```yaml
retention:
  messages_days: 90          # Delete raw messages older than N days
  reports_days: 365          # Delete reports older than N days
  cleanup_cron: "0 3 * * *" # Run cleanup daily at 3 AM
```

Cleanup job:
1. Delete orphaned `message_topic_links` entries (where message no longer exists)
2. Delete from `messages` where `timestamp` < cutoff (the `messages_ad` trigger automatically removes corresponding FTS entries before each row is deleted)
3. As a safety net, run `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` to re-index from remaining content
4. Delete old reports per `reports_days`
5. Run `VACUUM` periodically (weekly) to reclaim space

---

## Future Enhancements (out of scope for v1)

- Multi-agent debate analysis for deeper insights
- Summary image card generation (for more visual TG/Slack notifications)
- WeChat Work official API integration (zero ban risk path)
- Multi-platform monitoring (Weibo, Xiaohongshu, etc.)
- PII anonymization for enterprise use
- Web dashboard for subscription management
