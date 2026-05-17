export type GmapsMode = 'live' | 'twin';

export type GmapsAdapterEnv = {
  mode: GmapsMode;
  apiKey: string;
  twinUrl: string;
};

export type GmapsElementStatus =
  | 'OK'
  | 'NOT_FOUND'
  | 'ZERO_RESULTS'
  | 'MAX_ROUTE_LENGTH_EXCEEDED'
  | 'OVER_DAILY_LIMIT'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_ERROR';

export type DistanceMatrixElement = {
  durationSec: number;
  distanceM: number;
  status: GmapsElementStatus;
};

export type DistanceMatrixInput = {
  origins: string[];
  destinations: string[];
};
export type DistanceMatrixOutput = {
  rows: DistanceMatrixElement[][];
};

export interface GmapsAdapter {
  readonly mode: GmapsMode;
  distanceMatrix(input: DistanceMatrixInput): Promise<DistanceMatrixOutput>;
}

export type GmapsTopLevelStatus =
  | 'OK'
  | 'INVALID_REQUEST'
  | 'MAX_ELEMENTS_EXCEEDED'
  | 'OVER_DAILY_LIMIT'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'UNKNOWN_ERROR';

export type GmapsWireElement = {
  status: string;
  duration?: { value: number; text: string };
  distance?: { value: number; text: string };
};

export type GmapsWireRow = { elements: GmapsWireElement[] };

export type GmapsWireResponse = {
  status: string;
  error_message?: string;
  rows?: GmapsWireRow[];
};

export class GmapsRequestError extends Error {
  constructor(
    message: string,
    readonly status: GmapsTopLevelStatus,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'GmapsRequestError';
  }
}
