import type { AIProvider, AppConfig } from "../types.js";
import { OpenAIProvider } from "./openai.js";

export function createAIProvider(config: AppConfig["ai"]): AIProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAIProvider(config.api_key, config.model, config.base_url);
    case "claude":
      if (!config.base_url) throw new Error("Claude provider requires ai.base_url in config");
      return new OpenAIProvider(config.api_key, config.model, config.base_url);
    case "ollama":
      return new OpenAIProvider(config.api_key, config.model, config.base_url ?? "http://localhost:11434/v1");
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

export type { AIProvider };
