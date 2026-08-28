// Simple in-memory rate limiter. Sufficient for a single-process Next.js server.
// For multi-instance deployments, swap for a Redis-backed implementation.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/**
 * Give one slot back to `key`'s CURRENT window — for callers that mean to charge
 * only the attempts that failed (the login path in lib/auth.ts refunds a
 * successful sign-in, so a busy morning of legitimate logins from one office
 * NAT address can never exhaust the window and lock everyone out).
 * A no-op when the window has already rolled over: the bucket the caller was
 * charged in is gone, and the fresh one owes it nothing. Never goes negative,
 * so a stray extra release cannot mint budget.
 */
export function releaseRateLimit(key: string): void {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= Date.now()) return;
  existing.count = Math.max(0, existing.count - 1);
}

// Periodic cleanup so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets.entries()) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref?.();
