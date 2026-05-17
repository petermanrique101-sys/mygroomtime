import { useState, type FormEvent } from 'react';
import {
  DEFAULT_SERVICE_COLOR,
  ServiceInputSchema,
  type ServiceInput,
  type ServiceOutput,
} from '@mygroomtime/shared';
import { ColorPicker } from './color-picker';
import { centsToDollarString, dollarStringToCents, sanitizeDollarInput } from './money';

type Draft = {
  name: string;
  durationMin: string;
  basePriceDollars: string;
  depositDollars: string;
  color: string;
  active: boolean;
};

function emptyDraft(): Draft {
  return {
    name: '',
    durationMin: '60',
    basePriceDollars: '',
    depositDollars: '0.00',
    color: DEFAULT_SERVICE_COLOR,
    active: true,
  };
}

function draftFromService(s: ServiceOutput): Draft {
  return {
    name: s.name,
    durationMin: String(s.durationMin),
    basePriceDollars: centsToDollarString(s.basePriceCents),
    depositDollars: centsToDollarString(s.depositCents),
    color: s.color,
    active: s.active,
  };
}

function parseDraft(d: Draft): { value?: ServiceInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const durationMin = Number(d.durationMin);
  if (!Number.isFinite(durationMin) || !Number.isInteger(durationMin)) {
    errors.durationMin = 'Duration must be a whole number.';
  }
  const basePriceCents = dollarStringToCents(d.basePriceDollars);
  if (basePriceCents === null) errors.basePriceCents = 'Enter a price like 85.00.';
  const depositCents = dollarStringToCents(d.depositDollars);
  if (depositCents === null) errors.depositCents = 'Enter a deposit like 20.00.';
  if (Object.keys(errors).length > 0) return { errors };

  const parsed = ServiceInputSchema.safeParse({
    name: d.name,
    durationMin,
    basePriceCents: basePriceCents as number,
    depositCents: depositCents as number,
    color: d.color,
    active: d.active,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { errors: fieldErrors };
  }
  return { value: parsed.data, errors: {} };
}

type Props = {
  initial?: ServiceOutput;
  submitting?: boolean;
  submitError?: string | null;
  onSubmit: (input: ServiceInput) => void;
  onCancel: () => void;
};

export function ServiceForm({
  initial,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const [draft, setDraft] = useState<Draft>(initial ? draftFromService(initial) : emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});

  function patch<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setErrors({});
    const { value, errors: e2 } = parseDraft(draft);
    if (Object.keys(e2).length > 0 || !value) {
      setErrors(e2);
      return;
    }
    onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Name</span>
        <input
          name="name"
          value={draft.name}
          onChange={(e) => patch('name', e.target.value)}
          required
          className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
        />
        {errors.name ? <p className="mt-1 text-sm text-red-600">{errors.name}</p> : null}
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Duration (minutes)</span>
        <input
          name="durationMin"
          inputMode="numeric"
          value={draft.durationMin}
          onChange={(e) => patch('durationMin', e.target.value.replace(/[^0-9]/g, ''))}
          required
          className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
        />
        {errors.durationMin ? (
          <p className="mt-1 text-sm text-red-600">{errors.durationMin}</p>
        ) : null}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Base price</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-500">
              $
            </span>
            <input
              name="basePriceDollars"
              inputMode="decimal"
              value={draft.basePriceDollars}
              onChange={(e) => patch('basePriceDollars', sanitizeDollarInput(e.target.value))}
              placeholder="0.00"
              required
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 pl-7 pr-3 text-base focus:border-gray-900 focus:outline-none"
            />
          </div>
          {errors.basePriceCents ? (
            <p className="mt-1 text-sm text-red-600">{errors.basePriceCents}</p>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Deposit</span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-500">
              $
            </span>
            <input
              name="depositDollars"
              inputMode="decimal"
              value={draft.depositDollars}
              onChange={(e) => patch('depositDollars', sanitizeDollarInput(e.target.value))}
              placeholder="0.00"
              required
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 pl-7 pr-3 text-base focus:border-gray-900 focus:outline-none"
            />
          </div>
          {errors.depositCents ? (
            <p className="mt-1 text-sm text-red-600">{errors.depositCents}</p>
          ) : null}
        </label>
      </div>

      <ColorPicker
        value={draft.color}
        onChange={(c) => patch('color', c)}
        error={errors.color}
      />

      <label className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-3">
        <span className="text-sm font-medium text-gray-700">Active</span>
        <input
          type="checkbox"
          name="active"
          checked={draft.active}
          onChange={(e) => patch('active', e.target.checked)}
          className="h-6 w-6"
        />
      </label>

      {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="block min-h-[44px] flex-1 rounded-lg border border-gray-300 px-4 text-base font-medium text-gray-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="block min-h-[44px] flex-1 rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
