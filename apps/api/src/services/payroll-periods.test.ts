import { describe, it, expect } from 'vitest';
import { PayrollPeriodKind } from '@mygroomtime/db';
import { computePeriods, periodContaining } from './payroll-periods.js';

describe('payroll-periods', () => {
  it('weekly periods snap to ISO Monday and have 7-day stride', () => {
    // 2026-05-18 is a Monday
    const from = new Date(Date.UTC(2026, 4, 18));
    const to = new Date(Date.UTC(2026, 5, 8));
    const periods = computePeriods({
      kind: PayrollPeriodKind.weekly,
      anchor: null,
      from,
      to,
    });
    expect(periods.length).toBeGreaterThanOrEqual(3);
    for (const p of periods) {
      const start = new Date(p.periodStart);
      const end = new Date(p.periodEnd);
      expect(start.getUTCDay()).toBe(1); // Monday
      expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(p.kind).toBe('weekly');
    }
  });

  it('weekly target on a Wednesday snaps back to that week\'s Monday', () => {
    const wed = new Date(Date.UTC(2026, 4, 20));
    const period = periodContaining({
      kind: PayrollPeriodKind.weekly,
      anchor: null,
      target: wed,
    });
    expect(period.start.getUTCDay()).toBe(1);
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-05-18');
  });

  it('biweekly uses the tenant anchor and walks in 14-day strides', () => {
    const anchor = new Date(Date.UTC(2026, 0, 5)); // 2026-01-05
    const from = new Date(Date.UTC(2026, 5, 1));
    const to = new Date(Date.UTC(2026, 6, 1));
    const periods = computePeriods({
      kind: PayrollPeriodKind.biweekly,
      anchor,
      from,
      to,
    });
    expect(periods.length).toBeGreaterThanOrEqual(2);
    for (const p of periods) {
      const start = new Date(p.periodStart);
      const end = new Date(p.periodEnd);
      const days = Math.round((start.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000));
      // why: every biweekly period start is anchor + N*14 days
      expect(days % 14).toBe(0);
      expect(end.getTime() - start.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    }
  });

  it('biweekly with null anchor uses the default Y2K-week-1 anchor deterministically', () => {
    const target = new Date(Date.UTC(2026, 4, 20));
    const a = periodContaining({
      kind: PayrollPeriodKind.biweekly,
      anchor: null,
      target,
    });
    const b = periodContaining({
      kind: PayrollPeriodKind.biweekly,
      anchor: null,
      target,
    });
    expect(a.start.toISOString()).toBe(b.start.toISOString());
    expect(a.end.getTime() - a.start.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
