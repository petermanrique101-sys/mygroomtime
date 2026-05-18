import { createApp } from './app.js';

async function main(): Promise<void> {
  const port = Number(process.env.TWILIO_TWIN_PORT ?? 4243);
  const host = process.env.TWILIO_TWIN_HOST ?? '0.0.0.0';
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? 'auth_twin_default';
  const fromNumber = process.env.TWILIO_FROM_NUMBER ?? '+15555550100';
  const inboundWebhookUrl = process.env.TWILIO_TWIN_INBOUND_WEBHOOK_URL ?? null;

  const { app } = createApp({
    logger: true,
    authToken,
    fromNumber,
    inboundWebhookUrl,
  });

  try {
    await app.listen({ port, host });
    app.log.info({ port }, 'twilio twin listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
