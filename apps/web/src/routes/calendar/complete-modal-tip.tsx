import { useState } from 'react';
import { centsToDollarString, dollarStringToCents } from '../settings/money';

type Props = {
  petName: string;
  basePriceCents: number;
  submitting: boolean;
  error: string | null;
  onSubmit: (tipCents: number) => void;
  onCancel: () => void;
};

const PRESET_PERCENTS = [18, 20, 22] as const;

export function CompleteTipStep({
  petName,
  basePriceCents,
  submitting,
  error,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  function tipForPercent(pct: number): number {
    return Math.round((basePriceCents * pct) / 100);
  }

  function clickPreset(pct: number): void {
    if (submitting) return;
    onSubmit(tipForPercent(pct));
  }

  function clickCustom(): void {
    if (submitting) return;
    const cents = dollarStringToCents(custom);
    if (cents === null || cents < 0) {
      setCustomError('Enter a valid dollar amount.');
      return;
    }
    if (cents > 100_000) {
      setCustomError('Custom tip must be under $1,000.');
      return;
    }
    setCustomError(null);
    onSubmit(cents);
  }

  function clickSkip(): void {
    if (submitting) return;
    onSubmit(0);
  }

  return (
    <div className="space-y-3">
      <header>
        <h3 className="text-base font-semibold">Add tip for {petName}</h3>
        <p className="text-xs text-gray-500">
          Base price ${centsToDollarString(basePriceCents)}. Tip goes 100% to the groomer.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {PRESET_PERCENTS.map((pct) => {
          const cents = tipForPercent(pct);
          return (
            <button
              key={pct}
              type="button"
              disabled={submitting}
              onClick={() => clickPreset(pct)}
              className="min-h-[64px] rounded-lg border border-gray-200 px-3 text-center disabled:opacity-50"
            >
              <div className="text-base font-semibold">{pct}%</div>
              <div className="text-xs text-gray-500">${centsToDollarString(cents)}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-gray-200 p-2">
        <label className="text-xs font-medium text-gray-700" htmlFor="custom-tip">
          Custom tip
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="custom-tip"
            inputMode="decimal"
            placeholder="$0.00"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setCustomError(null);
            }}
            disabled={submitting}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            type="button"
            disabled={submitting || custom.trim().length === 0}
            onClick={clickCustom}
            className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            Apply
          </button>
        </div>
        {customError ? (
          <p className="mt-1 text-xs text-red-700">{customError}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={submitting}
          onClick={clickSkip}
          className="min-h-[44px] text-sm text-gray-600 underline disabled:opacity-50"
        >
          Skip tip
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
        >
          Cancel
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
    </div>
  );
}
