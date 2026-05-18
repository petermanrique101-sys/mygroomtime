import type { PayrollSplitsResponse } from '@mygroomtime/shared';

const BOM = '﻿';
const HEADER = [
  'period_start',
  'period_end',
  'groomer_email',
  'groomer_name',
  'appointments_completed',
  'revenue_cents',
  'tips_cents',
  'total_cents',
] as const;

// why: per chunk-21 spec, CSV is UTF-8 with BOM so Excel renders unicode correctly.
// Each field is quoted only when it contains commas, quotes, or newlines — RFC 4180
// minimal. Inner double-quotes are doubled.
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.length === 0) return '';
  const needsQuotes = /[",\r\n]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function renderPayrollCsv(splits: PayrollSplitsResponse): string {
  const lines: string[] = [HEADER.join(',')];
  for (const r of splits.rows) {
    lines.push(
      [
        escapeCell(splits.period.periodStart),
        escapeCell(splits.period.periodEnd),
        escapeCell(r.groomerEmail),
        escapeCell(r.groomerName),
        escapeCell(r.appointmentsCompleted),
        escapeCell(r.revenueCents),
        escapeCell(r.tipsCents),
        escapeCell(r.totalCents),
      ].join(','),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

export function payrollCsvFilename(tenantSlug: string, periodStart: string): string {
  const date = periodStart.slice(0, 10);
  return `payroll-${tenantSlug}-${date}.csv`;
}
