import { driveSeconds, haversineMeters } from './haversine.js';
import type { ParsedPoint } from './parse.js';

export type ElementStatus =
  | 'OK'
  | 'NOT_FOUND'
  | 'ZERO_RESULTS'
  | 'MAX_ROUTE_LENGTH_EXCEEDED';

export type Element = {
  status: ElementStatus;
  duration?: { value: number; text: string };
  distance?: { value: number; text: string };
};

export type Row = { elements: Element[] };

export type OkResponse = {
  status: 'OK';
  origin_addresses: string[];
  destination_addresses: string[];
  rows: Row[];
};

export type ErrorResponse = {
  status: 'OVER_QUERY_LIMIT' | 'INVALID_REQUEST' | 'REQUEST_DENIED' | 'UNKNOWN_ERROR';
  error_message?: string;
  origin_addresses?: string[];
  destination_addresses?: string[];
  rows?: Row[];
};

const ZERO_RESULT_LAT = 0.0;
const OVER_LIMIT_LAT = -1.0;

function triggerLat(points: ParsedPoint[], target: number): boolean {
  return points.some((p) => p.kind === 'latlng' && p.value.lat === target);
}

export function shouldOverLimit(origins: ParsedPoint[], destinations: ParsedPoint[]): boolean {
  return triggerLat(origins, OVER_LIMIT_LAT) || triggerLat(destinations, OVER_LIMIT_LAT);
}

function isZeroResult(o: ParsedPoint, d: ParsedPoint): boolean {
  if (o.kind === 'invalid' || d.kind === 'invalid') return true;
  return o.value.lat === ZERO_RESULT_LAT || d.value.lat === ZERO_RESULT_LAT;
}

function metersText(meters: number): string {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

function durationText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} mins`;
}

function addressFor(point: ParsedPoint): string {
  if (point.kind === 'invalid') return point.raw;
  return `${point.value.lat.toFixed(6)},${point.value.lng.toFixed(6)}`;
}

function elementFor(origin: ParsedPoint, dest: ParsedPoint): Element {
  if (isZeroResult(origin, dest)) {
    return { status: 'ZERO_RESULTS' };
  }
  if (origin.kind === 'invalid' || dest.kind === 'invalid') {
    return { status: 'NOT_FOUND' };
  }
  const meters = Math.round(haversineMeters(origin.value, dest.value));
  const seconds = driveSeconds(meters);
  return {
    status: 'OK',
    duration: { value: seconds, text: durationText(seconds) },
    distance: { value: meters, text: metersText(meters) },
  };
}

export function buildOkResponse(
  origins: ParsedPoint[],
  destinations: ParsedPoint[],
): OkResponse {
  return {
    status: 'OK',
    origin_addresses: origins.map(addressFor),
    destination_addresses: destinations.map(addressFor),
    rows: origins.map((o) => ({
      elements: destinations.map((d) => elementFor(o, d)),
    })),
  };
}

export function buildOverQueryLimitResponse(): ErrorResponse {
  return {
    status: 'OVER_QUERY_LIMIT',
    error_message: 'You have exceeded your daily request quota for this API.',
  };
}
