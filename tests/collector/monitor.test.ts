// tests/collector/monitor.test.ts
import { describe, it, expect } from "vitest";
import { matchesKeyword } from "../../src/shared/db/queries.js";

describe("Keyword matching", () => {
  it("matches exact keywords", () => {
    expect(matchesKeyword("AI Agent", "AI Agent", "exact")).toBe(true);
    expect(matchesKeyword("ai agent", "AI Agent", "exact")).toBe(false);
    expect(matchesKeyword("I like AI Agents", "AI Agent", "exact")).toBe(false);
  });

  it("matches fuzzy keywords (case-insensitive substring)", () => {
    expect(matchesKeyword("I think AI agents are great", "AI agent", "fuzzy")).toBe(true);
    expect(matchesKeyword("nothing relevant here", "AI agent", "fuzzy")).toBe(false);
  });

  it("matches regex keywords", () => {
    expect(matchesKeyword("GPT-4o is amazing", "GPT-\\d", "regex")).toBe(true);
    expect(matchesKeyword("no match", "GPT-\\d", "regex")).toBe(false);
  });
});
