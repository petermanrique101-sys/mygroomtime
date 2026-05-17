import type { FastifyReply } from 'fastify';
import type { AppointmentAddressOverride } from '@mygroomtime/shared';
import type { GeocodeAdapter, GeocodeRequestError } from '../../adapters/geocode/index.js';

export type OverrideGeocodeOutcome =
  | { ok: true; lat: number; lng: number; verified: true; warning: null }
  | { ok: true; lat: null; lng: null; verified: false; warning: string }
  | { ok: false };

const UNVERIFIED_WARNING =
  "We couldn't verify this override address. The appointment was saved — edit and re-save to retry.";

function isGeocodeError(err: unknown): err is GeocodeRequestError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'GeocodeRequestError'
  );
}

function formatOverride(addr: AppointmentAddressOverride): string {
  return `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
}

export async function geocodeOverride(
  geocode: GeocodeAdapter,
  addr: AppointmentAddressOverride,
  reply: FastifyReply,
): Promise<OverrideGeocodeOutcome> {
  try {
    const out = await geocode.geocode({ address: formatOverride(addr) });
    return { ok: true, lat: out.lat, lng: out.lng, verified: true, warning: null };
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
      reply.code(502).send({ error: 'geocode_unavailable', message: err.message });
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
