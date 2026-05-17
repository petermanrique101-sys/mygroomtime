import type { LatLng } from './haversine.js';

export type ParsedPoint =
  | { kind: 'latlng'; value: LatLng; raw: string }
  | { kind: 'invalid'; raw: string };

export function parsePoints(input: string): ParsedPoint[] {
  return input
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseSinglePoint);
}

function parseSinglePoint(raw: string): ParsedPoint {
  const [latStr, lngStr, ...rest] = raw.split(',');
  if (latStr === undefined || lngStr === undefined || rest.length > 0) {
    return { kind: 'invalid', raw };
  }
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { kind: 'invalid', raw };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { kind: 'invalid', raw };
  }
  return { kind: 'latlng', value: { lat, lng }, raw };
}
