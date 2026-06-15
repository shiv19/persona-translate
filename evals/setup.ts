// Loaded by evalite.config.ts setupFiles before any eval runs.
// Ensures ZAI_API_KEY (and friends) are available to the judge + task calls.
try {
  process.loadEnvFile()
} catch {
  // .env missing — rely on ambient env (e.g. CI-injected secrets).
}
