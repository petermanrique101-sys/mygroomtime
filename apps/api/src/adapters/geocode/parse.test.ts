import { describe, it, expect } from 'vitest';
import { parseGeocodeResponse } from './parse.js';
import { GeocodeRequestError, type GeocodeWireResponse } from './types.js';

describe('parseGeocodeResponse', () => {
  it('maps an OK response to a normalized result', () => {
    const wire: GeocodeWireResponse = {
      status: 'OK',
      results: [
        {
          formatted_address: '1234 Oak St, Plano, TX 75024, USA',
          geometry: { location: { lat: 33.08, lng: -96.81 } },
          place_id: 'twin_place_abcd1234',
        },
      ],
    };
    const out = parseGeocodeResponse(wire);
    expect(out).toEqual({
      lat: 33.08,
      lng: -96.81,
      formattedAddress: '1234 Oak St, Plano, TX 75024, USA',
      placeId: 'twin_place_abcd1234',
    });
  });

  it('throws GeocodeRequestError on ZERO_RESULTS with a user-actionable message', () => {
    const wire: GeocodeWireResponse = { status: 'ZERO_RESULTS', results: [] };
    try {
      parseGeocodeResponse(wire);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GeocodeRequestError);
      const e = err as GeocodeRequestError;
      expect(e.status).toBe('ZERO_RESULTS');
      expect(e.message).toMatch(/zip/i);
    }
  });

  it('throws GeocodeRequestError on REQUEST_DENIED', () => {
    const wire: GeocodeWireResponse = { status: 'REQUEST_DENIED' };
    expect(() => parseGeocodeResponse(wire)).toThrow(GeocodeRequestError);
  });

  it('coerces an unknown status to UNKNOWN_ERROR', () => {
    const wire: GeocodeWireResponse = { status: 'TOTALLY_MADE_UP' };
    try {
      parseGeocodeResponse(wire);
      expect.fail('expected throw');
    } catch (err) {
      expect((err as GeocodeRequestError).status).toBe('UNKNOWN_ERROR');
    }
  });

  it('throws when OK but no results array entries', () => {
    const wire: GeocodeWireResponse = { status: 'OK', results: [] };
    expect(() => parseGeocodeResponse(wire)).toThrow(GeocodeRequestError);
  });

  it('throws when result has no coordinates', () => {
    const wire: GeocodeWireResponse = {
      status: 'OK',
      results: [{ formatted_address: 'X', geometry: {}, place_id: 'p' }],
    };
    expect(() => parseGeocodeResponse(wire)).toThrow(/coordinates/);
  });
});
