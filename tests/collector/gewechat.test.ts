// tests/collector/gewechat.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMessage } from "../../src/collector/gewechat.js";
import type { GeWeChatMessage } from "../../src/shared/types.js";

describe("GeweChat Adapter", () => {
  it("normalizes a text message", () => {
    const raw: GeWeChatMessage = {
      msg_id: "123456",
      from_user: "wxid_abc",
      from_user_name: "Alice",
      to_user: "wxid_group",
      msg_type: 1,
      content: "Hello everyone!",
      create_time: 1742544000,
      room_id: "room_001",
      room_name: "Tech Group",
    };

    const msg = normalizeMessage(raw);
    expect(msg.id).toBe("123456");
    expect(msg.group_id).toBe("room_001");
    expect(msg.sender_name).toBe("Alice");
    expect(msg.content).toBe("Hello everyone!");
    expect(msg.msg_type).toBe("text");
    expect(msg.media_url).toBeNull();
  });

  it("normalizes a voice message", () => {
    const raw: GeWeChatMessage = {
      msg_id: "789",
      from_user: "wxid_abc",
      from_user_name: "Bob",
      to_user: "wxid_group",
      msg_type: 34,
      content: "",
      create_time: 1742544000,
      room_id: "room_001",
      room_name: "Tech Group",
      voice_url: "https://example.com/voice.amr",
    };

    const msg = normalizeMessage(raw);
    expect(msg.msg_type).toBe("voice");
    expect(msg.media_url).toBe("https://example.com/voice.amr");
    expect(msg.content).toBeNull();
  });
});
