import { describe, it, expect } from 'vitest';
import { createMemorySessionStore } from './memory.js';

describe('memory session store — magic jti', () => {
  it('enforces single-use semantics on consume', async () => {
    const store = createMemorySessionStore();
    await store.recordMagicJti('jti-abc', 60);

    const first = await store.consumeMagicJti('jti-abc');
    const second = await store.consumeMagicJti('jti-abc');

    expect(first).toBe(true);
    expect(second).toBe(false);
    await store.close();
  });

  it('returns false for an unknown jti', async () => {
    const store = createMemorySessionStore();
    const result = await store.consumeMagicJti('never-existed');
    expect(result).toBe(false);
    await store.close();
  });
});
