export const SERVICE_COLOR_PALETTE = [
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#65a30d',
  '#ca8a04',
  '#f59e0b',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#7c3aed',
  '#6b7280',
] as const;

export type ServiceColor = (typeof SERVICE_COLOR_PALETTE)[number];

export const DEFAULT_SERVICE_COLOR: ServiceColor = '#6b7280';

export function isServiceColor(value: string): value is ServiceColor {
  return (SERVICE_COLOR_PALETTE as readonly string[]).includes(value);
}
