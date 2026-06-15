/**
 * Retry an async operation on transient failures (429 / overload / network).
 * Uses exponential backoff. Z.ai's coding endpoint rate-limits aggressively,
 * so this is essential for batch workloads like eval runs.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 5
  const baseMs = opts.baseMs ?? 2000

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const isLast = attempt === retries
      // Only retry on 429 / overload / transient network errors.
      const msg = err instanceof Error ? err.message : String(err)
      const status = (err as { status?: number })?.status
      const transient =
        status === 429 ||
        /overloaded|rate.?limit|temporarily|429|1305/i.test(msg)
      if (isLast || !transient) throw err
      const delay = baseMs * Math.pow(2, attempt) + Math.random() * 500
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  // Unreachable, but satisfies the type checker.
  throw new Error("withRetry exhausted")
}
