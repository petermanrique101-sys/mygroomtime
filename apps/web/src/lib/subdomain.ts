const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export type AppMode =
  | { kind: 'groomer' }
  | { kind: 'public'; slug: string };

export function detectAppMode(hostname: string): AppMode {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length === 0) return { kind: 'groomer' };
  const last = parts[parts.length - 1]!;
  // why: `localhost` is the dev TLD — `slug.localhost` is 2 parts but IS a subdomain.
  // For a real TLD, 2 parts is the apex (`mygroomtime.com`). We need a different threshold
  // for each.
  const subdomainStart = last === 'localhost' ? 1 : 2;
  if (parts.length < subdomainStart + 1) return { kind: 'groomer' };
  const candidate = parts[0]!;
  if (RESERVED_SUBDOMAINS.has(candidate)) return { kind: 'groomer' };
  if (!SLUG_RE.test(candidate)) return { kind: 'groomer' };
  return { kind: 'public', slug: candidate };
}

export function getAppMode(): AppMode {
  if (typeof window === 'undefined') return { kind: 'groomer' };
  return detectAppMode(window.location.hostname);
}

export function getPublicTenantSlug(): string | null {
  const mode = getAppMode();
  return mode.kind === 'public' ? mode.slug : null;
}

export function useTenantSlug(): string | null {
  return getPublicTenantSlug();
}
