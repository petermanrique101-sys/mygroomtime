// why: UUIDv7 puts a 48-bit unix-ms timestamp in the high bits so IDs sort by creation time
// when queried lexicographically. That sortability is the offline-replay invariant — the
// server processes mutations in the order the user made them, regardless of which one
// physically arrived first. We don't depend on a library so the queue keeps working when
// the browser ships ES2024+ crypto.randomUUID with v7 support natively.

const HEX = '0123456789abcdef';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += HEX[(b >> 4) & 0xf]! + HEX[b & 0xf]!;
  return out;
}

export function uuidv7(): string {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  // 8-4-4-4-12 layout. Bytes 0-5 = timestamp. Bytes 6-7 = (version=7 << 12) | 12 random bits.
  // Bytes 8-9 = (variant=10 << 14) | 14 random bits. Bytes 10-15 = 48 random bits.
  const r12 = randomHex(2).slice(0, 3); // 12 random bits for version-tagged group
  const r14 = randomHex(2); // 16 random bits, top two get overwritten by variant
  // why: set version 7 in the high nibble of the third group; variant 10xx in the high two
  // bits of the fourth group.
  const verGroup = '7' + r12;
  const variantFirstByteRaw = parseInt(r14.slice(0, 2), 16);
  const variantFirstByte = ((variantFirstByteRaw & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  const variantGroup = variantFirstByte + r14.slice(2);
  const tail = randomHex(6);
  return (
    tsHex.slice(0, 8) +
    '-' +
    tsHex.slice(8, 12) +
    '-' +
    verGroup +
    '-' +
    variantGroup +
    '-' +
    tail
  );
}
