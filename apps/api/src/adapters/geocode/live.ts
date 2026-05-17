import type {
  GeocodeAdapter,
  GeocodeAdapterEnv,
  GeocodeInput,
  GeocodeResult,
} from './types.js';
import { buildGeocodeUrl, fetchGeocode } from './fetch.js';

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export function createGeocodeLiveAdapter(env: GeocodeAdapterEnv): GeocodeAdapter {
  if (!env.apiKey) {
    return {
      mode: 'live',
      async geocode(): Promise<GeocodeResult> {
        throw new Error('geocode.live: GOOGLE_MAPS_API_KEY is not set');
      },
    };
  }
  return {
    mode: 'live',
    async geocode(input: GeocodeInput): Promise<GeocodeResult> {
      const url = buildGeocodeUrl(GOOGLE_GEOCODE_URL, input, env.apiKey);
      return fetchGeocode('live', url);
    },
  };
}
