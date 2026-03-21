// src/collector/notifier/slack.ts
import { WebClient } from "@slack/web-api";
import type { Notifier, Report } from "../../shared/types.js";
import { formatReportText } from "./formatter.js";

export class SlackNotifier implements Notifier {
  private client: WebClient;
  private channel: string;

  constructor(botToken: string, channel: string) {
    this.client = new WebClient(botToken);
    this.channel = channel;
  }

  async send(report: Report, groupName: string): Promise<void> {
    const text = formatReportText(report, groupName);

    await this.client.chat.postMessage({
      channel: this.channel,
      text,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `📊 ${report.keyword} — ${groupName}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Time:* ${report.time_from} ~ ${report.time_to}\n*Messages:* ${report.trends.message_count} / ${report.trends.participant_count} participants` },
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Summary*\n${report.summary}` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Sentiment:* Positive ${(report.sentiment.positive * 100).toFixed(0)}% | Neutral ${(report.sentiment.neutral * 100).toFixed(0)}% | Negative ${(report.sentiment.negative * 100).toFixed(0)}%`,
          },
        },
      ],
    });
  }
}
