import type { AppEnv, AdapterMode } from '../config/env.js';

export type TestEnvOverrides = {
  stripeMode?: AdapterMode;
  twilioMode?: AdapterMode;
  gcalMode?: AdapterMode;
  gmapsMode?: AdapterMode;
  geocodeMode?: AdapterMode;
};

export function makeTestEnv(overrides: TestEnvOverrides = {}): AppEnv {
  return {
    nodeEnv: 'test',
    webOrigin: 'http://localhost:5173',
    cookieSecret: 'test-cookie-secret-32-bytes-padding',
    magicLinkSecret: 'test-magic-secret-32-bytes-padding!',
    rescheduleTokenSecret: 'test-reschedule-secret-32-bytes-pad',
    redisUrl: 'redis://unused',
    stripe: {
      mode: overrides.stripeMode ?? 'twin',
      secretKey: 'sk_test_unused',
      webhookSecret: 'whsec_test_unused',
      twinUrl: 'http://localhost:4242',
      priceIdStarter: 'price_starter_twin',
      priceIdPro: 'price_pro_twin',
      priceIdBusiness: 'price_business_twin',
    },
    twilio: {
      mode: overrides.twilioMode ?? 'twin',
      accountSid: 'AC_test_unused',
      authToken: 'test_unused',
      fromNumber: '+15555550100',
      twinUrl: 'http://localhost:4243',
    },
    gcal: {
      mode: overrides.gcalMode ?? 'twin',
      oauthClientId: 'test-client-id',
      oauthClientSecret: 'test-client-secret',
      twinUrl: 'http://localhost:4244',
    },
    gmaps: {
      mode: overrides.gmapsMode ?? 'twin',
      apiKey: 'test-maps-key',
      twinUrl: 'http://localhost:4245',
    },
    geocode: {
      mode: overrides.geocodeMode ?? 'twin',
      apiKey: 'test-maps-key',
      twinUrl: 'http://localhost:4246',
    },
  };
}
