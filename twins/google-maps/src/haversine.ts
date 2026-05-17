const EARTH_RADIUS_M = 6_371_000;
const URBAN_KMH = 35;
const STOP_OVERHEAD_SEC = 60;

export type LatLng = { lat: number; lng: number };

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function driveSeconds(meters: number): number {
  const km = meters / 1000;
  const travelSec = (km / URBAN_KMH) * 3600;
  return Math.round(travelSec + STOP_OVERHEAD_SEC);
}
