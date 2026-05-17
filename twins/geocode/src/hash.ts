const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function fnv1aHex(input: string): string {
  return fnv1a32(input).toString(16).padStart(8, '0');
}

export function offsetFromHash(input: string, envelope: number): { latOff: number; lngOff: number } {
  const h = fnv1a32(input);
  const latRaw = (h & 0xffff) / 0xffff;
  const lngRaw = ((h >>> 16) & 0xffff) / 0xffff;
  return {
    latOff: (latRaw * 2 - 1) * envelope,
    lngOff: (lngRaw * 2 - 1) * envelope,
  };
}
