import type { DistanceMatrixInput, DistanceMatrixOutput, GmapsWireResponse } from './types.js';
import { GmapsRequestError } from './types.js';
import { parseDistanceMatrixResponse } from './parse.js';

const RETRY_BACKOFF_MS = 500;

export function buildDistanceMatrixUrl(
  base: string,
  input: DistanceMatrixInput,
  apiKey: string,
): string {
  const url = new URL(base);
  url.searchParams.set('origins', input.origins.join('|'));
  url.searchParams.set('destinations', input.destinations.join('|'));
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function parseRetryAfterSec(headerValue: string | null): number {
  if (headerValue === null) return 1;
  const n = Number(headerValue);
  if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  return 1;
}

async function readJson(res: Response, label: string): Promise<GmapsWireResponse> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(
      `gmaps ${label}: failed to parse response body as JSON (status ${res.status}): ${(err as Error).message}`,
    );
  }
  if (typeof body !== 'object' || body === null) {
    throw new Error(`gmaps ${label}: response body was not an object`);
  }
  return body as GmapsWireResponse;
}

export async function fetchDistanceMatrix(
  label: string,
  url: string,
): Promise<DistanceMatrixOutput> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`gmaps ${label}: network error calling Distance Matrix: ${(err as Error).message}`);
  }

  if (res.status === 429) {
    const retryAfter = parseRetryAfterSec(res.headers.get('retry-after'));
    await sleep(retryAfter * 1000);

    let retry: Response;
    try {
      retry = await fetch(url);
    } catch (err) {
      throw new Error(`gmaps ${label}: network error on retry: ${(err as Error).message}`);
    }
    if (retry.status === 429) {
      const retryAfter2 = parseRetryAfterSec(retry.headers.get('retry-after'));
      throw new GmapsRequestError(
        `gmaps ${label}: rate limited (429) after retry`,
        'OVER_QUERY_LIMIT',
        retryAfter2,
      );
    }
    if (!retry.ok) {
      throw new Error(`gmaps ${label}: retry returned HTTP ${retry.status}`);
    }
    return parseDistanceMatrixResponse(await readJson(retry, label));
  }

  if (!res.ok) {
    throw new Error(`gmaps ${label}: HTTP ${res.status}`);
  }

  return parseDistanceMatrixResponse(await readJson(res, label));
}

function sleep(ms: number): Promise<void> {
  const capped = Math.min(ms, RETRY_BACKOFF_MS * 10);
  return new Promise((resolve) => setTimeout(resolve, capped));
}
