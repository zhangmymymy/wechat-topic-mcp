import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/shared/config.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

describe("loadConfig", () => {
  const testDir = join(import.meta.dirname, "../../tmp-test");
  const configPath = join(testDir, "config.yaml");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch {}
  });

  it("loads yaml config and interpolates env vars", () => {
    process.env.TEST_API_KEY = "sk-test-123";
    writeFileSync(
      configPath,
      `ai:\n  provider: "openai"\n  api_key: "\${TEST_API_KEY}"\n  model: "gpt-4o"\n  max_context_messages: 200\n`
    );

    const config = loadConfig(configPath);
    expect(config.ai.api_key).toBe("sk-test-123");
    expect(config.ai.provider).toBe("openai");
    delete process.env.TEST_API_KEY;
  });

  it("throws if config file does not exist", () => {
    expect(() => loadConfig("/nonexistent/config.yaml")).toThrow();
  });
});
