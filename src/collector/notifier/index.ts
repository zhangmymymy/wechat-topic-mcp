// src/collector/notifier/index.ts
import type { Notifier, AppConfig } from "../../shared/types.js";
import { TelegramNotifier } from "./telegram.js";
import { SlackNotifier } from "./slack.js";

export function createNotifiers(config: AppConfig["notify"]): Map<string, Notifier> {
  const notifiers = new Map<string, Notifier>();

  if (config.telegram.bot_token) {
    notifiers.set("telegram", new TelegramNotifier(config.telegram.bot_token, config.telegram.chat_id));
  }

  if (config.slack.bot_token) {
    notifiers.set("slack", new SlackNotifier(config.slack.bot_token, config.slack.channel));
  }

  return notifiers;
}
