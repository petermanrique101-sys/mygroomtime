type Props = {
  color: string;
  topPx: number;
  heightPx: number;
  position: 'before' | 'after';
  petName: string;
};

export function BufferBand({ color, topPx, heightPx, position, petName }: Props): JSX.Element | null {
  if (heightPx < 1) return null;
  const stripe = `repeating-linear-gradient(135deg, ${color}55 0 6px, transparent 6px 12px)`;
  return (
    <div
      aria-hidden="true"
      title={`${position === 'before' ? 'Drive time before' : 'Drive time after'} ${petName}`}
      className="pointer-events-none absolute left-1 right-1 rounded-sm"
      style={{
        top: topPx,
        height: heightPx,
        background: stripe,
        opacity: 0.6,
      }}
    />
  );
}
