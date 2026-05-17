export type ZipCentroid = {
  zip: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
};

export const ZIP_CENTROIDS: readonly ZipCentroid[] = [
  { zip: '75023', city: 'Plano', state: 'TX', lat: 33.044, lng: -96.732 },
  { zip: '75024', city: 'Plano', state: 'TX', lat: 33.0828, lng: -96.8076 },
  { zip: '75025', city: 'Plano', state: 'TX', lat: 33.09, lng: -96.728 },
  { zip: '75070', city: 'McKinney', state: 'TX', lat: 33.1924, lng: -96.737 },
  { zip: '75035', city: 'Frisco', state: 'TX', lat: 33.173, lng: -96.8024 },
  { zip: '75093', city: 'Plano', state: 'TX', lat: 33.0288, lng: -96.829 },
];

const byZip = new Map<string, ZipCentroid>(ZIP_CENTROIDS.map((c) => [c.zip, c]));

export function lookupZip(zip: string): ZipCentroid | undefined {
  return byZip.get(zip);
}
