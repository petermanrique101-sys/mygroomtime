import { createApp } from './app.js';

async function main(): Promise<void> {
  const port = Number(process.env.STRIPE_TWIN_PORT ?? 4242);
  const host = process.env.STRIPE_TWIN_HOST ?? '0.0.0.0';
  const webhookUrl = process.env.STRIPE_TWIN_WEBHOOK_URL ?? null;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_twin_default';
  const publicOrigin = process.env.STRIPE_TWIN_PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const { app, setPublicOrigin } = createApp({
    logger: true,
    webhookUrl,
    webhookSecret,
    publicOrigin,
  });

  try {
    await app.listen({ port, host });
    setPublicOrigin(publicOrigin);
    app.log.info({ port }, 'stripe twin listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
