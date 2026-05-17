import type { GeocodeInput, GeocodeResult, GeocodeWireResponse } from './types.js';
import { GeocodeRequestError } from './types.js';
import { parseGeocodeResponse } from './parse.js';

const RETRY_BACKOFF_MS = 500;

export function buildGeocodeUrl(base: string, input: GeocodeInput, apiKey: string): string {
  const url = new URL(base);
  url.searchParams.set('address', input.address);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function parseRetryAfterSec(headerValue: string | null): number {
  if (headerValue === null) return 1;
  const n = Number(headerValue);
  if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  return 1;
}

async function readJson(res: Response, label: string): Promise<GeocodeWireResponse> {
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(
      `geocode ${label}: failed to parse response body as JSON (status ${res.status}): ${(err as Error).message}`,
    );
  }
  if (typeof body !== 'object' || body === null) {
    throw new Error(`geocode ${label}: response body was not an object`);
  }
  return body as GeocodeWireResponse;
}

export async function fetchGeocode(label: string, url: string): Promise<GeocodeResult> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `geocode ${label}: network error calling Geocoding API: ${(err as Error).message}`,
    );
  }

  if (res.status === 429) {
    const retryAfter = parseRetryAfterSec(res.headers.get('retry-after'));
    await sleep(retryAfter * 1000);

    let retry: Response;
    try {
      retry = await fetch(url);
    } catch (err) {
      throw new Error(`geocode ${label}: network error on retry: ${(err as Error).message}`);
    }
    if (retry.status === 429) {
      const retryAfter2 = parseRetryAfterSec(retry.headers.get('retry-after'));
      throw new GeocodeRequestError(
        'Address lookup is temporarily over its quota. Try again in a minute.',
        'OVER_QUERY_LIMIT',
        retryAfter2,
      );
    }
    if (!retry.ok) {
      throw new Error(`geocode ${label}: retry returned HTTP ${retry.status}`);
    }
    return parseGeocodeResponse(await readJson(retry, label));
  }

  if (!res.ok) {
    throw new Error(`geocode ${label}: HTTP ${res.status}`);
  }

  return parseGeocodeResponse(await readJson(res, label));
}

function sleep(ms: number): Promise<void> {
  const capped = Math.min(ms, RETRY_BACKOFF_MS * 10);
  return new Promise((resolve) => setTimeout(resolve, capped));
}
