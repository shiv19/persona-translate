import { defineConfig } from "evalite/config"

export default defineConfig({
  setupFiles: ["./evals/setup.ts"],
  testTimeout: 240000, // Z.ai can stall under rate-limiting; give retries room
  maxConcurrency: 1, // Z.ai rate-limits aggressively; run sequentially
  server: {
    port: 3006
  }
})
