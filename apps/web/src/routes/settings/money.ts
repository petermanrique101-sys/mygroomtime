export function centsToDollarString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}${dollars}.${remainder.toString().padStart(2, '0')}`;
}

export function dollarStringToCents(value: string): number | null {
  const trimmed = value.trim().replace(/^\$/, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const wholeNum = Number(whole);
  const fracPadded = (frac + '00').slice(0, 2);
  const fracNum = Number(fracPadded);
  if (!Number.isFinite(wholeNum) || !Number.isFinite(fracNum)) return null;
  return wholeNum * 100 + fracNum;
}

export function sanitizeDollarInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  const head = cleaned.slice(0, firstDot + 1);
  const tail = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  return head + tail;
}
