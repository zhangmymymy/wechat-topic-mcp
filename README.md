# WeChat Topic MCP

Let Claude Code directly read and analyze your WeChat group chat messages via MCP (Model Context Protocol).

## How It Works

```
WeChat (running on Mac)
  → Frida hooks CCKeyDerivationPBKDF during startup
  → captures PBKDF2-derived encryption keys for every database
  → sqlcipher decrypts local SQLite DBs to plaintext
  → messages imported into a system SQLite DB
  → Claude Code queries and analyzes via MCP tools
```

WeChat macOS 4.x encrypts all local databases with **SQLCipher 4** (AES-256-CBC, HMAC-SHA512, PBKDF2 with 256,000 iterations). Each database has a unique 32-byte encryption key derived from a shared master password and a per-database salt.

The encryption library is **statically linked into the WeChat binary with all symbols stripped**, which means you cannot hook `sqlite3_key` via lldb, DYLD_INSERT_LIBRARIES, or Frida symbol lookup. However, the PBKDF2 key derivation ultimately calls macOS's `CCKeyDerivationPBKDF` from `libcommonCrypto.dylib` — a system export that Frida can always hook. This is the only reliable extraction method.

### Key Derivation Structure

```
Master password (32 bytes, shared across all DBs)
  + salt (first 16 bytes of each .db file, unique per DB)
  + 256,000 rounds PBKDF2-HMAC-SHA512
  = enc_key (32 bytes)  ← decrypts the database

enc_key
  + hmac_salt (from page content)
  + 2 rounds PBKDF2-HMAC-SHA512
  = hmac_key (32 bytes)  ← verifies page integrity
```

### Extraction Flow

1. Frida spawns WeChat as a child process with hooks installed **before** any database opens
2. WeChat starts up, opens all encrypted databases, triggering PBKDF2 calls
3. The hook captures every call's `salt` (16 bytes) and `derivedKey` (32 bytes)
4. Keys with `rounds=256000` are encryption keys; `rounds=2` are HMAC keys
5. Each salt is matched to a `.db` file by comparing against the file's first 16 bytes
6. Output: `data/wechat_keys.json` mapping each database path to its hex key

### What Doesn't Work (verified)

| Approach | Why it fails |
|----------|-------------|
| lldb breakpoint on system `sqlite3_key` | WeChat uses its own statically-linked SQLCipher, never calls the system library |
| DYLD_INSERT_LIBRARIES interpose | Internal symbols can't be interposed |
| Frida scan for `sqlite3_key` assembly pattern | Compiler optimizations produce unpredictable instruction sequences |
| Memory scan for `x'<hex>'` key strings | Format varies across WeChat versions |
| `task_for_pid` memory scanner | Requires root privileges |
| pywxdump | Windows only |
| wechat-db-decrypt-macos (Thearas) | DMCA'd by Tencent (Jan 2026) |

## Prerequisites

- **macOS** (Apple Silicon) with WeChat desktop installed and logged in
- **SIP disabled** — required for Frida to attach to the WeChat process
- **sqlcipher** — `brew install sqlcipher`
- **Python 3 + Frida** — `pip3 install frida-tools` (use a venv if system Python blocks installation)
- **Node.js** >= 18

## Step-by-Step Setup

### 1. Disable SIP

Restart your Mac → Hold power button → Enter Recovery Mode → Open Terminal:

```bash
csrutil disable
```

Reboot back to macOS. You can re-enable SIP after extracting keys.

### 2. Clone and install

```bash
git clone https://github.com/zhangmymymy/wechat-topic-mcp.git
cd wechat-topic-mcp
npm install
```

### 3. Install Python dependencies

```bash
pip3 install frida-tools
```

If your system Python blocks global installs, use a venv:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install frida-tools
```

### 4. Extract encryption keys

Make sure **WeChat is running and logged in**, then:

```bash
python3 scripts/extract_keys.py
```

This kills WeChat, re-launches it under Frida with the `CCKeyDerivationPBKDF` hook, captures all keys during startup, matches them to database files, and saves the result to `data/wechat_keys.json`.

Expected output:

```
[*] Found 18 encrypted databases
[*] Spawning WeChat with Frida hooks...
[*] Resuming WeChat (waiting for DB opens)...
  [+] Key captured: contact/contact.db
  [+] Key captured: message/message_0.db
  ...
[*] All 18 keys captured!
[*] Saved 18 keys to data/wechat_keys.json
```

### 5. Decrypt databases

```bash
python3 scripts/decrypt_dbs.py
```

This reads `data/wechat_keys.json`, decrypts each database using sqlcipher, and writes plaintext SQLite files to `data/decrypted/`.

Expected output:

```
[*] Decrypting 18 databases...
  contact/contact.db... OK (6.9 MB)
  message/message_0.db... OK (16.5 MB)
  message/message_1.db... OK (265.0 MB)
  ...
[*] Done: 18 decrypted, 0 failed
```

### 6. Build and import messages

```bash
npm run build
npm run sync
```

This reads the decrypted databases, resolves sender names from the contact DB, and imports all group chat text messages into `data/wechat.db` with deduplication.

Expected output:

```
[Sync] Loaded 11720 contacts
[Sync] Found 44 group chats
[Sync] Mapped 21 chats to message tables
[Sync]   GoRich100X小分队: 4375 messages imported
  ...
[Sync] Import complete: 22489 messages, 14 new groups
```

### 7. Configure MCP

Add to your `~/.mcp.json`:

```json
{
  "mcpServers": {
    "wechat-topic": {
      "command": "node",
      "args": ["dist/mcp/index.js"],
      "cwd": "/path/to/wechat-topic-mcp",
      "env": {
        "CONFIG_PATH": "/path/to/wechat-topic-mcp/config.yaml"
      }
    }
  }
}
```

Replace `/path/to/wechat-topic-mcp` with the actual path where you cloned the repo.

### 8. Use in Claude Code

```
> What are people saying about "AI Agent" in my WeChat groups?
> Summarize discussions about Matrixport
> Which group has been most active this week?
```

Claude Code reads raw messages from the system DB via MCP tools and analyzes them directly.

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_groups` | List all monitored WeChat groups |
| `get_group_activity` | Activity stats for a group (message count, top users) |
| `query_topic` | Analyze a keyword across group chats (requires AI provider in config) |
| `add_subscription` | Subscribe to a keyword for auto push notifications |
| `update_subscription` | Modify an existing subscription |
| `remove_subscription` | Delete a subscription |
| `list_subscriptions` | List all active subscriptions |
| `get_report` | Retrieve a specific analysis report |
| `list_reports` | Browse historical reports |

## Configuration

Copy and edit the environment file:

```bash
cp .env.example .env
```

Edit `.env` with your keys (all optional — Claude Code can query data without any AI provider):

```
OPENAI_API_KEY=sk-your-key          # for query_topic AI analysis
TG_BOT_TOKEN=your-telegram-token     # for Telegram push
TG_CHAT_ID=your-chat-id
```

Edit `config.yaml` to customize sync schedule, AI model, notification channels, etc.

## Database Structure

WeChat stores encrypted databases at:

```
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<wxid>/db_storage/
├── message/message_0.db       # Chat messages (main)
├── message/message_1.db       # Chat messages (overflow)
├── contact/contact.db         # Contact list
├── session/session.db         # Chat sessions
├── favorite/favorite.db       # Saved messages
├── sns/sns.db                 # Moments
└── ...                        # emoticon, head_image, etc.
```

### Message Tables

- `Name2Id` maps `wxid/chatroom_id` → internal ID
- Message table name = `Msg_` + `MD5(username)`
- Group message format: `sender_wxid:\nmessage_content`
- `local_type`: 1=text, 3=image, 34=voice, 49=link
- XML messages (`<msg>`, `<?xml`) are system messages — skipped during import

## Re-extracting Keys

Keys change when WeChat updates or you re-login on a new device. Re-run:

```bash
python3 scripts/extract_keys.py
python3 scripts/decrypt_dbs.py
npm run sync
```

SIP must be disabled for key extraction. You can re-enable it afterward:

```bash
# In Recovery Mode terminal:
csrutil enable
```

## Security Notes

- Encryption keys only exist in WeChat's process memory while it's running — not stored on disk
- SIP can be re-enabled immediately after key extraction
- All decrypted data stays local — nothing is uploaded unless you configure notification channels
- Keys are saved to `data/wechat_keys.json` for subsequent syncs without re-extraction

## Project Structure

```
scripts/
├── extract_keys.py      # Frida-based key extraction
└── decrypt_dbs.py       # sqlcipher batch decryption
src/
├── collector/           # Sync pipeline + scheduled analysis
│   ├── sync.ts          # Key extraction → decrypt → import
│   └── monitor.ts       # Keyword monitoring & triggers
├── shared/
│   ├── ai/              # AI provider (OpenAI/Claude/Ollama)
│   ├── db/              # SQLite schema & queries
│   └── config.ts        # YAML config with env var interpolation
└── mcp/
    ├── index.ts          # MCP server entry point
    └── tools/            # 9 MCP tool implementations
```

## License

MIT
