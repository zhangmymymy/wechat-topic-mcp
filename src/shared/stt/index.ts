// src/shared/stt/index.ts
import type { STTProvider, AppConfig } from "../types.js";
import { WhisperSTTProvider } from "./openai-whisper.js";

export function createSTTProvider(config: AppConfig["stt"]): STTProvider {
  switch (config.provider) {
    case "openai":
      return new WhisperSTTProvider(config.api_key, config.model);
    default:
      throw new Error(`Unknown STT provider: ${config.provider}`);
  }
}

export type { STTProvider };
