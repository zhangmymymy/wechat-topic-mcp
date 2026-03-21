import type { Message } from "../types.js";

export function buildAnalysisPrompt(messages: Message[], keyword: string): string {
  const messagesJson = messages.map((m) => ({
    id: m.id,
    sender: m.sender_name,
    content: m.content,
    timestamp: m.timestamp,
    type: m.msg_type,
  }));

  return `You are a WeChat group message analyst.

## Task
From the following group chat messages, identify discussions related to the topic "${keyword}" and generate an analysis report.

## Messages
${JSON.stringify(messagesJson, null, 2)}

## Instructions
1. Identify which messages belong to this topic's discussion (note: multiple topics may interleave; consider @mentions, quoted replies, and time proximity)
2. Generate:
   - Core summary (3-5 sentences)
   - Key opinions list (who said what)
   - Sentiment distribution (positive/neutral/negative percentages, must sum to 1.0)
   - Opinion disputes (differing viewpoints and who holds them)
   - Action items (decisions made, tasks mentioned, deadlines)
   - Activity metrics (participant count, message density per hour, duration in minutes)

## Output Format
Return ONLY valid JSON matching this exact schema, no other text:
{
  "related_message_ids": ["msg_id_1", "msg_id_2"],
  "report": {
    "summary": "string (3-5 sentences)",
    "sentiment": { "positive": 0.48, "neutral": 0.35, "negative": 0.17 },
    "key_opinions": [{ "sender": "name", "opinion": "string", "stance": "positive" }],
    "disputes": [{ "topic": "string", "sides": [{ "who": "name", "position": "string" }] }],
    "action_items": [{ "item": "string", "assignee": null, "deadline": null }],
    "trends": { "message_count": 0, "participant_count": 0, "density_per_hour": 0, "duration_minutes": 0 }
  }
}`;
}

export function buildMergePrompt(reports: Record<string, unknown>[]): string {
  const keyword = (reports[0] as any)?.keyword ?? "unknown";
  return `You are a WeChat group message analyst. Merge these segment reports about "${keyword}" into one unified report.

## Segment Reports
${JSON.stringify(reports, null, 2)}

## Instructions
Combine all segments into a single coherent report. Deduplicate opinions, merge sentiment scores (weighted by message count), consolidate action items, and compute overall trends.

Return ONLY valid JSON with the same schema as the individual reports (related_message_ids + report object).`;
}
