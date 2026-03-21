#!/usr/bin/env npx tsx
/**
 * Import decrypted WeChat messages into our Collector database.
 * Reads from the decrypted SQLite DBs and inserts into our system.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { loadConfig } from "../src/shared/config.js";
import { createDatabase } from "../src/shared/db/index.js";
import { initSchema } from "../src/shared/db/schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DECRYPTED_DIR = "/tmp/wechat-decrypt/decrypted";
const MSG_DB = resolve(DECRYPTED_DIR, "message/message_0.db");
const CONTACT_DB = resolve(DECRYPTED_DIR, "contact/contact.db");
const SESSION_DB = resolve(DECRYPTED_DIR, "session/session.db");

function main() {
  // Open decrypted DBs (read-only)
  const msgDb = new Database(MSG_DB, { readonly: true });
  const contactDb = new Database(CONTACT_DB, { readonly: true });
  const sessionDb = new Database(SESSION_DB, { readonly: true });

  // Open our system DB
  const config = loadConfig(resolve(__dirname, "../config.yaml"));
  const db = createDatabase(resolve(__dirname, "..", config.database.path));
  initSchema(db);

  // 1. Build contact name map: wxid -> nick_name
  const contacts: Record<string, string> = {};
  const contactRows = contactDb.prepare(
    "SELECT username, nick_name, remark FROM contact WHERE nick_name IS NOT NULL"
  ).all() as { username: string; nick_name: string; remark: string }[];
  for (const row of contactRows) {
    contacts[row.username] = row.remark || row.nick_name;
  }
  console.log(`Loaded ${Object.keys(contacts).length} contacts`);

  // 2. Find chatroom sessions and their Name2Id mappings
  const chatrooms = sessionDb.prepare(
    "SELECT username, summary, last_timestamp FROM SessionTable WHERE username LIKE '%@chatroom%' ORDER BY last_timestamp DESC"
  ).all() as { username: string; summary: string; last_timestamp: number }[];
  console.log(`Found ${chatrooms.length} group chats`);

  // 3. Map Name2Id to find which Msg_ table belongs to which chat
  const name2idRows = msgDb.prepare("SELECT rowid, user_name FROM Name2Id").all() as {
    rowid: number;
    user_name: string;
  }[];

  // Get all Msg_ table names
  const msgTables = msgDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'")
    .all() as { name: string }[];

  // Build hash -> table name mapping
  // WeChat uses MD5 of the username to create table names
  const usernameToTable: Record<string, string> = {};

  for (const n2i of name2idRows) {
    const hash = createHash("md5").update(n2i.user_name).digest("hex");
    const tableName = `Msg_${hash}`;
    const exists = msgTables.find((t) => t.name === tableName);
    if (exists) {
      usernameToTable[n2i.user_name] = tableName;
    }
  }
  console.log(`Mapped ${Object.keys(usernameToTable).length} chats to message tables`);

  // 4. Import group chat messages
  const insertGroup = db.prepare(
    "INSERT OR IGNORE INTO groups (id, name, member_count, created_at, updated_at) VALUES (?, ?, 0, datetime('now'), datetime('now'))"
  );
  const insertMsg = db.prepare(
    "INSERT OR IGNORE INTO messages (id, group_id, sender_id, sender_name, content, msg_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  let totalMessages = 0;

  const importTransaction = db.transaction(() => {
    for (const room of chatrooms) {
      const roomId = room.username;
      const roomName = contacts[roomId] || roomId;
      const tableName = usernameToTable[roomId];

      if (!tableName) {
        console.log(`  Skip ${roomName}: no message table found`);
        continue;
      }

      // Insert group
      insertGroup.run(roomId, roomName);

      // Get messages - group messages have sender info in message_content like "wxid_xxx:\nmessage"
      const messages = msgDb
        .prepare(
          `SELECT local_id, server_id, create_time, message_content, local_type, real_sender_id
           FROM ${tableName}
           WHERE message_content IS NOT NULL AND message_content != '' AND local_type = 1
           ORDER BY create_time ASC`
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
        let content = typeof msg.message_content === "string"
          ? msg.message_content
          : Buffer.isBuffer(msg.message_content)
            ? msg.message_content.toString("utf-8")
            : String(msg.message_content);

        const colonNewline = content.indexOf(":\n");
        if (colonNewline > 0 && colonNewline < 60) {
          senderId = content.substring(0, colonNewline);
          content = content.substring(colonNewline + 2);
        }

        // Skip system messages, empty content
        if (!content || content.startsWith("<msg>") || content.startsWith("<?xml")) {
          continue;
        }

        const senderName = contacts[senderId] || senderId;
        const timestamp = new Date(msg.create_time * 1000).toISOString().replace("T", " ").substring(0, 19);
        const msgId = `wechat_${roomId}_${msg.local_id}`;

        insertMsg.run(msgId, roomId, senderId, senderName, content, "text", timestamp);
        roomMsgCount++;
      }

      if (roomMsgCount > 0) {
        console.log(`  ✅ ${roomName}: ${roomMsgCount} messages imported`);
        totalMessages += roomMsgCount;
      }
    }
  });

  importTransaction();

  console.log(`\nTotal: ${totalMessages} messages imported from ${chatrooms.length} groups`);

  msgDb.close();
  contactDb.close();
  sessionDb.close();
  db.close();
}

main();
