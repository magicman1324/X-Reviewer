export interface RateLimitConfig {
  /** Max requests allowed in the window. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
  /** Min time between two requests from the same key (ms). */
  minIntervalMs?: number;
  /** Cooldown period after hitting the limit (ms). */
  cooldownMs?: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix-ms timestamp when the window resets. */
  resetAt: number;
  /** Human-readable reason if denied. */
  reason?: string;
  /** Suggested retry-after duration in ms. */
  retryAfterMs?: number;
}

interface BucketEntry {
  count: number;
  windowStart: number;
  lastRequestAt: number;
  cooldownUntil: number;
}

export interface RateLimiterStats {
  activeBuckets: number;
  cooldownBuckets: number;
  totalRequests: number;
}

/**
 * In-memory sliding-window rate limiter with cooldown support.
 * Keys are typically `${owner}/${repo}:${user}` or `${owner}/${repo}:*`.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketEntry>();
  private config: Required<RateLimitConfig>;
  private totalRequests = 0;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      minIntervalMs: config.minIntervalMs ?? 0,
      cooldownMs: config.cooldownMs ?? config.windowMs * 2,
    };
  }

  /**
   * Check whether a request identified by `key` is allowed.
   * Returns a detailed status; the caller decides how to enforce.
   */
  check(key: string): RateLimitStatus {
    this.evictStale();
    const now = Date.now();
    let entry = this.buckets.get(key);

    if (!entry) {
      entry = { count: 0, windowStart: now, lastRequestAt: 0, cooldownUntil: 0 };
      this.buckets.set(key, entry);
    }

    // Cooldown check
    if (entry.cooldownUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.cooldownUntil,
        reason: `Cooldown active. Retry after ${Math.ceil((entry.cooldownUntil - now) / 1000)}s.`,
        retryAfterMs: entry.cooldownUntil - now,
      };
    }

    // Window expired → reset
    if (now - entry.windowStart >= this.config.windowMs) {
      entry.count = 0;
      entry.windowStart = now;
      entry.cooldownUntil = 0;
    }

    // Min interval check
    if (this.config.minIntervalMs > 0 && entry.lastRequestAt > 0) {
      const elapsed = now - entry.lastRequestAt;
      if (elapsed < this.config.minIntervalMs) {
        return {
          allowed: false,
          remaining: this.config.maxRequests - entry.count,
          resetAt: entry.lastRequestAt + this.config.minIntervalMs,
          reason: `Too frequent. Wait ${Math.ceil((this.config.minIntervalMs - elapsed) / 1000)}s between requests.`,
          retryAfterMs: this.config.minIntervalMs - elapsed,
        };
      }
    }

    // Rate limit check
    if (entry.count >= this.config.maxRequests) {
      entry.cooldownUntil = now + this.config.cooldownMs;
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowStart + this.config.windowMs,
        reason: `Rate limit exceeded (${this.config.maxRequests} per ${this.config.windowMs / 1000}s).`,
        retryAfterMs: this.config.cooldownMs,
      };
    }

    entry.count++;
    entry.lastRequestAt = now;
    this.totalRequests++;

    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetAt: entry.windowStart + this.config.windowMs,
    };
  }

  /**
   * Force-reset the bucket for a key (e.g., after a successful review).
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Get stats for health checks and monitoring.
   */
  getStats(): RateLimiterStats {
    this.evictStale();
    const now = Date.now();
    let cooldownBuckets = 0;

    for (const entry of this.buckets.values()) {
      if (entry.cooldownUntil > now) cooldownBuckets++;
    }

    return {
      activeBuckets: this.buckets.size,
      cooldownBuckets,
      totalRequests: this.totalRequests,
    };
  }

  private evictStale(): void {
    const now = Date.now();
    const staleThreshold = now - this.config.cooldownMs * 3;

    for (const [key, entry] of this.buckets) {
      if (entry.windowStart < staleThreshold && entry.cooldownUntil <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Detect abuse patterns in review requests.
 * Returns a list of abuse flags found.
 */
export function detectAbuse(input: {
  prBody: string;
  prTitle: string;
  /** Number of files changed. */
  fileCount: number;
  /** Total lines changed. */
  totalChanges: number;
}): string[] {
  const flags: string[] = [];

  // PrBody contains spam-like patterns
  const spamPatterns = [
    /https?:\/\/\S+(?:free|cheap|discount|buy|click|subscribe)/i,
    /\b(?:viagra|casino|lottery|prize|winner)\b/i,
    /<script\b/i,
  ];
  for (const pattern of spamPatterns) {
    if (pattern.test(input.prBody)) {
      flags.push('Spam content detected in PR body');
      break;
    }
  }

  // Suspiciously large PR (>500 files or >10000 lines)
  if (input.fileCount > 500) {
    flags.push(`Suspicious file count: ${input.fileCount} files`);
  }
  if (input.totalChanges > 10000) {
    flags.push(`Suspicious change volume: ${input.totalChanges} lines`);
  }

  // PR body is just a URL (link-dump)
  if (/^https?:\/\/\S+$/.test(input.prBody.trim())) {
    flags.push('PR body is a single URL');
  }

  // Empty PR body with very large diff
  if (input.prBody.trim().length === 0 && input.totalChanges > 2000) {
    flags.push('Empty PR body with large diff');
  }

  return flags;
}

/**
 * Factory for common rate limit presets.
 */
export const RateLimitPresets = {
  /** Per-user normal review: 10 per 10 minutes. */
  user: (): RateLimitConfig => ({
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
    minIntervalMs: 5 * 1000,
    cooldownMs: 15 * 60 * 1000,
  }),

  /** Per-user deep review: 3 per 30 minutes. */
  deepReview: (): RateLimitConfig => ({
    maxRequests: 3,
    windowMs: 30 * 60 * 1000,
    minIntervalMs: 30 * 1000,
    cooldownMs: 60 * 60 * 1000,
  }),

  /** Per-repo global: 30 per 10 minutes. */
  repo: (): RateLimitConfig => ({
    maxRequests: 30,
    windowMs: 10 * 60 * 1000,
    minIntervalMs: 1 * 1000,
    cooldownMs: 20 * 60 * 1000,
  }),

  /** Health-check friendly: no real limits. */
  test: (): RateLimitConfig => ({
    maxRequests: 100,
    windowMs: 1000,
    minIntervalMs: 0,
    cooldownMs: 1000,
  }),
} as const;
