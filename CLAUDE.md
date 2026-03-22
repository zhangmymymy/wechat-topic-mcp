# AI Setup Guide

This file tells Claude Code (or any AI assistant) how to set up this project. Follow these steps exactly — do NOT attempt alternative approaches for key extraction.

## Setup (run in order)

```bash
# 1. Install dependencies
brew install sqlcipher
pip3 install frida-tools   # use a venv if system python blocks: python3 -m venv .venv && source .venv/bin/activate && pip install frida-tools
npm install

# 2. Extract WeChat DB encryption keys (WeChat must be running and logged in, SIP must be disabled)
python3 scripts/extract_keys.py

# 3. Decrypt all databases
python3 scripts/decrypt_dbs.py

# 4. Build and import messages into system DB
npm run build
npm run sync
```

After this, the MCP server works. Messages are in `data/wechat.db` (plain SQLite), queryable via MCP tools or direct SQL.

## Key extraction: ONLY use Frida + CCKeyDerivationPBKDF

The script `scripts/extract_keys.py` is the only working method. It hooks macOS CommonCrypto's `CCKeyDerivationPBKDF` via Frida to capture keys during WeChat startup.

Do NOT attempt these — they have all been tested and confirmed broken:
- lldb breakpoints on sqlite3_key (WeChat uses statically-linked SQLCipher, never calls system lib)
- DYLD_INSERT_LIBRARIES interpose (internal symbols can't be interposed)
- Memory pattern scanning for x'hex' strings (format varies across versions)
- pywxdump (Windows only)
- wechat-db-decrypt-macos / wechat-decipher-macos (DMCA'd by Tencent)
- task_for_pid memory scanner (requires root)

## Querying data

The MCP `query_topic` tool requires an AI provider configured in `config.yaml` and `.env`. But Claude Code can skip that and query `data/wechat.db` directly:

```sql
-- Search messages by keyword
SELECT g.name, m.sender_name, m.content, m.timestamp
FROM messages m JOIN groups g ON m.group_id = g.id
WHERE m.content LIKE '%keyword%'
ORDER BY m.timestamp DESC;
```

## Re-sync

After WeChat updates or re-login, keys change. Re-run:

```bash
python3 scripts/extract_keys.py
python3 scripts/decrypt_dbs.py
npm run sync
```
