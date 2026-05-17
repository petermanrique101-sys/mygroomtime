import type { FastifyInstance } from 'fastify';
import signupRoute from './signup.js';
import loginRoute from './login.js';
import logoutRoute from './logout.js';
import meRoute from './me.js';
import magicLinkRoutes from './magic-link.js';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  await signupRoute(app);
  await loginRoute(app);
  await logoutRoute(app);
  await meRoute(app);
  await magicLinkRoutes(app);
}
