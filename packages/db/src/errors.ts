interface PrismaKnownError {
  code?: unknown;
  meta?: { target?: unknown };
}

function isPrismaKnownError(err: unknown): err is PrismaKnownError {
  return typeof err === 'object' && err !== null && 'code' in err;
}

export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!isPrismaKnownError(err) || err.code !== 'P2002') return false;
  if (!field) return true;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === 'string') return target.includes(field);
  return false;
}
