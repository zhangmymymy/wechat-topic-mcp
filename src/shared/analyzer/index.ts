import type { AIProvider, AnalysisResult, Message, Report, AppConfig } from "../types.js";
import type Database from "better-sqlite3";
import { segmentMessages } from "./segmenter.js";
import { getContextWindow } from "../db/queries.js";
import { v4 as uuidv4 } from "uuid";

export interface AnalyzeOptions {
  keyword: string;
  groupId?: string;
  timeFrom: string;
  timeTo: string;
  subscriptionId?: string;
}

export async function analyzeTopicFromMessages(
  messages: Message[],
  keyword: string,
  aiProvider: AIProvider,
  maxPerSegment: number = 150,
): Promise<AnalysisResult> {
  if (messages.length === 0) {
    return emptyResult();
  }
  const segments = segmentMessages(messages, maxPerSegment);
  if (segments.length === 1) {
    return aiProvider.analyze(segments[0], keyword);
  }
  const segmentResults = await Promise.all(
    segments.map((seg) => aiProvider.analyze(seg, keyword))
  );
  return aiProvider.mergeReports(segmentResults, keyword);
}

export function buildContextMessages(
  db: Database.Database,
  anchorIds: string[],
  groupId: string,
  config: AppConfig["analysis"],
): Message[] {
  const seen = new Set<string>();
  const allMessages: Message[] = [];
  for (const anchorId of anchorIds) {
    const window = getContextWindow(db, anchorId, groupId, config.context_before, config.context_after);
    for (const msg of window) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        allMessages.push(msg);
      }
    }
  }
  allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return allMessages;
}

export function buildReportFromAnalysis(
  result: AnalysisResult,
  opts: AnalyzeOptions,
): Report {
  const fullReport = formatMarkdownReport(result, opts.keyword);
  return {
    id: uuidv4(),
    subscription_id: opts.subscriptionId ?? null,
    keyword: opts.keyword,
    group_id: opts.groupId ?? null,
    time_from: opts.timeFrom,
    time_to: opts.timeTo,
    summary: result.report.summary,
    sentiment: result.report.sentiment,
    key_opinions: result.report.key_opinions,
    disputes: result.report.disputes,
    action_items: result.report.action_items,
    trends: result.report.trends,
    full_report: fullReport,
    created_at: new Date().toISOString(),
  };
}

function formatMarkdownReport(result: AnalysisResult, keyword: string): string {
  const r = result.report;
  let md = `# Topic Report: ${keyword}\n\n`;
  md += `## Summary\n${r.summary}\n\n`;
  md += `## Key Opinions\n`;
  for (const o of r.key_opinions) {
    md += `- **${o.sender}** (${o.stance}): ${o.opinion}\n`;
  }
  md += `\n## Sentiment\n`;
  md += `Positive: ${(r.sentiment.positive * 100).toFixed(0)}% | `;
  md += `Neutral: ${(r.sentiment.neutral * 100).toFixed(0)}% | `;
  md += `Negative: ${(r.sentiment.negative * 100).toFixed(0)}%\n\n`;
  if (r.disputes.length > 0) {
    md += `## Disputes\n`;
    for (const d of r.disputes) {
      md += `### ${d.topic}\n`;
      for (const s of d.sides) {
        md += `- **${s.who}**: ${s.position}\n`;
      }
    }
    md += `\n`;
  }
  if (r.action_items.length > 0) {
    md += `## Action Items\n`;
    for (const a of r.action_items) {
      md += `- ${a.item}`;
      if (a.assignee) md += ` (${a.assignee})`;
      if (a.deadline) md += ` — by ${a.deadline}`;
      md += `\n`;
    }
    md += `\n`;
  }
  md += `## Activity\n`;
  md += `- Messages: ${r.trends.message_count}\n`;
  md += `- Participants: ${r.trends.participant_count}\n`;
  md += `- Density: ${r.trends.density_per_hour}/hour\n`;
  md += `- Duration: ${r.trends.duration_minutes} minutes\n`;
  return md;
}

function emptyResult(): AnalysisResult {
  return {
    related_message_ids: [],
    report: {
      summary: "No relevant messages found.",
      sentiment: { positive: 0, neutral: 1, negative: 0 },
      key_opinions: [],
      disputes: [],
      action_items: [],
      trends: { message_count: 0, participant_count: 0, density_per_hour: 0, duration_minutes: 0 },
    },
  };
}
