import { db } from '@mygroomtime/db';

const MAX_LEN = 50;

export function slugifyBusinessName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LEN);
  return base.length > 0 ? base : 'shop';
}

export async function pickAvailableSlug(base: string): Promise<string> {
  const candidates: string[] = [base];
  for (let n = 2; n <= 100; n++) candidates.push(`${base}-${n}`);

  const taken = await db.global.tenant.findMany({
    where: { slug: { in: candidates } },
    select: { slug: true },
  });
  const takenSet = new Set(taken.map((t) => t.slug));

  for (const c of candidates) if (!takenSet.has(c)) return c;
  return `${base}-${Math.floor(Math.random() * 1_000_000)}`;
}
