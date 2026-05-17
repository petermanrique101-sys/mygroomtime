export type AdapterMode = 'live' | 'twin';

export type StripeEnv = {
  mode: AdapterMode;
  secretKey: string;
  webhookSecret: string;
  twinUrl: string;
  priceIdStarter: string;
  priceIdPro: string;
  priceIdBusiness: string;
};

export type TwilioEnv = {
  mode: AdapterMode;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  twinUrl: string;
};

export type GcalEnv = {
  mode: AdapterMode;
  oauthClientId: string;
  oauthClientSecret: string;
  twinUrl: string;
};

export type GmapsEnv = {
  mode: AdapterMode;
  apiKey: string;
  twinUrl: string;
};

export type GeocodeEnv = {
  mode: AdapterMode;
  apiKey: string;
  twinUrl: string;
};

export type AppEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  webOrigin: string;
  cookieSecret: string;
  magicLinkSecret: string;
  redisUrl: string;
  stripe: StripeEnv;
  twilio: TwilioEnv;
  gcal: GcalEnv;
  gmaps: GmapsEnv;
  geocode: GeocodeEnv;
};

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

function pickMode(key: string, defaultMode: AdapterMode): AdapterMode {
  const raw = process.env[key];
  if (raw === 'live') return 'live';
  if (raw === 'twin') return 'twin';
  if (raw === undefined || raw === '') return defaultMode;
  throw new Error(`Invalid value for ${key}: expected 'live' or 'twin', got '${raw}'`);
}

export function loadEnv(): AppEnv {
  const rawNodeEnv = process.env.NODE_ENV ?? 'development';
  const nodeEnv: AppEnv['nodeEnv'] =
    rawNodeEnv === 'production' ? 'production' : rawNodeEnv === 'test' ? 'test' : 'development';

  const isProd = nodeEnv === 'production';
  const devFallback = isProd ? undefined : 'dev-only-not-secret-replace-in-prod-32chars!!';
  const defaultMode: AdapterMode = isProd ? 'live' : 'twin';

  return {
    nodeEnv,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    cookieSecret: required('COOKIE_SECRET', devFallback),
    magicLinkSecret: required('MAGIC_LINK_SECRET', devFallback),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    stripe: {
      mode: pickMode('STRIPE_MODE', defaultMode),
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_twin_default',
      twinUrl: process.env.STRIPE_TWIN_URL ?? 'http://localhost:4242',
      priceIdStarter: process.env.STRIPE_PRICE_ID_STARTER ?? 'price_starter_twin',
      priceIdPro: process.env.STRIPE_PRICE_ID_PRO ?? 'price_pro_twin',
      priceIdBusiness: process.env.STRIPE_PRICE_ID_BUSINESS ?? 'price_business_twin',
    },
    twilio: {
      mode: pickMode('TWILIO_MODE', defaultMode),
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      fromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
      twinUrl: process.env.TWILIO_TWIN_URL ?? 'http://localhost:4243',
    },
    gcal: {
      mode: pickMode('GCAL_MODE', defaultMode),
      oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      twinUrl: process.env.GCAL_TWIN_URL ?? 'http://localhost:4244',
    },
    gmaps: {
      mode: pickMode('GMAPS_MODE', defaultMode),
      apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
      twinUrl: process.env.GMAPS_TWIN_URL ?? 'http://localhost:4245',
    },
    geocode: {
      mode: pickMode('GEOCODE_MODE', defaultMode),
      apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
      twinUrl: process.env.GEOCODE_TWIN_URL ?? 'http://localhost:4246',
    },
  };
}
