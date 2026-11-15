// Простой in-memory rate limiter (скользящее окно). Для нескольких инстансов заменить на Redis.
const buckets = new Map<string, number[]>();

export function checkRateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    const retryAfterSec = Math.ceil((windowMs - (now - arr[0])) / 1000);
    buckets.set(key, arr);
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

export function resetRateLimits() {
  buckets.clear();
}
