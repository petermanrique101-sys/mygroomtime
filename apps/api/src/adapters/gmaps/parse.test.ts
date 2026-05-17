import { describe, it, expect } from 'vitest';
import { parseDistanceMatrixResponse } from './parse.js';
import { GmapsRequestError, type GmapsWireResponse } from './types.js';

describe('parseDistanceMatrixResponse', () => {
  it('maps an OK element to durationSec + distanceM', () => {
    const wire: GmapsWireResponse = {
      status: 'OK',
      rows: [
        {
          elements: [
            { status: 'OK', duration: { value: 720, text: '12 mins' }, distance: { value: 5400, text: '3.4 mi' } },
          ],
        },
      ],
    };
    const out = parseDistanceMatrixResponse(wire);
    expect(out.rows[0]![0]).toEqual({ status: 'OK', durationSec: 720, distanceM: 5400 });
  });

  it('maps a ZERO_RESULTS element to zeros with status preserved', () => {
    const wire: GmapsWireResponse = {
      status: 'OK',
      rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }],
    };
    const out = parseDistanceMatrixResponse(wire);
    expect(out.rows[0]![0]).toEqual({ status: 'ZERO_RESULTS', durationSec: 0, distanceM: 0 });
  });

  it('handles mixed rows in a single response', () => {
    const wire: GmapsWireResponse = {
      status: 'OK',
      rows: [
        {
          elements: [
            { status: 'OK', duration: { value: 100, text: '2 mins' }, distance: { value: 1000, text: '0.6 mi' } },
            { status: 'ZERO_RESULTS' },
          ],
        },
        {
          elements: [
            { status: 'NOT_FOUND' },
            { status: 'OK', duration: { value: 200, text: '3 mins' }, distance: { value: 2000, text: '1.2 mi' } },
          ],
        },
      ],
    };
    const out = parseDistanceMatrixResponse(wire);
    expect(out.rows.length).toBe(2);
    expect(out.rows[0]![0]!.status).toBe('OK');
    expect(out.rows[0]![1]!.status).toBe('ZERO_RESULTS');
    expect(out.rows[1]![0]!.status).toBe('NOT_FOUND');
    expect(out.rows[1]![1]!.durationSec).toBe(200);
  });

  it('defaults missing duration/distance fields on an OK element to 0', () => {
    const wire: GmapsWireResponse = {
      status: 'OK',
      rows: [{ elements: [{ status: 'OK' }] }],
    };
    const out = parseDistanceMatrixResponse(wire);
    expect(out.rows[0]![0]).toEqual({ status: 'OK', durationSec: 0, distanceM: 0 });
  });

  it('throws GmapsRequestError on a non-OK top-level status', () => {
    const wire: GmapsWireResponse = {
      status: 'OVER_QUERY_LIMIT',
      error_message: 'quota exceeded',
    };
    expect(() => parseDistanceMatrixResponse(wire)).toThrow(GmapsRequestError);
  });

  it('coerces an unknown element status to UNKNOWN_ERROR', () => {
    const wire: GmapsWireResponse = {
      status: 'OK',
      rows: [{ elements: [{ status: 'TOTALLY_MADE_UP' }] }],
    };
    const out = parseDistanceMatrixResponse(wire);
    expect(out.rows[0]![0]!.status).toBe('UNKNOWN_ERROR');
  });
});
