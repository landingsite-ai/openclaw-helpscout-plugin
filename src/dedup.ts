/**
 * In-memory deduplication cache with TTL.
 *
 * Used to prevent duplicate webhook events from triggering multiple actions.
 * Keys expire after the configured TTL (default 1 hour), and a periodic
 * sweep removes stale entries every 10 minutes.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export class DedupCache {
  private entries = new Map<string, number>(); // key → expiry timestamp
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.cleanupTimer = setInterval(() => this.sweep(), CLEANUP_INTERVAL_MS);
    // Allow the process to exit even if the timer is still running.
    // In Node.js, setInterval returns a Timeout object with .unref().
    const timer = this.cleanupTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  /** Returns true if the key was seen recently (not yet expired). */
  has(key: string): boolean {
    const expiry = this.entries.get(key);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /** Record a key, marking it as seen until TTL expires. */
  add(key: string): void {
    this.entries.set(key, Date.now() + this.ttlMs);
  }

  /** Remove all expired entries. */
  private sweep(): void {
    const now = Date.now();
    for (const [key, expiry] of this.entries) {
      if (now > expiry) {
        this.entries.delete(key);
      }
    }
  }

  /** Stop the cleanup timer (for graceful shutdown / tests). */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
