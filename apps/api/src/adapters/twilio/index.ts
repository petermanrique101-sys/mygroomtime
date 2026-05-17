import type { TwilioAdapter, TwilioAdapterEnv } from './types.js';
import { createTwilioLiveAdapter } from './live.js';
import { createTwilioTwinAdapter } from './twin.js';

export type * from './types.js';

export function createTwilioAdapter(env: TwilioAdapterEnv): TwilioAdapter {
  return env.mode === 'live' ? createTwilioLiveAdapter(env) : createTwilioTwinAdapter(env);
}
