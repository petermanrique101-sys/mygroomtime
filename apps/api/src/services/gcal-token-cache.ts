import type { Redis } from 'ioredis';
import type { GcalAdapter } from '../adapters/gcal/index.js';
import { decryptToken } from './token-encrypt.js';

// why: every gcal API call wants a fresh access_token. Refresh tokens are long-lived;
// access tokens last ~1h. Caching is required so a burst of push jobs doesn't refresh
// once per job. The cache lives in Redis with TTL = expires_in - 60s. Concurrent workers
// racing to refresh take a short SETNX-style lock; the loser polls briefly.

const LOCK_TTL_MS = 5_000;
const LOCK_POLL_MS = 50;
const REFRESH_HEADROOM_S = 60;

type Deps = {
  redis: Redis | null;
  gcal: GcalAdapter;
  encryptionKey: string;
};

export type CachedToken = { accessToken: string; expiresAt: number };

function tokenKey(userId: string): string {
  return `gcal-token:${userId}`;
}

function lockKey(userId: string): string {
  return `gcal-token-lock:${userId}`;
}

export async function getAccessToken(
  deps: Deps,
  args: { userId: string; encryptedRefreshToken: string },
): Promise<CachedToken> {
  const cached = deps.redis ? await readCache(deps.redis, args.userId) : null;
  if (cached && cached.expiresAt - Date.now() > REFRESH_HEADROOM_S * 1000) {
    return cached;
  }

  if (deps.redis) {
    const lock = lockKey(args.userId);
    const acquired = await deps.redis.set(lock, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      // why: someone else is refreshing. Poll the cache key briefly; if their refresh
      // succeeds the cache will be set within the lock TTL. Bail out and call directly
      // if it never appears (defensive — the lock holder could crash).
      const polled = await pollCache(deps.redis, args.userId, LOCK_TTL_MS);
      if (polled) return polled;
    }
  }

  const refreshToken = decryptToken(args.encryptedRefreshToken, deps.encryptionKey);
  const refreshed = await deps.gcal.refreshAccessToken({ refreshToken });
  const result: CachedToken = {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  };
  if (deps.redis) {
    const ttlMs = Math.max(1000, refreshed.expiresAt - Date.now() - REFRESH_HEADROOM_S * 1000);
    await deps.redis.set(
      tokenKey(args.userId),
      JSON.stringify(result),
      'PX',
      ttlMs,
    );
    await deps.redis.del(lockKey(args.userId)).catch(() => undefined);
  }
  return result;
}

async function readCache(redis: Redis, userId: string): Promise<CachedToken | null> {
  const raw = await redis.get(tokenKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedToken;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function pollCache(
  redis: Redis,
  userId: string,
  windowMs: number,
): Promise<CachedToken | null> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const hit = await readCache(redis, userId);
    if (hit && hit.expiresAt - Date.now() > REFRESH_HEADROOM_S * 1000) return hit;
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
  return null;
}

export async function invalidateAccessToken(redis: Redis | null, userId: string): Promise<void> {
  if (!redis) return;
  await redis.del(tokenKey(userId)).catch(() => undefined);
}
