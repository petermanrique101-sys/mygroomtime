export type RateLimiter = {
  shouldThrottle(): boolean;
  retryAfterSec(): number;
};

export function createRateLimiter(perSecond: number | null): RateLimiter {
  if (perSecond === null || perSecond <= 0) {
    return { shouldThrottle: () => false, retryAfterSec: () => 0 };
  }
  let windowStart = Date.now();
  let count = 0;
  return {
    shouldThrottle(): boolean {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count > perSecond;
    },
    retryAfterSec(): number {
      const elapsed = Date.now() - windowStart;
      return Math.max(1, Math.ceil((1000 - elapsed) / 1000));
    },
  };
}
