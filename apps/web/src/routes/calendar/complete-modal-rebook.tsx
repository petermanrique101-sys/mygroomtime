import { useState } from 'react';

type Props = {
  petName: string;
  defaultIntervalWeeks: number;
  submitting: boolean;
  error: string | null;
  conflictMessage: string | null;
  onSubmit: (intervalWeeks: number) => void;
  onSkip: () => void;
};

const PRESET_WEEKS = [4, 6, 8, 12] as const;

export function CompleteRebookStep({
  petName,
  defaultIntervalWeeks,
  submitting,
  error,
  conflictMessage,
  onSubmit,
  onSkip,
}: Props): JSX.Element {
  const [selected, setSelected] = useState<number>(defaultIntervalWeeks);
  const [customStr, setCustomStr] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  function pickPreset(weeks: number): void {
    if (submitting) return;
    setSelected(weeks);
    setCustomStr('');
    setCustomError(null);
  }

  function applyCustom(): void {
    if (submitting) return;
    const n = Number(customStr);
    if (!Number.isInteger(n) || n < 1 || n > 26) {
      setCustomError('Pick a whole number of weeks from 1 to 26.');
      return;
    }
    setSelected(n);
    setCustomError(null);
  }

  function clickRebook(): void {
    if (submitting) return;
    onSubmit(selected);
  }

  return (
    <div className="space-y-3">
      <header>
        <h3 className="text-base font-semibold">Rebook {petName}?</h3>
        <p className="text-xs text-gray-500">
          We&rsquo;ll create the next appointment + a recurring series so you don&rsquo;t have to
          remember.
        </p>
      </header>

      <div className="grid grid-cols-4 gap-2">
        {PRESET_WEEKS.map((w) => (
          <button
            key={w}
            type="button"
            disabled={submitting}
            onClick={() => pickPreset(w)}
            aria-pressed={selected === w}
            className={`min-h-[48px] rounded-lg border text-sm font-medium disabled:opacity-50 ${
              selected === w
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 text-gray-700'
            }`}
          >
            {w}w
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 p-2">
        <label className="text-xs font-medium text-gray-700" htmlFor="custom-weeks">
          Custom (1-26 weeks)
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="custom-weeks"
            inputMode="numeric"
            value={customStr}
            placeholder="e.g. 10"
            onChange={(e) => {
              setCustomStr(e.target.value);
              setCustomError(null);
            }}
            disabled={submitting}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={submitting || customStr.length === 0}
            className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700 disabled:opacity-50"
          >
            Set
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
          onClick={onSkip}
          className="min-h-[44px] text-sm text-gray-600 underline disabled:opacity-50"
        >
          Skip rebook
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={clickRebook}
          className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? 'Booking…' : `Rebook in ${selected} weeks`}
        </button>
      </div>

      {conflictMessage ? (
        <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {conflictMessage} Pick another interval or skip and rebook from the calendar.
        </div>
      ) : error ? (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
    </div>
  );
}
