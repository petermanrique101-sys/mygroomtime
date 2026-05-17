import type { GeocodeAdapter, GeocodeAdapterEnv } from './types.js';
import { createGeocodeLiveAdapter } from './live.js';
import { createGeocodeTwinAdapter } from './twin.js';

export type * from './types.js';

export function createGeocodeAdapter(env: GeocodeAdapterEnv): GeocodeAdapter {
  return env.mode === 'live' ? createGeocodeLiveAdapter(env) : createGeocodeTwinAdapter(env);
}
