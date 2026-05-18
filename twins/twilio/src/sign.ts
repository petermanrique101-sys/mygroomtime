import { createHmac, timingSafeEqual } from 'node:crypto';

// why: Twilio's X-Twilio-Signature is HMAC-SHA1 over the full URL concatenated with
// each form param sorted alphabetically by key — `${key}${value}` with no separator.
// See https://www.twilio.com/docs/usage/security#validating-requests. The twin and the
// adapter must agree byte-for-byte or signature verification will silently fail in dev.
export function buildSignatureBase(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  let acc = url;
  for (const key of sortedKeys) {
    acc += key + params[key]!;
  }
  return acc;
}

export function signInboundWebhook(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const base = buildSignatureBase(url, params);
  return createHmac('sha1', authToken).update(base).digest('base64');
}

export function verifyInboundWebhook(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const expected = signInboundWebhook(authToken, url, params);
  const expectedBuf = Buffer.from(expected, 'base64');
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function flattenFormParams(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}
