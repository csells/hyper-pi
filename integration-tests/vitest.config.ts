import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 15_000,
    // Tests that spawn real pi agents are resource-intensive.
    // Run test files sequentially to avoid port/tmux contention.
    fileParallelism: false,
    // Global setup/teardown ensures ALL test-spawned pi agents and tmux
    // sessions are cleaned up — even on crash, timeout, or Ctrl+C.
    globalSetup: "./src/global-setup.ts",
  },
});
