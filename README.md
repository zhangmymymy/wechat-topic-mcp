# WeChat Topic MCP

Let Claude Code directly read and analyze your WeChat group chat messages via MCP (Model Context Protocol).

## Two Data Sources

### 1. iLink Bot API (Primary — Real-time)

Tencent's official WeChat Bot API. Receives new messages in real-time via HTTP long-polling. No local WeChat client required, works on any platform.

```
Phone scans QR code → iLink API authenticated
  → Collector long-polls for new messages
  → Messages stored in SQLite
  → Claude Code queries via MCP
```

### 2. Local DB Decryption (Secondary — Historical)

Reads WeChat's encrypted local databases on macOS. Useful for importing full chat history.

```
WeChat (running on Mac)
  → Frida hooks CCKeyDerivationPBKDF during startup
  → captures PBKDF2-derived encryption keys
  → sqlcipher decrypts local SQLite DBs
  → messages imported into system DB
```

WeChat macOS 4.x encrypts all local databases with **SQLCipher 4** (AES-256-CBC, HMAC-SHA512, PBKDF2 with 256,000 iterations). The encryption library is statically linked with all symbols stripped. The PBKDF2 key derivation calls macOS's `CCKeyDerivationPBKDF` from `libcommonCrypto.dylib` — a system export that Frida can always hook.

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

### What Doesn't Work for Key Extraction (verified)

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

- **Node.js** >= 18

For iLink Bot API (real-time):
- A phone with WeChat to scan the QR code

For local DB decryption (historical import):
- **macOS** (Apple Silicon) with WeChat desktop installed and logged in
- **SIP disabled** — required for Frida to attach to the WeChat process
- **sqlcipher** — `brew install sqlcipher`
- **Python 3 + Frida** — `pip3 install frida-tools`

## Quick Start (iLink Bot API)

```bash
git clone https://github.com/zhangmymymy/wechat-topic-mcp.git
cd wechat-topic-mcp
npm install
cp .env.example .env   # edit with your API keys
npm run build
```

Configure MCP in Claude Code (`~/.mcp.json`):

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

Then in Claude Code:

```
> Connect to my WeChat          → triggers connect_wechat (scan QR code)
> Start the collector            → npm run dev:collector
> What are people discussing about AI Agent?
```

## Historical Import (Local DB Decryption)

### 1. Disable SIP

Restart Mac → Hold power button → Recovery Mode → Terminal:

```bash
csrutil disable
```

Reboot. You can re-enable SIP after extracting keys.

### 2. Install Python dependencies

```bash
pip3 install frida-tools
```

### 3. Extract encryption keys

WeChat must be running and logged in:

```bash
python3 scripts/extract_keys.py
```

### 4. Decrypt databases

```bash
python3 scripts/decrypt_dbs.py
```

### 5. Import messages

```bash
npm run sync
```

Or use the `sync_history` MCP tool from Claude Code.

## MCP Tools

| Tool | Description |
|------|-------------|
| `connect_wechat` | Connect to WeChat via QR code (iLink Bot API) |
| `disconnect_wechat` | Remove stored WeChat credentials |
| `connection_status` | Check WeChat connection status |
| `sync_history` | Import historical messages from local encrypted DBs |
| `list_groups` | List all monitored WeChat groups |
| `get_group_activity` | Activity stats for a group |
| `query_topic` | Analyze a keyword across group chats (requires AI provider) |
| `add_subscription` | Subscribe to a keyword for auto push notifications |
| `update_subscription` | Modify an existing subscription |
| `remove_subscription` | Delete a subscription |
| `list_subscriptions` | List all active subscriptions |
| `get_report` | Retrieve a specific analysis report |
| `list_reports` | Browse historical reports |

## Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```
OPENAI_API_KEY=sk-your-key          # for AI analysis
TG_BOT_TOKEN=your-telegram-token     # for Telegram push
TG_CHAT_ID=your-chat-id
```

Edit `config.yaml` for sync schedule, AI model, notification channels, etc.

## Database Structure

WeChat stores encrypted databases at:

```
~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/<wxid>/db_storage/
├── message/message_0.db       # Chat messages (main)
├── message/message_1.db       # Chat messages (overflow)
├── contact/contact.db         # Contact list
├── session/session.db         # Chat sessions
└── ...
```

### Message Tables

- `Name2Id` maps `wxid/chatroom_id` → internal ID
- Message table name = `Msg_` + `MD5(username)`
- Group message format: `sender_wxid:\nmessage_content`
- `local_type`: 1=text, 3=image, 34=voice, 49=link
- XML messages (`<msg>`, `<?xml`) are system messages — skipped during import

## Project Structure

```
scripts/
├── extract_keys.py      # Frida-based key extraction
└── decrypt_dbs.py       # sqlcipher batch decryption
src/
├── collector/           # Data collection + scheduled analysis
│   ├── ilink.ts         # iLink Bot API client (real-time)
│   ├── sync.ts          # Local DB decrypt + import (historical)
│   └── monitor.ts       # Keyword monitoring & triggers
├── shared/
│   ├── ai/              # AI provider (OpenAI/Claude/Ollama)
│   ├── db/              # SQLite schema & queries
│   └── config.ts        # YAML config with env var interpolation
└── mcp/
    ├── index.ts          # MCP server entry point
    └── tools/            # 13 MCP tool implementations
```

## Security Notes

- Encryption keys only exist in WeChat's process memory while it's running
- SIP can be re-enabled immediately after key extraction
- iLink Bot credentials are stored locally at `~/.wechat-topic/credentials.json`
- All data stays local unless you configure notification channels

## License

MIT
