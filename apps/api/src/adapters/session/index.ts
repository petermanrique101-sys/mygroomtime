export type SessionPayload = {
  userId: string;
  tenantId: string;
  createdAt: number;
  lastSeenAt: number;
};

export interface SessionStore {
  create(payload: Omit<SessionPayload, 'createdAt' | 'lastSeenAt'>): Promise<string>;
  read(sid: string): Promise<SessionPayload | null>;
  touch(sid: string): Promise<SessionPayload | null>;
  destroy(sid: string): Promise<void>;
  recordMagicJti(jti: string, ttlSec: number): Promise<void>;
  consumeMagicJti(jti: string): Promise<boolean>;
  close(): Promise<void>;
}

export { createRedisSessionStore } from './redis.js';
export { createMemorySessionStore } from './memory.js';
