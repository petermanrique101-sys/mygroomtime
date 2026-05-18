import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  computeReminderTimestamps,
  enqueueAppointmentReminders,
  removeAppointmentReminders,
  rescheduleAppointmentReminders,
} from './reminder-schedule.js';
import { reminderJobId } from '../queue/queue-names.js';
import { makeTestReminderInfra } from '../queue/test-helpers.js';
import type { ReminderQueue } from '../queue/connection.js';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function sum(counts: Record<string, number | undefined>): number {
  return Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
}

let queue: ReminderQueue;
let close: () => Promise<void>;

beforeAll(async () => {
  const infra = await makeTestReminderInfra();
  queue = infra.queue;
  close = infra.close;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await queue.obliterate({ force: true }).catch(() => undefined);
});

describe('computeReminderTimestamps', () => {
  it('returns all three timestamps when appointment is far enough out', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 72 * HOUR);
    const ts = computeReminderTimestamps(
      { id: 'a', scheduledStart: start, durationMin: 90 },
      now,
    );
    expect(ts.fortyEightH?.getTime()).toBe(start.getTime() - 48 * HOUR);
    expect(ts.twoH?.getTime()).toBe(start.getTime() - 2 * HOUR);
    expect(ts.post?.getTime()).toBe(start.getTime() + 90 * MIN + 24 * HOUR);
  });

  it('returns null for the 48h window when appointment is <48h out', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 36 * HOUR);
    const ts = computeReminderTimestamps(
      { id: 'a', scheduledStart: start, durationMin: 60 },
      now,
    );
    expect(ts.fortyEightH).toBeNull();
    expect(ts.twoH).not.toBeNull();
    expect(ts.post).not.toBeNull();
  });

  it('returns null for both 48h and 2h when appointment is <2h out', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 30 * MIN);
    const ts = computeReminderTimestamps(
      { id: 'a', scheduledStart: start, durationMin: 60 },
      now,
    );
    expect(ts.fortyEightH).toBeNull();
    expect(ts.twoH).toBeNull();
    expect(ts.post).not.toBeNull();
  });

  it('boundary: appointment 47h59m before start gets only the 2h + post', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + (48 * HOUR - 60 * 1000));
    const ts = computeReminderTimestamps(
      { id: 'a', scheduledStart: start, durationMin: 60 },
      now,
    );
    expect(ts.fortyEightH).toBeNull();
    expect(ts.twoH).not.toBeNull();
  });
});

describe('enqueueAppointmentReminders', () => {
  it('does nothing when smsRemindersEnabled is false', async () => {
    const start = new Date(Date.now() + 72 * HOUR);
    const out = await enqueueAppointmentReminders(
      queue,
      { id: 'appt-disabled', scheduledStart: start, durationMin: 90 },
      'tenant-x',
      false,
    );
    expect(out.enqueued.length).toBe(0);
    const counts = await queue.getJobCounts('delayed', 'wait', 'active', 'completed');
    expect(sum(counts)).toBe(0);
  });

  it('creates 3 jobs with deterministic IDs and delays', async () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 72 * HOUR);
    const out = await enqueueAppointmentReminders(
      queue,
      { id: 'appt-three', scheduledStart: start, durationMin: 90 },
      'tenant-x',
      true,
      now,
    );
    expect(out.enqueued.sort()).toEqual(['reminder-2h', 'reminder-48h', 'reminder-post']);

    const j48 = await queue.getJob(reminderJobId('reminder-48h', 'appt-three'));
    const j2 = await queue.getJob(reminderJobId('reminder-2h', 'appt-three'));
    const jp = await queue.getJob(reminderJobId('reminder-post', 'appt-three'));
    expect(j48?.opts.delay).toBe(24 * HOUR);
    expect(j2?.opts.delay).toBe(70 * HOUR);
    expect(jp?.opts.delay).toBe(72 * HOUR + 90 * MIN + 24 * HOUR);
  });

  it('skips the 7d + 48h jobs for a <48h appointment but enqueues 2h + post', async () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 24 * HOUR);
    const out = await enqueueAppointmentReminders(
      queue,
      { id: 'appt-tight', scheduledStart: start, durationMin: 60 },
      'tenant-x',
      true,
      now,
    );
    expect(out.enqueued.sort()).toEqual(['reminder-2h', 'reminder-post']);
    expect(out.skipped.sort()).toEqual(['reminder-48h', 'reminder-7d']);
  });

  it('enqueues 7-day reminder when appointment is more than 7 days out', async () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 10 * 24 * HOUR);
    const out = await enqueueAppointmentReminders(
      queue,
      { id: 'appt-far-out', scheduledStart: start, durationMin: 90 },
      'tenant-x',
      true,
      now,
    );
    expect(out.enqueued).toContain('reminder-7d');
    const j7 = await queue.getJob(reminderJobId('reminder-7d', 'appt-far-out'));
    // delay = start - now - 7d = 3 days
    expect(j7?.opts.delay).toBe(3 * 24 * HOUR);
  });
});

describe('rescheduleAppointmentReminders + removeAppointmentReminders', () => {
  it('reschedule replaces old delays with new ones (no ghost jobs)', async () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    const start = new Date(now.getTime() + 72 * HOUR);
    await enqueueAppointmentReminders(
      queue,
      { id: 'appt-reschedule', scheduledStart: start, durationMin: 90 },
      'tenant-x',
      true,
      now,
    );
    const old48 = await queue.getJob(reminderJobId('reminder-48h', 'appt-reschedule'));
    expect(old48?.opts.delay).toBe(24 * HOUR);

    const newStart = new Date(now.getTime() + 96 * HOUR);
    await rescheduleAppointmentReminders(
      queue,
      { id: 'appt-reschedule', scheduledStart: newStart, durationMin: 90 },
      'tenant-x',
      true,
      now,
    );
    const new48 = await queue.getJob(reminderJobId('reminder-48h', 'appt-reschedule'));
    expect(new48?.opts.delay).toBe(48 * HOUR);

    const counts = await queue.getJobCounts('delayed', 'wait', 'active');
    expect(counts.delayed ?? 0).toBe(3);
  });

  it('cancel removes all three jobs and is idempotent', async () => {
    const start = new Date(Date.now() + 72 * HOUR);
    await enqueueAppointmentReminders(
      queue,
      { id: 'appt-cancel', scheduledStart: start, durationMin: 90 },
      'tenant-x',
      true,
    );
    await removeAppointmentReminders(queue, 'appt-cancel');
    const counts = await queue.getJobCounts('delayed', 'wait', 'active');
    expect(sum(counts)).toBe(0);

    await expect(removeAppointmentReminders(queue, 'appt-cancel')).resolves.toBeUndefined();
    await expect(removeAppointmentReminders(queue, 'never-existed')).resolves.toBeUndefined();
  });
});
