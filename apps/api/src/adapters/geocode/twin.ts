import type {
  GeocodeAdapter,
  GeocodeAdapterEnv,
  GeocodeInput,
  GeocodeResult,
} from './types.js';
import { buildGeocodeUrl, fetchGeocode } from './fetch.js';

export function createGeocodeTwinAdapter(env: GeocodeAdapterEnv): GeocodeAdapter {
  const base = `${env.twinUrl.replace(/\/+$/, '')}/maps/api/geocode/json`;
  return {
    mode: 'twin',
    async geocode(input: GeocodeInput): Promise<GeocodeResult> {
      const url = buildGeocodeUrl(base, input, env.apiKey || 'twin');
      return fetchGeocode('twin', url);
    },
  };
}
