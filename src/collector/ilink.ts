// src/collector/ilink.ts
/**
 * iLink Bot API client for WeChat message collection.
 * Uses Tencent's official iLink API (ilinkai.weixin.qq.com) to receive
 * WeChat messages in real-time via HTTP long-polling.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import Database from "better-sqlite3";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const CREDENTIALS_DIR = resolve(homedir(), ".wechat-topic");
const CREDENTIALS_FILE = resolve(CREDENTIALS_DIR, "credentials.json");
const POLL_TIMEOUT = 35; // seconds

// ── Types ──

export interface ILinkCredentials {
  bot_token: string;
  base_url: string;
  ilink_bot_id: string;
  ilink_user_id: string;
  created_at: string;
}

interface ILinkMessage {
  update_id: number;
  message?: {
    msg_id: string;
    from_user: string;
    from_user_name?: string;
    chat_id: string;
    chat_name?: string;
    msg_type: number; // 1=text, 2=image, 3=voice, 4=file, 5=video
    content: string;
    timestamp: number;
    is_group: boolean;
  };
}

// ── Credential Management ──

export function loadCredentials(): ILinkCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveCredentials(creds: ILinkCredentials): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
}

export function isConnected(): boolean {
  return loadCredentials() !== null;
}

// ── QR Code Login ──

export async function getLoginQRCode(): Promise<{
  qrcode_token: string;
  qrcode_url: string;
}> {
  const res = await fetch(
    `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
  );
  if (!res.ok) throw new Error(`QR code request failed: ${res.status}`);
  const data = (await res.json()) as {
    qrcode: string;
    qrcode_img_content: string;
  };
  return {
    qrcode_token: data.qrcode,
    qrcode_url: data.qrcode_img_content,
  };
}

export async function pollQRCodeStatus(
  token: string,
): Promise<
  | { status: "wait" | "scaned" | "expired" }
  | { status: "confirmed"; credentials: ILinkCredentials }
> {
  const res = await fetch(
    `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(token)}`,
  );
  if (!res.ok) throw new Error(`QR status request failed: ${res.status}`);

  const data = (await res.json()) as {
    status: string;
    bot_token?: string;
    baseurl?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
  };

  if (data.status === "confirmed" && data.bot_token) {
    const credentials: ILinkCredentials = {
      bot_token: data.bot_token,
      base_url: data.baseurl || DEFAULT_BASE_URL,
      ilink_bot_id: data.ilink_bot_id || "",
      ilink_user_id: data.ilink_user_id || "",
      created_at: new Date().toISOString(),
    };
    saveCredentials(credentials);
    return { status: "confirmed", credentials };
  }

  return { status: data.status as "wait" | "scaned" | "expired" };
}

// ── Message Long-Polling ──

export class ILinkPoller {
  private running = false;
  private lastUpdateId = 0;
  private credentials: ILinkCredentials;

  constructor(credentials: ILinkCredentials) {
    this.credentials = credentials;
  }

  private async fetchUpdates(): Promise<ILinkMessage[]> {
    const randomUin = Math.floor(Math.random() * 4294967295);
    const wechatUin = Buffer.from(String(randomUin)).toString("base64");

    const res = await fetch(
      `${this.credentials.base_url}/ilink/bot/getupdates`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.credentials.bot_token}`,
          AuthorizationType: "ilink_bot_token",
          "X-WECHAT-UIN": wechatUin,
        },
        body: JSON.stringify({
          offset: this.lastUpdateId + 1,
          timeout: POLL_TIMEOUT,
        }),
        signal: AbortSignal.timeout((POLL_TIMEOUT + 10) * 1000),
      },
    );

    if (!res.ok) {
      if (res.status === 401) throw new Error("AUTH_EXPIRED");
      throw new Error(`Poll failed: ${res.status}`);
    }

    const data = (await res.json()) as { result?: ILinkMessage[] };
    return data.result ?? [];
  }

  async start(
    db: Database.Database,
    onMessage?: (msg: ILinkMessage) => void,
  ): Promise<void> {
    this.running = true;
    console.log("[iLink] Long-polling started");

    const insertGroup = db.prepare(
      "INSERT OR IGNORE INTO groups (id, name, member_count, created_at, updated_at) VALUES (?, ?, 0, datetime('now'), datetime('now'))",
    );
    const updateGroup = db.prepare(
      "UPDATE groups SET name = ?, updated_at = datetime('now') WHERE id = ?",
    );
    const insertMsg = db.prepare(
      "INSERT OR IGNORE INTO messages (id, group_id, sender_id, sender_name, content, msg_type, timestamp, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'ilink')",
    );

    while (this.running) {
      try {
        const updates = await this.fetchUpdates();

        for (const update of updates) {
          if (update.update_id > this.lastUpdateId) {
            this.lastUpdateId = update.update_id;
          }

          if (!update.message) continue;
          const msg = update.message;

          // Only process group messages with text content
          if (!msg.is_group || msg.msg_type !== 1 || !msg.content) continue;

          // Upsert group
          const groupName = msg.chat_name || msg.chat_id;
          insertGroup.run(msg.chat_id, groupName);
          updateGroup.run(groupName, msg.chat_id);

          // Insert message
          const timestamp = new Date(msg.timestamp * 1000)
            .toISOString()
            .replace("T", " ")
            .substring(0, 19);

          const msgType =
            msg.msg_type === 1
              ? "text"
              : msg.msg_type === 2
                ? "image"
                : msg.msg_type === 3
                  ? "voice"
                  : "file";

          insertMsg.run(
            `ilink_${msg.msg_id}`,
            msg.chat_id,
            msg.from_user,
            msg.from_user_name || msg.from_user,
            msg.content,
            msgType,
            timestamp,
          );

          onMessage?.(update);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message === "AUTH_EXPIRED") {
          console.error(
            "[iLink] Authentication expired. Run connect_wechat to re-login.",
          );
          this.running = false;
          break;
        }

        console.error(`[iLink] Poll error: ${message}`);
        // Wait before retrying on error
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    console.log("[iLink] Long-polling stopped");
  }

  stop(): void {
    this.running = false;
  }
}
