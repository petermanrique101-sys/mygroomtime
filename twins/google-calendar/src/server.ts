import { createApp } from './app.js';

async function main(): Promise<void> {
  const port = Number(process.env.GCAL_TWIN_PORT ?? 4244);
  const host = process.env.GCAL_TWIN_HOST ?? '0.0.0.0';
  const publicOrigin = process.env.GCAL_TWIN_PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const { app } = createApp({ logger: true, publicOrigin });

  try {
    await app.listen({ port, host });
    app.log.info({ port }, 'google-calendar twin listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
