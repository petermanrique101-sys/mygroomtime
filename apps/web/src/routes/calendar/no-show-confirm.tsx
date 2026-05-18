import { centsToDollarString } from '../settings/money';

type Props = {
  petName: string;
  depositCents: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function NoShowConfirm({
  petName,
  depositCents,
  busy,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const depositLabel =
    depositCents > 0 ? `$${centsToDollarString(depositCents)} deposit` : '$0 deposit';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm no-show"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm"
    >
      <p className="font-medium text-amber-900">
        Mark {petName} as a no-show?
      </p>
      <p className="mt-1 text-xs text-amber-900">
        We&rsquo;ll text the customer that we missed them and that the {depositLabel} is
        retained per your booking terms. This cannot be undone.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-[44px] rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          Yes, mark no-show
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
        >
          Back
        </button>
      </div>
    </div>
  );
}
