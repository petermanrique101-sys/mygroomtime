import type { ServiceOutput } from '@mygroomtime/shared';
import { centsToDollarString } from './money';

type Props = {
  service: ServiceOutput;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => void;
};

export function ServiceRow({ service, onEdit, onDelete, onToggleActive }: Props): JSX.Element {
  return (
    <li className="border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden="true"
          className="mt-1 inline-block h-6 w-6 shrink-0 rounded-full border border-gray-200"
          style={{ backgroundColor: service.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="truncate text-left text-base font-medium text-gray-900 underline-offset-2 hover:underline"
            >
              {service.name}
            </button>
            {!service.active ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                inactive
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {service.durationMin} min · ${centsToDollarString(service.basePriceCents)}
            {service.depositCents > 0
              ? ` · $${centsToDollarString(service.depositCents)} deposit`
              : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={service.active}
              onChange={(e) => onToggleActive(e.target.checked)}
              aria-label={`${service.name} active`}
              className="h-5 w-5"
            />
          </label>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${service.name}`}
            className="flex h-11 min-w-[44px] items-center justify-center rounded-lg border border-gray-200 px-2 text-sm text-red-600"
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}
