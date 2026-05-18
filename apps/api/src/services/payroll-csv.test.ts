import { describe, it, expect } from 'vitest';
import type { PayrollSplitsResponse } from '@mygroomtime/shared';
import { renderPayrollCsv, payrollCsvFilename } from './payroll-csv.js';

function makeSplits(): PayrollSplitsResponse {
  return {
    period: {
      periodStart: '2026-05-18T00:00:00.000Z',
      periodEnd: '2026-06-01T00:00:00.000Z',
      kind: 'biweekly',
    },
    rows: [
      {
        groomerId: 'u1',
        groomerEmail: 'maria@plano.test',
        groomerName: 'Maria, Sr.',
        appointmentsCompleted: 8,
        revenueCents: 64000,
        tipsCents: 8000,
        totalCents: 72000,
      },
      {
        groomerId: 'u2',
        groomerEmail: 'jose@plano.test',
        groomerName: 'José "JJ" Cruz',
        appointmentsCompleted: 5,
        revenueCents: 42500,
        tipsCents: 5000,
        totalCents: 47500,
      },
    ],
    totals: {
      appointmentsCompleted: 13,
      revenueCents: 106500,
      tipsCents: 13000,
      totalCents: 119500,
    },
  };
}

describe('payroll-csv', () => {
  it('prefixes UTF-8 BOM and writes the spec header in order', () => {
    const csv = renderPayrollCsv(makeSplits());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const noBom = csv.slice(1);
    const [header] = noBom.split('\r\n');
    expect(header).toBe(
      'period_start,period_end,groomer_email,groomer_name,appointments_completed,revenue_cents,tips_cents,total_cents',
    );
  });

  it('escapes commas and double-quotes per RFC 4180', () => {
    const csv = renderPayrollCsv(makeSplits());
    // why: "Maria, Sr." contains a comma → entire cell must be wrapped in quotes
    // José "JJ" Cruz contains a double-quote → wrapped in quotes AND the inner quotes are doubled
    expect(csv).toContain('"Maria, Sr."');
    expect(csv).toContain('"José ""JJ"" Cruz"');
  });

  it('emits the exact byte-for-byte expected payload', () => {
    const csv = renderPayrollCsv(makeSplits());
    const expected =
      '﻿' +
      'period_start,period_end,groomer_email,groomer_name,appointments_completed,revenue_cents,tips_cents,total_cents\r\n' +
      '2026-05-18T00:00:00.000Z,2026-06-01T00:00:00.000Z,maria@plano.test,"Maria, Sr.",8,64000,8000,72000\r\n' +
      '2026-05-18T00:00:00.000Z,2026-06-01T00:00:00.000Z,jose@plano.test,"José ""JJ"" Cruz",5,42500,5000,47500\r\n';
    expect(csv).toBe(expected);
  });

  it('filename uses tenant slug + period date prefix', () => {
    const name = payrollCsvFilename('plano-pup-spa', '2026-05-18T00:00:00.000Z');
    expect(name).toBe('payroll-plano-pup-spa-2026-05-18.csv');
  });
});
