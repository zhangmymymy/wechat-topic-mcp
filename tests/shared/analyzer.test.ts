import { describe, it, expect } from "vitest";
import { segmentMessages } from "../../src/shared/analyzer/segmenter.js";
import type { Message } from "../../src/shared/types.js";

function makeMsg(id: string, timestamp: string, content: string): Message {
  return {
    id, group_id: "g1", sender_id: "s1", sender_name: "Alice",
    content, media_url: null, msg_type: "text",
    is_transcribed: false, timestamp,
  };
}

describe("segmentMessages", () => {
  it("keeps small batches as a single segment", () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`m${i}`, `2026-03-21T10:${String(i).padStart(2, "0")}:00Z`, `msg ${i}`)
    );
    const segments = segmentMessages(msgs, 150);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(10);
  });

  it("splits at >5 min gaps", () => {
    const msgs = [
      makeMsg("m0", "2026-03-21T10:00:00Z", "hello"),
      makeMsg("m1", "2026-03-21T10:01:00Z", "world"),
      makeMsg("m2", "2026-03-21T10:11:00Z", "new topic"),
      makeMsg("m3", "2026-03-21T10:12:00Z", "indeed"),
    ];
    const segments = segmentMessages(msgs, 150);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(2);
  });

  it("splits at max message count", () => {
    const msgs = Array.from({ length: 200 }, (_, i) =>
      makeMsg(`m${i}`, `2026-03-21T10:00:${String(i % 60).padStart(2, "0")}Z`, `msg ${i}`)
    );
    const segments = segmentMessages(msgs, 100);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0].length).toBeLessThanOrEqual(100);
  });
});
