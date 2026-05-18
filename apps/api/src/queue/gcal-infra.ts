import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { AppEnv } from '../config/env.js';
import type { Adapters } from '../adapters/index.js';
import { createReminderRedis } from './connection.js';
import type { ReminderQueue } from './connection.js';
import {
  createGcalPullQueue,
  createGcalPullWorker,
  createGcalPushQueue,
  createGcalPushWorker,
  createGcalRenewQueue,
  createGcalRenewWorker,
  type GcalPullQueue,
  type GcalPullWorker,
  type GcalPushQueue,
  type GcalPushWorker,
  type GcalRenewQueue,
  type GcalRenewWorker,
} from './gcal-connection.js';
import { createGcalPushHandler } from './gcal-push-worker.js';
import { createGcalPullHandler } from './gcal-pull-worker.js';
import { createGcalRenewHandler } from './gcal-renew-worker.js';
import { GCAL_RENEW_JOB_NAME } from './queue-names.js';

export type GcalInfra = {
  pushQueue: GcalPushQueue;
  pushWorker: GcalPushWorker | null;
  pullQueue: GcalPullQueue;
  pullWorker: GcalPullWorker | null;
  renewQueue: GcalRenewQueue;
  renewWorker: GcalRenewWorker | null;
  cacheRedis: Redis | null;
  connections: Redis[];
};

export type BuildGcalInfraArgs = {
  env: AppEnv;
  adapters: Adapters;
  reminderQueue: ReminderQueue | null;
  log: FastifyBaseLogger;
};

export async function buildGcalInfra(args: BuildGcalInfraArgs): Promise<GcalInfra> {
  const { env, adapters, reminderQueue, log } = args;
  const connections: Redis[] = [];
  const mkConn = (): Redis => {
    const c = createReminderRedis(env.redisUrl);
    connections.push(c);
    return c;
  };
  const cacheRedis = mkConn();

  const pushQueue = createGcalPushQueue(mkConn());
  const pushWorker = createGcalPushWorker(
    mkConn(),
    createGcalPushHandler({
      gcal: adapters.gcal,
      redis: cacheRedis,
      encryptionKey: env.gcal.tokenEncryptionKey,
      log,
    }),
  );

  const pullQueue = createGcalPullQueue(mkConn());
  const pullWorker = createGcalPullWorker(
    mkConn(),
    createGcalPullHandler({
      gcal: adapters.gcal,
      redis: cacheRedis,
      encryptionKey: env.gcal.tokenEncryptionKey,
      reminderQueue,
      log,
    }),
  );

  const renewQueue = createGcalRenewQueue(mkConn());
  const renewWorker = createGcalRenewWorker(
    mkConn(),
    createGcalRenewHandler({
      gcal: adapters.gcal,
      redis: cacheRedis,
      encryptionKey: env.gcal.tokenEncryptionKey,
      webhookUrl: env.gcal.webhookUrl,
      log,
    }),
  );
  await renewQueue.add(
    GCAL_RENEW_JOB_NAME,
    { tick: Date.now() },
    { repeat: { pattern: '0 3 * * *' }, removeOnComplete: 100, removeOnFail: 100 },
  );

  return {
    pushQueue,
    pushWorker,
    pullQueue,
    pullWorker,
    renewQueue,
    renewWorker,
    cacheRedis,
    connections,
  };
}

export async function closeGcalInfraInline(infra: GcalInfra): Promise<void> {
  const closers: Promise<unknown>[] = [
    infra.pushWorker ? infra.pushWorker.close() : Promise.resolve(),
    infra.pushQueue.close(),
    infra.pullWorker ? infra.pullWorker.close() : Promise.resolve(),
    infra.pullQueue.close(),
    infra.renewWorker ? infra.renewWorker.close() : Promise.resolve(),
    infra.renewQueue.close(),
    ...infra.connections.map((c) => c.quit().catch(() => undefined)),
  ];
  await Promise.all(closers);
}
