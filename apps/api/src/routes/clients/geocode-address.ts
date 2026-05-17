import type { FastifyReply } from 'fastify';
import type { ClientAddress } from '@mygroomtime/shared';
import type { GeocodeAdapter, GeocodeRequestError } from '../../adapters/geocode/index.js';

export type GeocodeOutcome =
  | { ok: true; lat: number; lng: number; verified: true }
  | { ok: true; lat: null; lng: null; verified: false; warning: string }
  | { ok: false };

const UNVERIFIED_WARNING =
  "We couldn't verify this address. The client was saved — edit and re-save to retry.";

function isGeocodeError(err: unknown): err is GeocodeRequestError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'GeocodeRequestError'
  );
}

export function formatAddress(addr: ClientAddress): string {
  return `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
}

export async function geocodeOnWrite(
  geocode: GeocodeAdapter,
  addr: ClientAddress,
  reply: FastifyReply,
): Promise<GeocodeOutcome> {
  try {
    const out = await geocode.geocode({ address: formatAddress(addr) });
    return { ok: true, lat: out.lat, lng: out.lng, verified: true };
  } catch (err) {
    if (isGeocodeError(err)) {
      if (err.status === 'ZERO_RESULTS') {
        return {
          ok: true,
          lat: null,
          lng: null,
          verified: false,
          warning: UNVERIFIED_WARNING,
        };
      }
      reply.code(502).send({
        error: 'geocode_unavailable',
        message: err.message,
      });
      return { ok: false };
    }
    reply.code(502).send({
      error: 'geocode_unavailable',
      message:
        'Address lookup is temporarily unavailable. Please try again in a moment.',
    });
    return { ok: false };
  }
}
