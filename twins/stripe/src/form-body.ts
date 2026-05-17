export type FormBody = Record<string, unknown>;

function setDeep(target: FormBody, path: string[], value: string): void {
  if (path.length === 0) return;
  let cursor: FormBody | unknown[] = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const nextKey = path[i + 1]!;
    const wantArray = /^\d+$/.test(nextKey);
    if (Array.isArray(cursor)) {
      const idx = Number(key);
      if (cursor[idx] === undefined) {
        cursor[idx] = wantArray ? [] : ({} as FormBody);
      }
      cursor = cursor[idx] as FormBody | unknown[];
    } else {
      const c = cursor as FormBody;
      if (c[key] === undefined) {
        c[key] = wantArray ? [] : ({} as FormBody);
      }
      cursor = c[key] as FormBody | unknown[];
    }
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cursor)) {
    cursor[Number(last)] = value;
  } else {
    (cursor as FormBody)[last] = value;
  }
}

function tokenize(key: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const ch of key) {
    if (ch === '[') {
      if (current.length > 0) {
        out.push(current);
        current = '';
      }
    } else if (ch === ']') {
      if (current.length > 0) out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

export function parseFormBody(raw: string): FormBody {
  const out: FormBody = {};
  if (raw.length === 0) return out;
  const params = new URLSearchParams(raw);
  for (const [key, value] of params) {
    const path = tokenize(key);
    setDeep(out, path, value);
  }
  return out;
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

export function asMetadata(v: unknown): Record<string, string> {
  const r = asRecord(v);
  if (!r) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(r)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

export function firstItem(v: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(v)) return asRecord(v[0]);
  const r = asRecord(v);
  if (!r) return undefined;
  return asRecord(r['0']) ?? r;
}
