import type { RouteOptimizeResponse, RouteOptimizedStop } from '@mygroomtime/shared';

type Props = {
  route: RouteOptimizeResponse | null;
  tenantPlan: string;
  loading: boolean;
  applying: boolean;
  error: string | null;
  onOptimize: () => void;
  onApply: () => void;
  onToggleLock: (appointmentId: string, locked: boolean) => void;
  onBackToCalendar: () => void;
};

function formatStart(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function truncate(addr: string, max = 36): string {
  if (addr.length <= max) return addr;
  return `${addr.slice(0, max - 1)}…`;
}

function formatDriveTime(min: number, isFirst: boolean): string {
  if (isFirst) return min > 0 ? `${min} min from depot` : 'Start';
  return `${min} min`;
}

const PRO_PLANS = new Set(['pro', 'business']);

export function RouteView({
  route,
  tenantPlan,
  loading,
  applying,
  error,
  onOptimize,
  onApply,
  onToggleLock,
  onBackToCalendar,
}: Props): JSX.Element {
  const isPro = PRO_PLANS.has(tenantPlan);

  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-sm text-gray-800">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">Today&rsquo;s Route</h2>
        <button
          type="button"
          onClick={onBackToCalendar}
          className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-sm text-gray-700"
        >
          Back to calendar
        </button>
      </header>

      {!isPro ? (
        <UpgradeNudge currentPlan={tenantPlan} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onOptimize}
            className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Optimizing…' : 'Optimize route'}
          </button>
          <button
            type="button"
            disabled={applying || !route || route.stops.length === 0}
            onClick={onApply}
            className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800 disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply suggested times'}
          </button>
          {route ? (
            <span className="ml-auto text-xs text-gray-500">
              {route.totalDriveMin} min total drive · {route.stops.length} stops
            </span>
          ) : null}
        </div>
      )}

      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {route && route.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {route.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}

      {route ? <MapPlaceholder stops={route.stops} /> : null}

      {route && route.stops.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
          No appointments scheduled for this day.
        </p>
      ) : null}

      {route && route.stops.length > 0 ? (
        <ol className="space-y-2">
          {route.stops.map((stop, idx) => (
            <RouteStopRow
              key={stop.appointmentId}
              stop={stop}
              index={idx + 1}
              isFirst={idx === 0}
              onToggleLock={onToggleLock}
            />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function RouteStopRow({
  stop,
  index,
  isFirst,
  onToggleLock,
}: {
  stop: RouteOptimizedStop;
  index: number;
  isFirst: boolean;
  onToggleLock: (id: string, locked: boolean) => void;
}): JSX.Element {
  const shifted = stop.startSuggested !== stop.scheduledStart;
  return (
    <li className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
          >
            {index}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {stop.pet.name} <span className="font-normal text-gray-500">· {stop.client.name}</span>
            </div>
            <div className="truncate text-xs text-gray-500">
              {stop.serviceName} · {stop.durationMin} min
            </div>
            <div className="truncate text-xs text-gray-500">
              {truncate(`${stop.client.street}, ${stop.client.city}`)}
            </div>
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-semibold text-gray-900">{formatStart(stop.startSuggested)}</div>
          {shifted ? (
            <div className="text-amber-700">was {formatStart(stop.scheduledStart)}</div>
          ) : null}
          <div className="mt-1 text-gray-500">{formatDriveTime(stop.driveFromPrevMin, isFirst)}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={stop.timeLocked}
            onChange={(e) => onToggleLock(stop.appointmentId, e.target.checked)}
            aria-label={`Lock ${stop.pet.name} time`}
          />
          Lock time
        </label>
      </div>
    </li>
  );
}

function UpgradeNudge({ currentPlan }: { currentPlan: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
      <p className="font-semibold">Route optimization is a Pro feature.</p>
      <p className="mt-1 text-xs">
        Your plan is <span className="font-medium">{currentPlan}</span>. Upgrade to Pro to plan
        the day&rsquo;s drive in one tap.
      </p>
      <a
        href="/settings/billing"
        className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white"
      >
        Upgrade
      </a>
    </div>
  );
}

function MapPlaceholder({ stops }: { stops: RouteOptimizedStop[] }): JSX.Element {
  const points = stops
    .map((s) =>
      s.client.lat != null && s.client.lng != null
        ? { lat: s.client.lat, lng: s.client.lng }
        : null,
    )
    .filter((p): p is { lat: number; lng: number } => p !== null);

  if (points.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg bg-gray-50 text-xs text-gray-500">
        Map preview unavailable — no coordinates on these stops.
      </div>
    );
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = Math.max((maxLat - minLat) * 0.15, 0.002);
  const padLng = Math.max((maxLng - minLng) * 0.15, 0.002);

  const W = 600;
  const H = 220;
  function project(p: { lat: number; lng: number }): { x: number; y: number } {
    const x = ((p.lng - (minLng - padLng)) / (maxLng + padLng - (minLng - padLng))) * W;
    const y = H - ((p.lat - (minLat - padLat)) / (maxLat + padLat - (minLat - padLat))) * H;
    return { x, y };
  }
  const projected = points.map(project);
  const polyline = projected.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Route map with ${stops.length} stops`}
        className="block h-44 w-full"
      >
        <polyline points={polyline} fill="none" stroke="#374151" strokeWidth="2" strokeDasharray="4 4" />
        {projected.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="10" fill="#111827" />
            <text
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="white"
            >
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">
        Schematic route — tile-rendered map planned for chunk 21
      </div>
    </div>
  );
}
