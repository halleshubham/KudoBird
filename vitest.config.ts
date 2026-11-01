import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    env: { ...loadEnv(mode, process.cwd(), ""), NODE_ENV: "test" },
    // Tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
  },
}));
