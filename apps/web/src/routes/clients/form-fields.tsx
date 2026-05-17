import type { ChangeEvent } from 'react';

type FieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel';
  error?: string | undefined;
  placeholder?: string;
};

export function TextField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required,
  autoComplete,
  inputMode,
  error,
  placeholder,
}: FieldProps): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
      />
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}

export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  error?: string | undefined;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-base focus:border-gray-900 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
    </label>
  );
}
