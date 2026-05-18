import type { FastifyReply } from 'fastify';
import type { GeocodeAdapter, GeocodeRequestError } from '../../adapters/geocode/index.js';

export type PublicGeocodeInput = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type PublicGeocodeOutcome =
  | { ok: true; lat: number; lng: number }
  | { ok: false };

function isGeocodeError(err: unknown): err is GeocodeRequestError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'GeocodeRequestError'
  );
}

export async function geocodePublicAddress(
  geocode: GeocodeAdapter,
  addr: PublicGeocodeInput,
  reply: FastifyReply,
): Promise<PublicGeocodeOutcome> {
  const address = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`;
  try {
    const out = await geocode.geocode({ address });
    return { ok: true, lat: out.lat, lng: out.lng };
  } catch (err) {
    if (isGeocodeError(err)) {
      // why: customer-submitted addresses must be verifiable before we charge a deposit.
      // Unlike groomer-side client save (chunk 6, addressVerified=false fallback), the
      // public booking page can't proceed unverified — the deposit + drive-time math
      // both depend on real coords.
      if (err.status === 'ZERO_RESULTS') {
        reply.code(400).send({
          error: 'address_unverified',
          message: "Couldn't verify your address — please check the zip code.",
        });
        return { ok: false };
      }
      reply.code(502).send({
        error: 'geocode_unavailable',
        message: 'Address lookup is temporarily unavailable. Please try again in a moment.',
      });
      return { ok: false };
    }
    reply.code(502).send({
      error: 'geocode_unavailable',
      message: 'Address lookup is temporarily unavailable. Please try again in a moment.',
    });
    return { ok: false };
  }
}
