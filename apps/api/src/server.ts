import { createApp } from './app.js';

const port = Number(process.env.API_PORT ?? 3000);

const app = await createApp();

app.listen({ port, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
