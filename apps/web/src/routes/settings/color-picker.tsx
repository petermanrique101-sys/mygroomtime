import { SERVICE_COLOR_PALETTE } from '@mygroomtime/shared';

type Props = {
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
};

export function ColorPicker({ value, onChange, error }: Props): JSX.Element {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-gray-700">Calendar color</span>
      <div className="grid grid-cols-6 gap-2">
        {SERVICE_COLOR_PALETTE.map((hex) => {
          const selected = hex === value;
          return (
            <button
              key={hex}
              type="button"
              aria-label={`Pick color ${hex}`}
              aria-pressed={selected}
              onClick={() => onChange(hex)}
              style={{ backgroundColor: hex }}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition ${
                selected ? 'border-gray-900' : 'border-transparent'
              }`}
            >
              {selected ? (
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  className="h-5 w-5 drop-shadow"
                  aria-hidden="true"
                >
                  <path d="M4 10.5 L8.5 15 L16 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
