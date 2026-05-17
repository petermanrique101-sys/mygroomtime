import type {
  DistanceMatrixElement,
  DistanceMatrixOutput,
  GmapsElementStatus,
  GmapsTopLevelStatus,
  GmapsWireElement,
  GmapsWireResponse,
} from './types.js';
import { GmapsRequestError } from './types.js';

const TOP_LEVEL_STATUSES: ReadonlySet<GmapsTopLevelStatus> = new Set([
  'OK',
  'INVALID_REQUEST',
  'MAX_ELEMENTS_EXCEEDED',
  'OVER_DAILY_LIMIT',
  'OVER_QUERY_LIMIT',
  'REQUEST_DENIED',
  'UNKNOWN_ERROR',
]);

const ELEMENT_STATUSES: ReadonlySet<GmapsElementStatus> = new Set([
  'OK',
  'NOT_FOUND',
  'ZERO_RESULTS',
  'MAX_ROUTE_LENGTH_EXCEEDED',
  'OVER_DAILY_LIMIT',
  'OVER_QUERY_LIMIT',
  'REQUEST_DENIED',
  'INVALID_REQUEST',
  'UNKNOWN_ERROR',
]);

function normalizeTopLevel(raw: string): GmapsTopLevelStatus {
  return TOP_LEVEL_STATUSES.has(raw as GmapsTopLevelStatus)
    ? (raw as GmapsTopLevelStatus)
    : 'UNKNOWN_ERROR';
}

function normalizeElementStatus(raw: string | undefined): GmapsElementStatus {
  if (raw === undefined) return 'UNKNOWN_ERROR';
  return ELEMENT_STATUSES.has(raw as GmapsElementStatus)
    ? (raw as GmapsElementStatus)
    : 'UNKNOWN_ERROR';
}

function parseElement(el: GmapsWireElement): DistanceMatrixElement {
  const status = normalizeElementStatus(el.status);
  if (status === 'OK') {
    return {
      status,
      durationSec: el.duration?.value ?? 0,
      distanceM: el.distance?.value ?? 0,
    };
  }
  return { status, durationSec: 0, distanceM: 0 };
}

export function parseDistanceMatrixResponse(
  wire: GmapsWireResponse,
): DistanceMatrixOutput {
  const status = normalizeTopLevel(wire.status);
  if (status !== 'OK') {
    throw new GmapsRequestError(
      wire.error_message ?? `Google Maps Distance Matrix returned ${status}`,
      status,
    );
  }
  const rows = wire.rows ?? [];
  return {
    rows: rows.map((row) => row.elements.map(parseElement)),
  };
}
