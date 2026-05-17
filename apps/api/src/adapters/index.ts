import type { AppEnv } from '../config/env.js';
import { createStripeAdapter, type StripeAdapter } from './stripe/index.js';
import { createTwilioAdapter, type TwilioAdapter } from './twilio/index.js';
import { createGcalAdapter, type GcalAdapter } from './gcal/index.js';
import { createGmapsAdapter, type GmapsAdapter } from './gmaps/index.js';
import { createGeocodeAdapter, type GeocodeAdapter } from './geocode/index.js';
import {
  createMemorySessionStore,
  createRedisSessionStore,
  type SessionStore,
} from './session/index.js';
import { createStdoutEmailAdapter, type EmailAdapter } from './email/index.js';

export type Adapters = {
  stripe: StripeAdapter;
  twilio: TwilioAdapter;
  gcal: GcalAdapter;
  gmaps: GmapsAdapter;
  geocode: GeocodeAdapter;
  email: EmailAdapter;
  session: SessionStore;
};

export type CreateAdaptersOverrides = Partial<Adapters>;

export function createAdapters(env: AppEnv, overrides: CreateAdaptersOverrides = {}): Adapters {
  const session =
    overrides.session ??
    (env.nodeEnv === 'test'
      ? createMemorySessionStore()
      : createRedisSessionStore(env.redisUrl));

  return {
    stripe: overrides.stripe ?? createStripeAdapter(env.stripe),
    twilio: overrides.twilio ?? createTwilioAdapter(env.twilio),
    gcal: overrides.gcal ?? createGcalAdapter(env.gcal),
    gmaps: overrides.gmaps ?? createGmapsAdapter(env.gmaps),
    geocode: overrides.geocode ?? createGeocodeAdapter(env.geocode),
    email: overrides.email ?? createStdoutEmailAdapter(),
    session,
  };
}
