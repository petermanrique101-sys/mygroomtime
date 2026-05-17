const ZIP_RE = /\b(\d{5})\b/;
const STREET_NUMBER_RE = /^\s*(\d+)\s+(.+)$/;

export type AddressParts = {
  streetNumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export function extractZip(address: string): string | null {
  const m = ZIP_RE.exec(address);
  return m ? (m[1] ?? null) : null;
}

export function parseAddress(address: string): AddressParts {
  const trimmed = address.trim();
  const parts = trimmed.split(',').map((p) => p.trim()).filter((p) => p.length > 0);

  const zip = extractZip(trimmed);

  const streetRaw = parts[0] ?? null;
  const city = parts[1] ?? null;
  const stateZipPart = parts[2] ?? null;

  let state: string | null = null;
  if (stateZipPart) {
    const tokens = stateZipPart.split(/\s+/).filter((t) => t.length > 0);
    state = tokens[0] ?? null;
  }

  let streetNumber: string | null = null;
  let street: string | null = streetRaw;
  if (streetRaw) {
    const m = STREET_NUMBER_RE.exec(streetRaw);
    if (m) {
      streetNumber = m[1] ?? null;
      street = m[2] ?? null;
    }
  }

  return { streetNumber, street, city, state, zip };
}
