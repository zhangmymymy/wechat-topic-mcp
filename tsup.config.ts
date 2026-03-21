import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "collector/index": "src/collector/index.ts",
    "mcp/index": "src/mcp/index.ts",
  },
  format: ["esm"],
  target: "node20",
  splitting: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
});
