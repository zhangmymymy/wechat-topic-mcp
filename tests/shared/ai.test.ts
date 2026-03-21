import { describe, it, expect, vi } from "vitest";
import { buildAnalysisPrompt } from "../../src/shared/ai/prompts.js";
import type { Message } from "../../src/shared/types.js";

describe("AI Prompts", () => {
  it("builds analysis prompt with messages and keyword", () => {
    const messages: Message[] = [
      {
        id: "m1", group_id: "g1", sender_id: "s1", sender_name: "Alice",
        content: "I think AI agents are great", media_url: null,
        msg_type: "text", is_transcribed: false, timestamp: "2026-03-21T10:00:00Z",
      },
    ];
    const prompt = buildAnalysisPrompt(messages, "AI agents");
    expect(prompt).toContain("AI agents");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("I think AI agents are great");
    expect(prompt).toContain("related_message_ids");
  });
});
