// tests/collector/notifier.test.ts
import { describe, it, expect } from "vitest";
import { formatReportText } from "../../src/collector/notifier/formatter.js";
import type { Report } from "../../src/shared/types.js";

const sampleReport: Report = {
  id: "r1",
  subscription_id: "sub1",
  keyword: "AI Agent",
  group_id: "g1",
  time_from: "2026-03-21T09:00:00Z",
  time_to: "2026-03-21T12:00:00Z",
  summary: "The group discussed AI Agent capabilities extensively.",
  sentiment: { positive: 0.48, neutral: 0.35, negative: 0.17 },
  key_opinions: [
    { sender: "Alice", opinion: "Agents need human oversight", stance: "neutral" },
    { sender: "Bob", opinion: "CrewAI works well in production", stance: "positive" },
  ],
  disputes: [
    { topic: "Production readiness", sides: [
      { who: "Alice", position: "Not mature enough" },
      { who: "Bob", position: "Already usable" },
    ]},
  ],
  action_items: [
    { item: "Test CrewAI framework", assignee: "Bob", deadline: "next week" },
  ],
  trends: { message_count: 23, participant_count: 6, density_per_hour: 7.7, duration_minutes: 180 },
  full_report: "",
  created_at: "2026-03-21T12:00:00Z",
};

describe("Report formatter", () => {
  it("formats a report for TG/Slack text", () => {
    const text = formatReportText(sampleReport, "Web3 Builder Group");
    expect(text).toContain("AI Agent");
    expect(text).toContain("Web3 Builder Group");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("48%");
    expect(text).toContain("Production readiness");
    expect(text).toContain("Test CrewAI framework");
  });
});
