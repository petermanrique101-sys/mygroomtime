import type { GmapsAdapter, GmapsAdapterEnv } from './types.js';
import { createGmapsLiveAdapter } from './live.js';
import { createGmapsTwinAdapter } from './twin.js';

export type * from './types.js';

export function createGmapsAdapter(env: GmapsAdapterEnv): GmapsAdapter {
  return env.mode === 'live' ? createGmapsLiveAdapter(env) : createGmapsTwinAdapter(env);
}
