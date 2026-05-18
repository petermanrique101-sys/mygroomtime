import { randomBytes } from 'node:crypto';
import type { SessionPayload, SessionStore } from './index.js';

const SESSION_TTL_MS = 60 * 60 * 24 * 14 * 1000;

type Entry = { value: SessionPayload; expiresAt: number };

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, Entry>();
  const magicJtis = new Map<string, number>();
  const rescheduleJtis = new Map<string, number>();

  function gcSessions(): void {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
  }
  function gcJtis(): void {
    const now = Date.now();
    for (const [k, v] of magicJtis) if (v <= now) magicJtis.delete(k);
  }
  function gcRescheduleJtis(): void {
    const now = Date.now();
    for (const [k, v] of rescheduleJtis) if (v <= now) rescheduleJtis.delete(k);
  }

  return {
    async create(payload) {
      const sid = randomBytes(32).toString('base64url');
      const now = Date.now();
      sessions.set(sid, {
        value: { ...payload, createdAt: now, lastSeenAt: now },
        expiresAt: now + SESSION_TTL_MS,
      });
      return sid;
    },
    async read(sid) {
      gcSessions();
      return sessions.get(sid)?.value ?? null;
    },
    async touch(sid) {
      gcSessions();
      const entry = sessions.get(sid);
      if (!entry) return null;
      const next: SessionPayload = { ...entry.value, lastSeenAt: Date.now() };
      sessions.set(sid, { value: next, expiresAt: Date.now() + SESSION_TTL_MS });
      return next;
    },
    async destroy(sid) {
      sessions.delete(sid);
    },
    async recordMagicJti(jti, ttlSec) {
      magicJtis.set(jti, Date.now() + ttlSec * 1000);
    },
    async consumeMagicJti(jti) {
      gcJtis();
      return magicJtis.delete(jti);
    },
    async recordRescheduleJti(jti, ttlSec) {
      rescheduleJtis.set(jti, Date.now() + ttlSec * 1000);
    },
    async consumeRescheduleJti(jti) {
      gcRescheduleJtis();
      return rescheduleJtis.delete(jti);
    },
    async close() {
      sessions.clear();
      magicJtis.clear();
      rescheduleJtis.clear();
    },
  };
}
