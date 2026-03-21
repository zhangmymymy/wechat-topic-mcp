# WeChat Topic MCP

Monitor WeChat group chats, analyze discussions by keyword, and get structured reports pushed to Telegram/Slack — all accessible via MCP (Model Context Protocol).

## How It Works

```
Mac WeChat (running) → lldb memory scan → extract DB keys
                                            ↓
              Encrypted local SQLite DBs → decrypt → import messages
                                                       ↓
                                              System SQLite DB
                                              ↓              ↓
                                    MCP Server          Collector Service
                                   (on-demand query)   (scheduled sync + auto push)
                                         ↓                    ↓
                                  Claude / IDE          Telegram / Slack
```

1. **Sync** — Extracts encryption keys from the running WeChat process, decrypts local message databases, and imports new messages into the system DB (incremental).
2. **Analyze** — Given a keyword, uses AI (OpenAI/Claude/Ollama) to identify related messages across group chats, then generates a structured report with summary, sentiment, key opinions, disputes, and trends.
3. **Push** — Sends reports to Telegram and/or Slack.
4. **MCP** — Exposes 9 tools for Claude Desktop / Claude Code to query topics, manage subscriptions, browse reports, and monitor group activity.

## Prerequisites

- **macOS** (ARM64) with WeChat desktop installed and logged in
- **SIP disabled** (required for lldb to attach to WeChat process for key extraction)
- **sqlcipher**: `brew install sqlcipher`
- **Node.js** >= 18
- **Python 3** (system or Homebrew, for key extraction scripts)
- [wechat-db-decrypt-macos](https://github.com/Thearas/wechat-db-decrypt-macos) scripts cloned locally

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/zhangmymymy/wechat-topic-mcp.git
cd wechat-topic-mcp
npm install
```

### 2. Clone the decrypt scripts

```bash
git clone https://github.com/Thearas/wechat-db-decrypt-macos.git /tmp/wechat-decrypt
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```
OPENAI_API_KEY=sk-your-key
TG_BOT_TOKEN=your-telegram-bot-token
TG_CHAT_ID=your-telegram-chat-id
```

Edit `config.yaml` if needed (defaults should work for most setups):

```yaml
sync:
  scripts_dir: "/tmp/wechat-decrypt"   # where you cloned the decrypt scripts
  cron: "*/30 * * * *"                 # sync every 30 minutes

ai:
  provider: "openai"
  model: "gpt-4o"                      # or gpt-5.4, claude, etc.
```

### 4. Extract keys and sync (first time)

Make sure WeChat is running and logged in, then:

```bash
npm run sync
```

This will:
- Attach to WeChat via lldb and extract all DB encryption keys
- Decrypt the local WeChat SQLite databases
- Import group chat messages into the system DB

### 5. Start the Collector (auto sync + push)

```bash
npm run dev:collector
```

Runs a full sync on startup, then every 30 minutes. Automatically analyzes new messages against your keyword subscriptions and pushes reports.

### 6. Use as MCP Server

Add to your Claude Code `.mcp.json`:

```json
{
  "mcpServers": {
    "wechat-topic": {
      "command": "node",
      "args": ["dist/mcp/index.js"],
      "cwd": "/path/to/wechat-topic-mcp",
      "env": {
        "OPENAI_API_KEY": "your-key",
        "TG_BOT_TOKEN": "your-token",
        "TG_CHAT_ID": "your-chat-id"
      }
    }
  }
}
```

Build first: `npm run build`

## MCP Tools

| Tool | Description |
|------|-------------|
| `query_topic` | Analyze a keyword across group chats, returns AI-generated report |
| `list_groups` | List all monitored WeChat groups |
| `get_group_activity` | Activity stats for a group (messages, top users) |
| `add_subscription` | Subscribe to a keyword for auto push notifications |
| `update_subscription` | Modify an existing subscription |
| `remove_subscription` | Delete a subscription |
| `list_subscriptions` | List all active subscriptions |
| `get_report` | Retrieve a specific analysis report |
| `list_reports` | Browse historical reports |

### Example Usage in Claude

```
> Help me summarize what people are saying about "滑雪" in my WeChat groups

> Subscribe to keyword "AI Agent" and push to Telegram whenever there's discussion

> Which group has been most active this week?
```

## Analysis Output

Each report includes:

- **Summary** — 3-5 sentence overview of the discussion
- **Key Opinions** — Who said what, with stance (positive/neutral/negative)
- **Sentiment** — Percentage breakdown (positive/neutral/negative)
- **Disputes** — Identified disagreements between participants
- **Trends** — Message count, participant count, density, duration

## Project Structure

```
src/
├── collector/           # Sync pipeline + auto analysis
│   ├── index.ts         # Entry point (cron scheduler)
│   ├── sync.ts          # Key extraction → decrypt → import
│   ├── monitor.ts       # Keyword monitoring & threshold triggers
│   └── notifier/        # Telegram & Slack push
├── shared/              # Shared modules
│   ├── ai/              # AI provider (OpenAI/Claude/Ollama)
│   ├── analyzer/        # Message segmentation & report building
│   ├── db/              # SQLite schema & queries
│   ├── config.ts        # YAML config with env var interpolation
│   └── types.ts         # TypeScript interfaces
└── mcp/                 # MCP Server
    ├── index.ts          # Server entry point
    └── tools/            # 9 MCP tool implementations
```

## WeChat Database Decryption

Mac WeChat 4.x stores all messages in **SQLCipher 4.0 encrypted** SQLite databases under:

```
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<wxid>/db_storage/
```

The databases include `message_0.db` (messages), `contact.db` (contacts), `session.db` (sessions), and more — all encrypted with a 32-byte key unique to each database.

### How Decryption Works

**Step 1: Extract encryption keys from memory**

WeChat keeps the raw encryption keys in process memory while running. We use **lldb** (Apple's debugger) to attach to the WeChat process and scan its memory for the key pattern `x'<64-hex-key><32-hex-salt>'`. Each key is verified against its database's HMAC-SHA512 signature to confirm correctness.

This step requires **SIP (System Integrity Protection) disabled** because macOS blocks debugger attachment to other processes when SIP is enabled.

```bash
# The script scans ~2.4GB of WeChat's memory and typically finds all 17 keys in under 60 seconds
PYTHONPATH=$(/usr/bin/lldb -P) python3 find_key_memscan.py
```

Output: `wechat_keys.json` mapping each database file to its hex key.

**Step 2: Decrypt databases with sqlcipher**

Using the extracted keys, each database is decrypted via `sqlcipher` (open-source SQLite encryption extension):

```sql
PRAGMA key = "x'<hex_key>'";
PRAGMA cipher_compatibility = 4;
SELECT sqlcipher_export('plaintext');
```

```bash
python3 decrypt_db.py
```

Output: Decrypted, standard SQLite databases in `data/decrypted/`.

**Step 3: Parse and import messages**

WeChat's message table naming uses MD5 hashes of the chat username:
- `Name2Id` table maps `wxid/chatroom_id` → internal ID
- Message table name = `Msg_` + `MD5(username)`
- Group messages format: `sender_wxid:\nmessage_content`
- XML messages (`<msg>`, `<?xml`) are system messages and skipped

The sync module reads decrypted DBs, resolves sender names from the contact database, and imports text messages into our system with deduplication.

### Tools Used

| Tool | Purpose | Source |
|------|---------|--------|
| **lldb** | Attach to WeChat process, scan memory for encryption keys | Built into macOS (Xcode Command Line Tools) |
| **sqlcipher** | Decrypt SQLCipher 4.0 encrypted SQLite databases | `brew install sqlcipher` |
| **wechat-db-decrypt-macos** | Python scripts for key extraction and database decryption | [Thearas/wechat-db-decrypt-macos](https://github.com/Thearas/wechat-db-decrypt-macos) |
| **better-sqlite3** | Read decrypted SQLite databases from Node.js | npm dependency |

### Database Structure (Decrypted)

```
db_storage/
├── message/
│   ├── message_0.db          # Chat messages (main)
│   ├── message_fts.db        # Full-text search index
│   ├── media_0.db            # Media metadata
│   └── biz_message_0.db      # Official account messages
├── contact/
│   ├── contact.db            # Contact list (nick_name, remark, etc.)
│   └── contact_fts.db        # Contact search index
├── session/
│   └── session.db            # Chat sessions (last message, timestamp)
├── favorite/
│   └── favorite.db           # Saved messages
├── sns/
│   └── sns.db                # Moments (朋友圈)
└── ...                        # emoticon, head_image, etc.
```

### Key Tables

**message_0.db** — `Msg_<md5hash>` tables:
| Column | Description |
|--------|-------------|
| `local_id` | Auto-increment primary key |
| `server_id` | WeChat server message ID |
| `create_time` | Unix timestamp |
| `message_content` | Text content (group: `sender:\ncontent`) |
| `local_type` | 1=text, 3=image, 34=voice, 49=link |

**contact.db** — `contact` table:
| Column | Description |
|--------|-------------|
| `username` | WeChat ID (wxid_xxx or phone) |
| `nick_name` | Display name |
| `remark` | User-set remark name |
| `alias` | WeChat alias |

**session.db** — `SessionTable`:
| Column | Description |
|--------|-------------|
| `username` | Chat ID (wxid or xxx@chatroom) |
| `summary` | Last message preview |
| `last_timestamp` | Last activity time |

### Security Notes

- Encryption keys are **only accessible while WeChat is running** — they exist in process memory, not on disk
- SIP must be disabled for key extraction but can be **re-enabled immediately after**
- Keys may change when WeChat updates or you re-login on a new device
- All decrypted data stays local — nothing is uploaded except through your configured notification channels

## Re-extracting Keys

If WeChat updates or you re-login, you'll need to extract keys again (requires SIP disabled):

```bash
# Disable SIP: restart → hold power → Recovery → Terminal → csrutil disable
npm run sync
# Re-enable SIP after: csrutil enable
```

## License

MIT
