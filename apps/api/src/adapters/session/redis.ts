import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import type { SessionPayload, SessionStore } from './index.js';

const SESSION_TTL_SEC = 60 * 60 * 24 * 14;
const SESSION_PREFIX = 'session:';
const MAGIC_JTI_PREFIX = 'magic-jti:';

function newSid(): string {
  return randomBytes(32).toString('base64url');
}

export function createRedisSessionStore(redisUrl: string): SessionStore {
  const client = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });

  async function create(
    payload: Omit<SessionPayload, 'createdAt' | 'lastSeenAt'>,
  ): Promise<string> {
    const sid = newSid();
    const now = Date.now();
    const full: SessionPayload = { ...payload, createdAt: now, lastSeenAt: now };
    await client.set(SESSION_PREFIX + sid, JSON.stringify(full), 'EX', SESSION_TTL_SEC);
    return sid;
  }

  async function read(sid: string): Promise<SessionPayload | null> {
    const raw = await client.get(SESSION_PREFIX + sid);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      return null;
    }
  }

  async function touch(sid: string): Promise<SessionPayload | null> {
    const current = await read(sid);
    if (!current) return null;
    const next: SessionPayload = { ...current, lastSeenAt: Date.now() };
    await client.set(SESSION_PREFIX + sid, JSON.stringify(next), 'EX', SESSION_TTL_SEC);
    return next;
  }

  async function destroy(sid: string): Promise<void> {
    await client.del(SESSION_PREFIX + sid);
  }

  async function recordMagicJti(jti: string, ttlSec: number): Promise<void> {
    await client.set(MAGIC_JTI_PREFIX + jti, '1', 'EX', ttlSec);
  }

  async function consumeMagicJti(jti: string): Promise<boolean> {
    const removed = await client.del(MAGIC_JTI_PREFIX + jti);
    return removed > 0;
  }

  async function close(): Promise<void> {
    await client.quit();
  }

  return { create, read, touch, destroy, recordMagicJti, consumeMagicJti, close };
}
