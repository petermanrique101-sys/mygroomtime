import type { StripeAdapter, StripeAdapterEnv } from './types.js';
import { createStripeLiveAdapter } from './live.js';
import { createStripeTwinAdapter } from './twin.js';

export type * from './types.js';

export function createStripeAdapter(env: StripeAdapterEnv): StripeAdapter {
  return env.mode === 'live' ? createStripeLiveAdapter(env) : createStripeTwinAdapter(env);
}
