import { fnv1aHex, offsetFromHash } from './hash.js';
import { parseAddress, extractZip } from './parse.js';
import { lookupZip, type ZipCentroid } from './zip-table.js';

const OFFSET_ENVELOPE_DEG = 0.005;

export type GeocodeStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR';

export type GeocodeAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

export type GeocodeResult = {
  formatted_address: string;
  geometry: {
    location: { lat: number; lng: number };
    location_type: 'ROOFTOP';
  };
  place_id: string;
  address_components: GeocodeAddressComponent[];
};

export type GeocodeResponseBody = {
  status: GeocodeStatus;
  results: GeocodeResult[];
  error_message?: string;
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function formattedAddress(address: string, centroid: ZipCentroid): string {
  const parts = parseAddress(address);
  const streetPart = parts.streetNumber && parts.street
    ? `${parts.streetNumber} ${parts.street}`
    : (parts.street ?? address.split(',')[0]?.trim() ?? '');
  return `${streetPart}, ${centroid.city}, ${centroid.state} ${centroid.zip}, USA`;
}

function components(address: string, centroid: ZipCentroid): GeocodeAddressComponent[] {
  const parts = parseAddress(address);
  const comps: GeocodeAddressComponent[] = [];
  if (parts.streetNumber) {
    comps.push({
      long_name: parts.streetNumber,
      short_name: parts.streetNumber,
      types: ['street_number'],
    });
  }
  if (parts.street) {
    comps.push({ long_name: parts.street, short_name: parts.street, types: ['route'] });
  }
  comps.push({ long_name: centroid.city, short_name: centroid.city, types: ['locality'] });
  comps.push({
    long_name: stateLongName(centroid.state),
    short_name: centroid.state,
    types: ['administrative_area_level_1'],
  });
  comps.push({ long_name: centroid.zip, short_name: centroid.zip, types: ['postal_code'] });
  return comps;
}

function stateLongName(short: string): string {
  if (short === 'TX') return 'Texas';
  return short;
}

export function buildOkResponse(address: string): GeocodeResponseBody {
  const zip = extractZip(address);
  if (!zip) {
    return { status: 'ZERO_RESULTS', results: [] };
  }
  const centroid = lookupZip(zip);
  if (!centroid) {
    return { status: 'ZERO_RESULTS', results: [] };
  }
  const { latOff, lngOff } = offsetFromHash(address, OFFSET_ENVELOPE_DEG);
  const lat = round6(centroid.lat + latOff);
  const lng = round6(centroid.lng + lngOff);
  const result: GeocodeResult = {
    formatted_address: formattedAddress(address, centroid),
    geometry: {
      location: { lat, lng },
      location_type: 'ROOFTOP',
    },
    place_id: `twin_place_${fnv1aHex(address)}`,
    address_components: components(address, centroid),
  };
  return { status: 'OK', results: [result] };
}

export function buildStatusOnly(status: GeocodeStatus, message?: string): GeocodeResponseBody {
  const body: GeocodeResponseBody = { status, results: [] };
  if (message) body.error_message = message;
  return body;
}
