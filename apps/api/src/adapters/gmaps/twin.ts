import type {
  GmapsAdapter,
  GmapsAdapterEnv,
  DistanceMatrixInput,
  DistanceMatrixOutput,
} from './types.js';
import { buildDistanceMatrixUrl, fetchDistanceMatrix } from './fetch.js';

export function createGmapsTwinAdapter(env: GmapsAdapterEnv): GmapsAdapter {
  const base = `${env.twinUrl.replace(/\/+$/, '')}/maps/api/distancematrix/json`;
  return {
    mode: 'twin',
    async distanceMatrix(input: DistanceMatrixInput): Promise<DistanceMatrixOutput> {
      const url = buildDistanceMatrixUrl(base, input, env.apiKey || 'twin');
      return fetchDistanceMatrix('twin', url);
    },
  };
}
