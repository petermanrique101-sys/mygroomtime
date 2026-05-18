import { describe, it, expect } from 'vitest';
import { AppointmentStatus } from '@mygroomtime/db';
import {
  assertTransitionAllowed,
  getValidNextStatuses,
  isTerminal,
  TransitionError,
} from './status-transitions.js';

describe('status-transitions', () => {
  describe('getValidNextStatuses', () => {
    it('scheduled -> on_the_way / started / canceled / no_show', () => {
      expect(new Set(getValidNextStatuses(AppointmentStatus.scheduled))).toEqual(
        new Set([
          AppointmentStatus.on_the_way,
          AppointmentStatus.started,
          AppointmentStatus.canceled,
          AppointmentStatus.no_show,
        ]),
      );
    });

    it('on_the_way -> started / canceled / no_show (no back-to-scheduled)', () => {
      expect(new Set(getValidNextStatuses(AppointmentStatus.on_the_way))).toEqual(
        new Set([
          AppointmentStatus.started,
          AppointmentStatus.canceled,
          AppointmentStatus.no_show,
        ]),
      );
    });

    it('started -> completed only', () => {
      expect(getValidNextStatuses(AppointmentStatus.started)).toEqual([
        AppointmentStatus.completed,
      ]);
    });

    it('terminal states return empty list', () => {
      expect(getValidNextStatuses(AppointmentStatus.completed)).toEqual([]);
      expect(getValidNextStatuses(AppointmentStatus.canceled)).toEqual([]);
      expect(getValidNextStatuses(AppointmentStatus.no_show)).toEqual([]);
    });
  });

  describe('isTerminal', () => {
    it('completed/canceled/no_show are terminal', () => {
      expect(isTerminal(AppointmentStatus.completed)).toBe(true);
      expect(isTerminal(AppointmentStatus.canceled)).toBe(true);
      expect(isTerminal(AppointmentStatus.no_show)).toBe(true);
    });
    it('active states are not terminal', () => {
      expect(isTerminal(AppointmentStatus.scheduled)).toBe(false);
      expect(isTerminal(AppointmentStatus.on_the_way)).toBe(false);
      expect(isTerminal(AppointmentStatus.started)).toBe(false);
    });
  });

  describe('assertTransitionAllowed — full matrix', () => {
    const all = Object.values(AppointmentStatus) as AppointmentStatus[];
    const valid = new Set<string>([
      `${AppointmentStatus.scheduled}->${AppointmentStatus.on_the_way}`,
      `${AppointmentStatus.scheduled}->${AppointmentStatus.started}`,
      `${AppointmentStatus.scheduled}->${AppointmentStatus.canceled}`,
      `${AppointmentStatus.scheduled}->${AppointmentStatus.no_show}`,
      `${AppointmentStatus.on_the_way}->${AppointmentStatus.started}`,
      `${AppointmentStatus.on_the_way}->${AppointmentStatus.canceled}`,
      `${AppointmentStatus.on_the_way}->${AppointmentStatus.no_show}`,
      `${AppointmentStatus.started}->${AppointmentStatus.completed}`,
    ]);

    for (const from of all) {
      for (const to of all) {
        const key = `${from}->${to}`;
        if (valid.has(key)) {
          it(`allows ${key}`, () => {
            expect(() => assertTransitionAllowed(from, to)).not.toThrow();
          });
        } else {
          it(`rejects ${key}`, () => {
            expect(() => assertTransitionAllowed(from, to)).toThrowError(TransitionError);
          });
        }
      }
    }
  });

  it('TransitionError carries reason+current+attempted', () => {
    try {
      assertTransitionAllowed(AppointmentStatus.completed, AppointmentStatus.started);
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      const te = e as TransitionError;
      expect(te.reason).toBe('terminal');
      expect(te.current).toBe(AppointmentStatus.completed);
      expect(te.attempted).toBe(AppointmentStatus.started);
    }
  });
});
