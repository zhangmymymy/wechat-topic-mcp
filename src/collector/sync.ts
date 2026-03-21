// src/collector/sync.ts
/**
 * WeChat local database sync pipeline.
 * Replaces the GeweChat webhook-based collector with a three-step process:
 *   1. Extract encryption keys from running WeChat via lldb memory scan
 *   2. Decrypt WeChat SQLite databases using extracted keys
 *   3. Import decrypted messages into our system database
 */
import { execFileSync } from "child_process";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import type { AppConfig } from "../shared/types.js";

export interface SyncResult {
  newMessages: number;
  newGroups: number;
  lastTimestamp: string | null;
}

const STATE_FILE_NAME = "sync_state.json";

interface SyncState {
  lastSyncTimestamp: string | null;
}

function loadSyncState(dataDir: string): SyncState {
  const statePath = resolve(dataDir, STATE_FILE_NAME);
  if (existsSync(statePath)) {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  }
  return { lastSyncTimestamp: null };
}

function saveSyncState(dataDir: string, state: SyncState): void {
  const statePath = resolve(dataDir, STATE_FILE_NAME);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ── Step 1: Extract encryption keys ──

function extractKeys(config: AppConfig["sync"]): void {
  const scriptPath = process.env.KEY_EXTRACT_SCRIPT ?? resolve(config.scripts_dir, "find_key_memscan.py");

  if (!existsSync(scriptPath)) {
    console.log("[Sync] Key extraction script not found, skipping key extraction step");
    console.log(`[Sync] Expected at: ${scriptPath}`);
    console.log("[Sync] Will try to use existing keys file if available");
    return;
  }

  console.log("[Sync] Extracting encryption keys from WeChat process...");

  try {
    const pythonPath = "/Library/Developer/CommandLineTools/usr/bin/python3";
    const lldbPythonPath = execFileSync("/usr/bin/lldb", ["-P"], {
      encoding: "utf-8",
    }).trim();

    const keysDir = resolve(config.keys_file, "..");
    mkdirSync(keysDir, { recursive: true });

    execFileSync(pythonPath, [scriptPath], {
      encoding: "utf-8",
      cwd: config.scripts_dir,
      env: {
        ...process.env,
        PYTHONPATH: lldbPythonPath,
        WECHAT_KEYS_OUTPUT: config.keys_file,
      },
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    console.log("[Sync] Keys extracted successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Sync] Key extraction failed:", message);
    console.log("[Sync] Will try to use existing keys file if available");
  }
}

// ── Step 2: Decrypt databases ──

function decryptDatabases(config: AppConfig["sync"]): void {
  const scriptPath = process.env.DECRYPT_SCRIPT ?? resolve(config.scripts_dir, "decrypt_db.py");

  if (!existsSync(scriptPath)) {
    console.log("[Sync] Decrypt script not found, skipping decryption step");
    console.log(`[Sync] Expected at: ${scriptPath}`);
    console.log("[Sync] Will try to use existing decrypted databases if available");
    return;
  }

  if (!existsSync(config.keys_file)) {
    console.log("[Sync] Keys file not found, skipping decryption step");
    return;
  }

  console.log("[Sync] Decrypting WeChat databases...");

  try {
    const pythonPath = "/Library/Developer/CommandLineTools/usr/bin/python3";

    mkdirSync(config.decrypt_output_dir, { recursive: true });

    execFileSync(pythonPath, [scriptPath], {
      encoding: "utf-8",
      cwd: config.scripts_dir,
      env: {
        ...process.env,
        WECHAT_DATA_DIR: config.wechat_data_dir,
        WECHAT_KEYS_FILE: config.keys_file,
        DECRYPT_OUTPUT_DIR: config.decrypt_output_dir,
      },
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    console.log("[Sync] Databases decrypted successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Sync] Decryption failed:", message);
    console.log("[Sync] Will try to use existing decrypted databases if available");
  }
}

// ── Step 3: Import messages ──

function importMessages(
  db: Database.Database,
  config: AppConfig["sync"],
): SyncResult {
  const decryptedDir = config.decrypt_output_dir;
  const msgDbPath = resolve(decryptedDir, "message", "message_0.db");
  const contactDbPath = resolve(decryptedDir, "contact", "contact.db");
  const sessionDbPath = resolve(decryptedDir, "session", "session.db");

  // Verify decrypted databases exist
  if (!existsSync(msgDbPath)) {
    console.log(`[Sync] Decrypted message DB not found at: ${msgDbPath}`);
    return { newMessages: 0, newGroups: 0, lastTimestamp: null };
  }
  if (!existsSync(contactDbPath)) {
    console.log(`[Sync] Decrypted contact DB not found at: ${contactDbPath}`);
    return { newMessages: 0, newGroups: 0, lastTimestamp: null };
  }
  if (!existsSync(sessionDbPath)) {
    console.log(`[Sync] Decrypted session DB not found at: ${sessionDbPath}`);
    return { newMessages: 0, newGroups: 0, lastTimestamp: null };
  }

  // Load sync state to determine what's new
  const dataDir = resolve(decryptedDir, "..");
  const state = loadSyncState(dataDir);
  const sinceTimestamp = state.lastSyncTimestamp;

  console.log(
    sinceTimestamp
      ? `[Sync] Importing messages newer than ${sinceTimestamp}`
      : "[Sync] Full import (no previous sync state)",
  );

  // Open decrypted DBs (read-only)
  const msgDb = new Database(msgDbPath, { readonly: true });
  const contactDb = new Database(contactDbPath, { readonly: true });
  const sessionDb = new Database(sessionDbPath, { readonly: true });

  try {
    // 1. Build contact name map: wxid -> display name
    const contacts: Record<string, string> = {};
    const contactRows = contactDb
      .prepare(
        "SELECT username, nick_name, remark FROM contact WHERE nick_name IS NOT NULL",
      )
      .all() as { username: string; nick_name: string; remark: string }[];
    for (const row of contactRows) {
      contacts[row.username] = row.remark || row.nick_name;
    }
    console.log(`[Sync] Loaded ${Object.keys(contacts).length} contacts`);

    // 2. Find chatroom sessions
    const chatrooms = sessionDb
      .prepare(
        "SELECT username, summary, last_timestamp FROM SessionTable WHERE username LIKE '%@chatroom%' ORDER BY last_timestamp DESC",
      )
      .all() as {
      username: string;
      summary: string;
      last_timestamp: number;
    }[];
    console.log(`[Sync] Found ${chatrooms.length} group chats`);

    // 3. Map chatroom usernames to Msg_ tables via MD5 hash
    const name2idRows = msgDb
      .prepare("SELECT rowid, user_name FROM Name2Id")
      .all() as { rowid: number; user_name: string }[];

    const msgTables = msgDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'",
      )
      .all() as { name: string }[];

    const usernameToTable: Record<string, string> = {};
    for (const n2i of name2idRows) {
      const hash = createHash("md5").update(n2i.user_name).digest("hex");
      const tableName = `Msg_${hash}`;
      const exists = msgTables.find((t) => t.name === tableName);
      if (exists) {
        usernameToTable[n2i.user_name] = tableName;
      }
    }
    console.log(
      `[Sync] Mapped ${Object.keys(usernameToTable).length} chats to message tables`,
    );

    // 4. Import group chat messages
    const insertGroup = db.prepare(
      "INSERT OR IGNORE INTO groups (id, name, member_count, created_at, updated_at) VALUES (?, ?, 0, datetime('now'), datetime('now'))",
    );
    const updateGroup = db.prepare(
      "UPDATE groups SET name = ?, updated_at = datetime('now') WHERE id = ?",
    );
    const insertMsg = db.prepare(
      "INSERT OR IGNORE INTO messages (id, group_id, sender_id, sender_name, content, msg_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    let totalMessages = 0;
    let totalNewGroups = 0;
    let latestTimestamp: string | null = null;

    // Convert sinceTimestamp to unix epoch for comparison
    const sinceEpoch = sinceTimestamp
      ? Math.floor(new Date(sinceTimestamp).getTime() / 1000)
      : 0;

    const importTransaction = db.transaction(() => {
      for (const room of chatrooms) {
        const roomId = room.username;
        const roomName = contacts[roomId] || roomId;
        const tableName = usernameToTable[roomId];

        if (!tableName) continue;

        // Upsert group
        const existingGroup = db
          .prepare("SELECT id FROM groups WHERE id = ?")
          .get(roomId);
        if (!existingGroup) {
          insertGroup.run(roomId, roomName);
          totalNewGroups++;
        } else {
          updateGroup.run(roomName, roomId);
        }

        // Build query with optional time filter
        const timeFilter =
          sinceEpoch > 0 ? `AND create_time > ${sinceEpoch}` : "";
        const messages = msgDb
          .prepare(
            `SELECT local_id, server_id, create_time, message_content, local_type, real_sender_id
             FROM ${tableName}
             WHERE message_content IS NOT NULL AND message_content != '' AND local_type = 1
             ${timeFilter}
             ORDER BY create_time ASC`,
          )
          .all() as {
          local_id: number;
          server_id: number;
          create_time: number;
          message_content: string;
          local_type: number;
          real_sender_id: number;
        }[];

        let roomMsgCount = 0;
        for (const msg of messages) {
          // Group messages format: "sender_wxid:\nmessage_content"
          let senderId = "";
          let content = String(msg.message_content);

          const colonNewline = content.indexOf(":\n");
          if (colonNewline > 0 && colonNewline < 60) {
            senderId = content.substring(0, colonNewline);
            content = content.substring(colonNewline + 2);
          }

          // Skip system messages, XML content, empty content
          if (
            !content ||
            content.startsWith("<msg>") ||
            content.startsWith("<?xml")
          ) {
            continue;
          }

          const senderName = contacts[senderId] || senderId;
          const timestamp = new Date(msg.create_time * 1000)
            .toISOString()
            .replace("T", " ")
            .substring(0, 19);
          const msgId = `wechat_${roomId}_${msg.local_id}`;

          insertMsg.run(
            msgId,
            roomId,
            senderId,
            senderName,
            content,
            "text",
            timestamp,
          );
          roomMsgCount++;

          // Track latest timestamp
          if (!latestTimestamp || timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
          }
        }

        if (roomMsgCount > 0) {
          console.log(
            `[Sync]   ${roomName}: ${roomMsgCount} messages imported`,
          );
          totalMessages += roomMsgCount;
        }
      }
    });

    importTransaction();

    // Update sync state
    if (latestTimestamp) {
      saveSyncState(dataDir, { lastSyncTimestamp: latestTimestamp });
    }

    console.log(
      `[Sync] Import complete: ${totalMessages} messages, ${totalNewGroups} new groups`,
    );

    return {
      newMessages: totalMessages,
      newGroups: totalNewGroups,
      lastTimestamp: latestTimestamp,
    };
  } finally {
    msgDb.close();
    contactDb.close();
    sessionDb.close();
  }
}

// ── Public API ──

/**
 * Run the full WeChat sync pipeline:
 * 1. Extract encryption keys (requires running WeChat + lldb)
 * 2. Decrypt WeChat databases
 * 3. Import new messages into our system database
 */
export function syncWeChat(
  db: Database.Database,
  config: AppConfig,
): SyncResult {
  const syncConfig = config.sync;

  console.log("[Sync] Starting WeChat sync pipeline...");

  // Step 1: Extract keys
  extractKeys(syncConfig);

  // Step 2: Decrypt databases
  decryptDatabases(syncConfig);

  // Step 3: Import messages
  const result = importMessages(db, syncConfig);

  console.log("[Sync] Pipeline complete");
  return result;
}

/**
 * Run only the import step (useful when databases are already decrypted).
 */
export function importOnly(
  db: Database.Database,
  config: AppConfig,
): SyncResult {
  return importMessages(db, config.sync);
}

// ── CLI entry point for manual one-off sync ──

if (
  process.argv[1] &&
  (process.argv[1].endsWith("sync.ts") || process.argv[1].endsWith("sync.js"))
) {
  const { loadConfig } = await import("../shared/config.js");
  const { createDatabase } = await import("../shared/db/index.js");
  const { initSchema } = await import("../shared/db/schema.js");
  const { default: dotenv } = await import("dotenv");
  dotenv.config();

  const configPath = resolve(process.env.CONFIG_PATH ?? "config.yaml");
  const config = loadConfig(configPath);
  const db = createDatabase(resolve(config.database.path));
  initSchema(db);

  const result = syncWeChat(db, config);
  console.log("[Sync] Result:", JSON.stringify(result, null, 2));

  db.close();
}
