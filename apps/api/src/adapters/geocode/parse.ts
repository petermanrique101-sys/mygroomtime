import type {
  GeocodeResult,
  GeocodeStatus,
  GeocodeWireResponse,
} from './types.js';
import { GeocodeRequestError } from './types.js';

const STATUSES: ReadonlySet<GeocodeStatus> = new Set([
  'OK',
  'ZERO_RESULTS',
  'OVER_QUERY_LIMIT',
  'REQUEST_DENIED',
  'INVALID_REQUEST',
  'UNKNOWN_ERROR',
]);

function normalizeStatus(raw: string | undefined): GeocodeStatus {
  if (raw === undefined) return 'UNKNOWN_ERROR';
  return STATUSES.has(raw as GeocodeStatus) ? (raw as GeocodeStatus) : 'UNKNOWN_ERROR';
}

function messageFor(status: GeocodeStatus, fallback?: string): string {
  if (fallback && fallback.length > 0) return fallback;
  switch (status) {
    case 'ZERO_RESULTS':
      return "Couldn't verify that address — please check the street and zip code.";
    case 'OVER_QUERY_LIMIT':
      return 'Address lookup is temporarily over its quota. Try again in a minute.';
    case 'REQUEST_DENIED':
      return 'Address lookup was denied. Check the Google Maps API key configuration.';
    case 'INVALID_REQUEST':
      return 'Address lookup request was malformed — please enter a street, city, and zip.';
    default:
      return 'Address lookup is temporarily unavailable. Please try again.';
  }
}

export function parseGeocodeResponse(wire: GeocodeWireResponse): GeocodeResult {
  const status = normalizeStatus(wire.status);
  if (status !== 'OK') {
    throw new GeocodeRequestError(messageFor(status, wire.error_message), status);
  }
  const first = wire.results?.[0];
  if (!first) {
    throw new GeocodeRequestError(messageFor('ZERO_RESULTS'), 'ZERO_RESULTS');
  }
  const lat = first.geometry?.location?.lat;
  const lng = first.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new GeocodeRequestError(
      'Address lookup returned a result with no coordinates.',
      'UNKNOWN_ERROR',
    );
  }
  return {
    lat,
    lng,
    formattedAddress: first.formatted_address ?? '',
    placeId: first.place_id ?? '',
  };
}
