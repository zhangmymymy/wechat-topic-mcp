// src/collector/notifier/telegram.ts
import { Bot } from "grammy";
import type { Notifier, Report } from "../../shared/types.js";
import { formatReportText } from "./formatter.js";

export class TelegramNotifier implements Notifier {
  private bot: Bot;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
  }

  async send(report: Report, groupName: string): Promise<void> {
    const text = formatReportText(report, groupName);

    // Telegram has a 4096 char limit per message
    if (text.length <= 4096) {
      await this.bot.api.sendMessage(this.chatId, text);
    } else {
      // Split into chunks
      const chunks = splitText(text, 4096);
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(this.chatId, chunk);
      }
    }
  }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx === -1) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
