import type { GcalAdapter, GcalAdapterEnv } from './types.js';
import { createGcalLiveAdapter } from './live.js';
import { createGcalTwinAdapter } from './twin.js';

export type * from './types.js';

export function createGcalAdapter(env: GcalAdapterEnv): GcalAdapter {
  return env.mode === 'live' ? createGcalLiveAdapter(env) : createGcalTwinAdapter(env);
}
