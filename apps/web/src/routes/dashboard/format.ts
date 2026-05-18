export function centsToDollarsCompact(cents: number): string {
  const whole = Math.floor(cents / 100);
  if (whole >= 1_000_000) {
    return `$${(whole / 1_000_000).toFixed(1)}M`;
  }
  if (whole >= 10_000) {
    return `$${Math.round(whole / 1_000)}k`;
  }
  if (whole >= 1_000) {
    return `$${(whole / 1_000).toFixed(1)}k`;
  }
  const rem = cents % 100;
  if (rem === 0) return `$${whole}`;
  return `$${whole}.${rem.toString().padStart(2, '0')}`;
}

export function centsToDollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rem = Math.abs(cents % 100);
  if (rem === 0) return `$${whole.toLocaleString()}`;
  return `$${whole.toLocaleString()}.${rem.toString().padStart(2, '0')}`;
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function daysFromIso(iso: string, now = new Date()): number {
  const d = new Date(iso);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000)));
}
