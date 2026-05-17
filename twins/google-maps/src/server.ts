import { createApp } from './app.js';

function parseRateLimit(argv: readonly string[]): number | null {
  const idx = argv.findIndex((a) => a === '--rate-limit');
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main(): Promise<void> {
  const port = Number(process.env.GMAPS_TWIN_PORT ?? 4245);
  const host = process.env.GMAPS_TWIN_HOST ?? '0.0.0.0';
  const rateLimitPerSecond = parseRateLimit(process.argv.slice(2));

  const app = createApp({ logger: true, rateLimitPerSecond });

  try {
    await app.listen({ port, host });
    app.log.info(
      { port, rateLimitPerSecond },
      'google-maps twin listening',
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
