import { createApp } from './app.js';

async function main(): Promise<void> {
  const port = Number(process.env.GEOCODE_TWIN_PORT ?? 4246);
  const host = process.env.GEOCODE_TWIN_HOST ?? '0.0.0.0';

  const app = createApp({ logger: true });

  try {
    await app.listen({ port, host });
    app.log.info({ port }, 'geocode twin listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
