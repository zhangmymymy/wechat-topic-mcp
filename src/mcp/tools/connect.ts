// src/mcp/tools/connect.ts
/**
 * MCP tools for WeChat connection management via iLink Bot API.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  isConnected,
  getLoginQRCode,
  pollQRCodeStatus,
} from "../../collector/ilink.js";

export function registerConnectTools(server: McpServer): void {
  // ── connect_wechat ──
  server.tool(
    "connect_wechat",
    "Connect to WeChat via QR code login (iLink Bot API). Returns a QR code URL — scan it with your phone's WeChat to authenticate.",
    {},
    async () => {
      if (isConnected()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Already connected to WeChat. Credentials found at ~/.wechat-topic/credentials.json. Use disconnect_wechat to reset.",
            },
          ],
        };
      }

      try {
        const { qrcode_token, qrcode_url } = await getLoginQRCode();

        // Poll for scan status (max 2 minutes)
        const maxAttempts = 24; // 24 * 5s = 2 minutes
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 5000));

          const result = await pollQRCodeStatus(qrcode_token);

          if (result.status === "confirmed") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `WeChat connected successfully! Bot ID: ${result.credentials.ilink_bot_id}. The Collector service will now receive real-time messages via long-polling.`,
                },
              ],
            };
          }

          if (result.status === "expired") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "QR code expired. Please run connect_wechat again.",
                },
              ],
            };
          }

          if (result.status === "scaned") {
            // Continue waiting for confirmation
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Timed out waiting for QR code scan. QR code URL: ${qrcode_url}\n\nPlease scan this QR code with WeChat and run connect_wechat again.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to connect: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── disconnect_wechat ──
  server.tool(
    "disconnect_wechat",
    "Disconnect from WeChat and remove stored credentials.",
    {},
    async () => {
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");
      const credFile = path.resolve(
        os.homedir(),
        ".wechat-topic",
        "credentials.json",
      );

      if (fs.existsSync(credFile)) {
        fs.unlinkSync(credFile);
        return {
          content: [
            {
              type: "text" as const,
              text: "Disconnected. Credentials removed. Run connect_wechat to reconnect.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: "Not connected. No credentials to remove.",
          },
        ],
      };
    },
  );

  // ── connection_status ──
  server.tool(
    "connection_status",
    "Check current WeChat connection status.",
    {},
    async () => {
      const connected = isConnected();
      return {
        content: [
          {
            type: "text" as const,
            text: connected
              ? "Connected to WeChat via iLink Bot API."
              : "Not connected. Run connect_wechat to authenticate.",
          },
        ],
      };
    },
  );
}
