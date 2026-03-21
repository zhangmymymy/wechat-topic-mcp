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

## Re-extracting Keys

If WeChat updates or you re-login, you'll need to extract keys again (requires SIP disabled):

```bash
# Disable SIP: restart → hold power → Recovery → Terminal → csrutil disable
npm run sync
# Re-enable SIP after: csrutil enable
```

## License

MIT
