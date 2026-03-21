// src/collector/notifier/formatter.ts
import type { Report } from "../../shared/types.js";

export function formatReportText(report: Report, groupName: string): string {
  const lines: string[] = [];

  lines.push(`📊 Topic Monitor Report: ${report.keyword}`);
  lines.push(``);
  lines.push(`🏷 Group: ${groupName}`);
  lines.push(`🕐 Time: ${formatTime(report.time_from)} ~ ${formatTime(report.time_to)}`);
  lines.push(`💬 Messages: ${report.trends.message_count} / ${report.trends.participant_count} participants`);
  lines.push(``);
  lines.push(`【Summary】`);
  lines.push(report.summary);
  lines.push(``);

  if (report.key_opinions.length > 0) {
    lines.push(`【Key Opinions】`);
    for (const o of report.key_opinions) {
      lines.push(`• ${o.sender}: ${o.opinion}`);
    }
    lines.push(``);
  }

  lines.push(`【Sentiment】`);
  lines.push(
    `Positive ${pct(report.sentiment.positive)} | ` +
    `Neutral ${pct(report.sentiment.neutral)} | ` +
    `Negative ${pct(report.sentiment.negative)}`
  );
  lines.push(``);

  if (report.disputes.length > 0) {
    lines.push(`【Disputes】`);
    for (const d of report.disputes) {
      const sides = d.sides.map((s) => `${s.who}`).join(" vs ");
      lines.push(`🔴 ${d.topic}: ${sides}`);
    }
    lines.push(``);
  }

  if (report.action_items.length > 0) {
    lines.push(`【Action Items】`);
    for (const a of report.action_items) {
      let line = `• ${a.item}`;
      if (a.assignee) line += ` (${a.assignee})`;
      if (a.deadline) line += ` — by ${a.deadline}`;
      lines.push(line);
    }
  }

  return lines.join("\n");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
