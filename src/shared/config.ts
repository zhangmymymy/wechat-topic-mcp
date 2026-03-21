import { readFileSync } from "fs";
import { parse } from "yaml";
import type { AppConfig } from "./types.js";

function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(path: string): AppConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw);
  return interpolateEnvVars(parsed) as AppConfig;
}
