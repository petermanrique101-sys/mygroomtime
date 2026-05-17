import type {
  GmapsAdapter,
  GmapsAdapterEnv,
  DistanceMatrixInput,
  DistanceMatrixOutput,
} from './types.js';
import { buildDistanceMatrixUrl, fetchDistanceMatrix } from './fetch.js';

const GOOGLE_DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

export function createGmapsLiveAdapter(env: GmapsAdapterEnv): GmapsAdapter {
  if (!env.apiKey) {
    return {
      mode: 'live',
      async distanceMatrix(): Promise<DistanceMatrixOutput> {
        throw new Error('gmaps.live: GOOGLE_MAPS_API_KEY is not set');
      },
    };
  }
  return {
    mode: 'live',
    async distanceMatrix(input: DistanceMatrixInput): Promise<DistanceMatrixOutput> {
      const url = buildDistanceMatrixUrl(GOOGLE_DISTANCE_MATRIX_URL, input, env.apiKey);
      return fetchDistanceMatrix('live', url);
    },
  };
}
