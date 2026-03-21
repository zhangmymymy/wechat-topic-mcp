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
