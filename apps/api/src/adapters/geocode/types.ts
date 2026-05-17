export type GeocodeMode = 'live' | 'twin';

export type GeocodeAdapterEnv = {
  mode: GeocodeMode;
  apiKey: string;
  twinUrl: string;
};

export type GeocodeStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR';

export type GeocodeInput = {
  address: string;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
  placeId: string;
};

export interface GeocodeAdapter {
  readonly mode: GeocodeMode;
  geocode(input: GeocodeInput): Promise<GeocodeResult>;
}

export type GeocodeWireAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

export type GeocodeWireResult = {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  place_id?: string;
  address_components?: GeocodeWireAddressComponent[];
};

export type GeocodeWireResponse = {
  status?: string;
  error_message?: string;
  results?: GeocodeWireResult[];
};

export class GeocodeRequestError extends Error {
  constructor(
    message: string,
    readonly status: GeocodeStatus,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'GeocodeRequestError';
  }
}
