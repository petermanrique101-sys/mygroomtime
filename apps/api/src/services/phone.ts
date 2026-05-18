// why: phone-based match-or-create needs a stable key. Strip everything except digits;
// the public booking schema validates roughly-E.164-shaped input, so the stored Client
// phone is what came off the form. We compare by digits-only suffix to defuse small
// formatting drift (e.g., "+1 972 555 0199" vs "(972) 555-0199").
//
// v2: chunk that introduces international rollout will swap this for libphonenumber and
// store a canonical E.164 string on Client.phone directly.
export function normalizePhone(raw: string): string {
  return raw.replace(/\D+/g, '');
}

// 10-digit suffix is the US-only stand-in for proper E.164 normalization. It collapses
// "(972) 555-0199", "+1 972 555 0199", and "972-555-0199" to the same key.
export function tenDigitSuffix(raw: string): string {
  return normalizePhone(raw).slice(-10);
}

export function suffixesMatch(a: string, b: string): boolean {
  const sa = tenDigitSuffix(a);
  const sb = tenDigitSuffix(b);
  if (sa.length === 0 || sb.length === 0) return false;
  return sa === sb;
}

// E.164-ish dial string for outbound — keeps the leading + and digits only. If the input
// already starts with a country code we trust it; otherwise we assume +1 (US) so the SMS
// adapter has something the carrier will accept.
export function toDialFormat(raw: string): string {
  const trimmed = raw.trim();
  const digits = normalizePhone(trimmed);
  if (digits.length === 0) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}
