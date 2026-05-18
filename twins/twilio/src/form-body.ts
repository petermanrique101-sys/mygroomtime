export type FormBody = Record<string, string>;

// why: Twilio's wire format is flat application/x-www-form-urlencoded — no nested
// brackets. URLSearchParams handles duplicate keys by taking the last; the real
// Twilio API does the same, so we follow suit.
export function parseFormBody(raw: string): FormBody {
  const out: FormBody = {};
  if (raw.length === 0) return out;
  const params = new URLSearchParams(raw);
  for (const [key, value] of params) {
    out[key] = value;
  }
  return out;
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
