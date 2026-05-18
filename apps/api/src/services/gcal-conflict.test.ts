import { describe, it, expect } from 'vitest';
import { resolveConflict, type ConflictAppointment } from './gcal-conflict.js';
import type { GcalEvent } from '../adapters/gcal/index.js';

const APPT_ID = 'appt_xyz';
const BASE_START = new Date('2026-06-01T15:00:00.000Z');

function ours(overrides: Partial<ConflictAppointment> = {}): ConflictAppointment {
  return {
    id: APPT_ID,
    scheduledStart: BASE_START,
    durationMin: 90,
    notes: 'Bring shedding rake',
    status: 'scheduled',
    updatedAt: new Date('2026-05-30T10:00:00.000Z'),
    ...overrides,
  };
}

function theirs(overrides: Partial<GcalEvent> = {}): GcalEvent {
  return {
    id: 'gcal_evt_1',
    summary: 'Full Groom — Bruno',
    description: 'Bring shedding rake\n\n1 A St',
    start: '2026-06-01T15:00:00.000Z',
    end: '2026-06-01T16:30:00.000Z',
    status: 'confirmed',
    extendedProperties: { private: { mgtAppointmentId: APPT_ID } },
    updated: '2026-05-31T10:00:00.000Z',
    ...overrides,
  };
}

describe('gcal-conflict', () => {
  it('no tag → no_tag (untagged events are ignored)', () => {
    const out = resolveConflict({
      ours: ours(),
      theirs: theirs({ extendedProperties: { private: {} } }),
    });
    expect(out.kind).toBe('no_tag');
  });

  it('wrong tag (different appointment id) → no_tag', () => {
    const out = resolveConflict({
      ours: ours(),
      theirs: theirs({ extendedProperties: { private: { mgtAppointmentId: 'other_appt' } } }),
    });
    expect(out.kind).toBe('no_tag');
  });

  it('theirs cancelled → cancel_ours regardless of timestamps', () => {
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date('2030-01-01T00:00:00Z') }),
      theirs: theirs({ status: 'cancelled' }),
    });
    expect(out.kind).toBe('cancel_ours');
  });

  it('ours newer (lexicographic) → ours_wins', () => {
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date('2026-05-31T11:00:00.000Z') }),
      theirs: theirs({ updated: '2026-05-31T10:00:00.000Z' }),
    });
    expect(out.kind).toBe('ours_wins');
  });

  it('theirs newer + start changed → theirs_wins with scheduledStart in patch', () => {
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date('2026-05-30T10:00:00.000Z') }),
      theirs: theirs({
        updated: '2026-05-31T10:00:00.000Z',
        start: '2026-06-01T16:00:00.000Z',
        end: '2026-06-01T17:30:00.000Z',
      }),
    });
    expect(out.kind).toBe('theirs_wins');
    if (out.kind === 'theirs_wins') {
      expect(out.patch.scheduledStart?.toISOString()).toBe('2026-06-01T16:00:00.000Z');
      // why: duration is unchanged in this scenario (90min before and after the shift),
      // so the patch should NOT include durationMin — only fields that actually differ.
      expect(out.patch.durationMin).toBeUndefined();
    }
  });

  it('theirs newer + duration changed → patch only includes durationMin', () => {
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date('2026-05-30T10:00:00.000Z') }),
      theirs: theirs({
        updated: '2026-05-31T10:00:00.000Z',
        end: '2026-06-01T17:00:00.000Z',
      }),
    });
    expect(out.kind).toBe('theirs_wins');
    if (out.kind === 'theirs_wins') {
      expect(out.patch.durationMin).toBe(120);
      expect(out.patch.scheduledStart).toBeUndefined();
    }
  });

  it('exact tie on timestamp → ours_wins (policy)', () => {
    const ts = '2026-05-31T10:00:00.000Z';
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date(ts) }),
      theirs: theirs({
        updated: ts,
        start: '2026-06-01T16:00:00.000Z',
        end: '2026-06-01T17:30:00.000Z',
      }),
    });
    expect(out.kind).toBe('ours_wins');
  });

  it('theirs newer but no actual differences → no_change', () => {
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date('2026-05-30T10:00:00.000Z') }),
      theirs: theirs({ updated: '2026-05-31T10:00:00.000Z' }),
    });
    expect(out.kind).toBe('no_change');
  });

  it('theirs newer + notes changed but time same → patch only includes notes', () => {
    const out = resolveConflict({
      ours: ours({ updatedAt: new Date('2026-05-30T10:00:00.000Z') }),
      theirs: theirs({
        updated: '2026-05-31T10:00:00.000Z',
        description: 'Customer requested skirt trim\n\n1 A St',
      }),
    });
    expect(out.kind).toBe('theirs_wins');
    if (out.kind === 'theirs_wins') {
      expect(out.patch.notes).toBe('Customer requested skirt trim');
      expect(out.patch.scheduledStart).toBeUndefined();
      expect(out.patch.durationMin).toBeUndefined();
    }
  });
});
