import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPayload(secret: string, timestampSec: number, payload: string): string {
  const signed = `${timestampSec}.${payload}`;
  const v1 = createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestampSec},v1=${v1}`;
}

export type ParsedSignature = { timestampSec: number; v1Signatures: string[] };

export function parseSignatureHeader(header: string): ParsedSignature | null {
  let timestampSec: number | null = null;
  const v1Signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const n = Number(value);
      if (Number.isFinite(n)) timestampSec = n;
    } else if (key === 'v1') {
      v1Signatures.push(value);
    }
  }
  if (timestampSec === null || v1Signatures.length === 0) return null;
  return { timestampSec, v1Signatures };
}

export function verifySignature(
  secret: string,
  header: string,
  payload: string,
  toleranceSec = 300,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.timestampSec) > toleranceSec) return false;
  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestampSec}.${payload}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return parsed.v1Signatures.some((candidate) => {
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, 'hex');
    } catch {
      return false;
    }
    if (candidateBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(expectedBuf, candidateBuf);
  });
}
