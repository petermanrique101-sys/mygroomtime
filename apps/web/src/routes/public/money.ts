export function centsToDollarString(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min - h * 60;
  if (rest === 0) return `${h} hr`;
  return `${h} hr ${rest} min`;
}
