import { useState } from 'react';
import { COAT_TYPES, PublicBookingSubmitRequestSchema, type CoatType } from '@mygroomtime/shared';

export type BookingFormValues = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  petName: string;
  petBreed: string;
  petWeightLb: string;
  petCoatType: CoatType;
  temperamentNotes: string;
  vaccinationExpiry: string;
};

export type ValidatedBookingPayload = {
  customer: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  pet: {
    name: string;
    breed: string;
    weightLb: number | null;
    coatType: CoatType;
    temperamentNotes: string;
    vaccinationExpiry: string | null;
  };
};

const INITIAL: BookingFormValues = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  street: '',
  city: '',
  state: 'TX',
  zip: '',
  petName: '',
  petBreed: '',
  petWeightLb: '',
  petCoatType: 'short',
  temperamentNotes: '',
  vaccinationExpiry: '',
};

export function emptyBookingForm(): BookingFormValues {
  return { ...INITIAL };
}

type FormErrors = Partial<Record<keyof BookingFormValues | '_form', string>>;

type Props = {
  values: BookingFormValues;
  onChange: (v: BookingFormValues) => void;
  onSubmit: (payload: ValidatedBookingPayload) => void;
  submitting: boolean;
  errorMessage: string | null;
};

export function BookingForm(props: Props): JSX.Element {
  const { values, onChange, onSubmit, submitting, errorMessage } = props;
  const [errors, setErrors] = useState<FormErrors>({});

  function field<K extends keyof BookingFormValues>(key: K, v: BookingFormValues[K]): void {
    onChange({ ...values, [key]: v });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setErrors({});
    const weight = values.petWeightLb.trim() === '' ? null : Number(values.petWeightLb);
    const payload = {
      serviceId: 'tbd',
      start: '2099-01-01T00:00:00Z',
      customer: {
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
        email: values.email,
        street: values.street,
        city: values.city,
        state: values.state,
        zip: values.zip,
      },
      pet: {
        name: values.petName,
        breed: values.petBreed,
        weightLb: weight === null || Number.isNaN(weight) ? null : weight,
        coatType: values.petCoatType,
        temperamentNotes: values.temperamentNotes,
        vaccinationExpiry: values.vaccinationExpiry || null,
      },
    };
    const parsed = PublicBookingSubmitRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const next: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.slice(1).join('.') || issue.path.join('.');
        const label = mapPath(path);
        if (label) next[label] = issue.message;
        else next._form = issue.message;
      }
      setErrors(next);
      return;
    }
    onSubmit({
      customer: {
        firstName: parsed.data.customer.firstName,
        lastName: parsed.data.customer.lastName,
        phone: parsed.data.customer.phone,
        email: parsed.data.customer.email ?? null,
        street: parsed.data.customer.street,
        city: parsed.data.customer.city,
        state: parsed.data.customer.state,
        zip: parsed.data.customer.zip,
      },
      pet: {
        name: parsed.data.pet.name,
        breed: parsed.data.pet.breed,
        weightLb: parsed.data.pet.weightLb ?? null,
        coatType: parsed.data.pet.coatType,
        temperamentNotes: parsed.data.pet.temperamentNotes,
        vaccinationExpiry: parsed.data.pet.vaccinationExpiry ?? null,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FieldSet title="Your info">
        <TwoCol>
          <Field label="First name" error={errors.firstName}>
            <input
              type="text"
              value={values.firstName}
              onChange={(e) => field('firstName', e.target.value)}
              className={inputCls(errors.firstName)}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name" error={errors.lastName}>
            <input
              type="text"
              value={values.lastName}
              onChange={(e) => field('lastName', e.target.value)}
              className={inputCls(errors.lastName)}
              autoComplete="family-name"
            />
          </Field>
        </TwoCol>
        <Field label="Phone" error={errors.phone}>
          <input
            type="tel"
            value={values.phone}
            onChange={(e) => field('phone', e.target.value)}
            className={inputCls(errors.phone)}
            autoComplete="tel"
          />
        </Field>
        <Field label="Email (optional)" error={errors.email}>
          <input
            type="email"
            value={values.email}
            onChange={(e) => field('email', e.target.value)}
            className={inputCls(errors.email)}
            autoComplete="email"
          />
        </Field>
      </FieldSet>

      <FieldSet title="Address">
        <Field label="Street" error={errors.street}>
          <input
            type="text"
            value={values.street}
            onChange={(e) => field('street', e.target.value)}
            className={inputCls(errors.street)}
            autoComplete="street-address"
          />
        </Field>
        <TwoCol>
          <Field label="City" error={errors.city}>
            <input
              type="text"
              value={values.city}
              onChange={(e) => field('city', e.target.value)}
              className={inputCls(errors.city)}
              autoComplete="address-level2"
            />
          </Field>
          <Field label="State" error={errors.state}>
            <input
              type="text"
              maxLength={2}
              value={values.state}
              onChange={(e) => field('state', e.target.value.toUpperCase())}
              className={inputCls(errors.state)}
              autoComplete="address-level1"
            />
          </Field>
        </TwoCol>
        <Field label="Zip code" error={errors.zip}>
          <input
            type="text"
            value={values.zip}
            onChange={(e) => field('zip', e.target.value)}
            className={inputCls(errors.zip)}
            autoComplete="postal-code"
            inputMode="numeric"
          />
        </Field>
      </FieldSet>

      <FieldSet title="Your dog">
        <TwoCol>
          <Field label="Name" error={errors.petName}>
            <input
              type="text"
              value={values.petName}
              onChange={(e) => field('petName', e.target.value)}
              className={inputCls(errors.petName)}
            />
          </Field>
          <Field label="Breed" error={errors.petBreed}>
            <input
              type="text"
              value={values.petBreed}
              onChange={(e) => field('petBreed', e.target.value)}
              className={inputCls(errors.petBreed)}
            />
          </Field>
        </TwoCol>
        <TwoCol>
          <Field label="Weight (lb)" error={errors.petWeightLb}>
            <input
              type="number"
              min="0"
              step="0.1"
              value={values.petWeightLb}
              onChange={(e) => field('petWeightLb', e.target.value)}
              className={inputCls(errors.petWeightLb)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Coat type" error={errors.petCoatType}>
            <select
              value={values.petCoatType}
              onChange={(e) => field('petCoatType', e.target.value as CoatType)}
              className={inputCls(errors.petCoatType)}
            >
              {COAT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </TwoCol>
        <Field label="Temperament notes (optional)" error={errors.temperamentNotes}>
          <textarea
            rows={3}
            value={values.temperamentNotes}
            onChange={(e) => field('temperamentNotes', e.target.value)}
            className={inputCls(errors.temperamentNotes)}
          />
        </Field>
        <Field label="Vaccination expiry (optional)" error={errors.vaccinationExpiry}>
          <input
            type="date"
            value={values.vaccinationExpiry}
            onChange={(e) => field('vaccinationExpiry', e.target.value)}
            className={inputCls(errors.vaccinationExpiry)}
          />
        </Field>
      </FieldSet>

      {errorMessage ? (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}
      {errors._form ? (
        <p role="alert" className="text-sm text-red-700">
          {errors._form}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:bg-gray-400"
      >
        {submitting ? 'Submitting…' : 'Continue to payment'}
      </button>
    </form>
  );
}

function mapPath(path: string): keyof BookingFormValues | null {
  const map: Record<string, keyof BookingFormValues> = {
    firstName: 'firstName',
    lastName: 'lastName',
    phone: 'phone',
    email: 'email',
    street: 'street',
    city: 'city',
    state: 'state',
    zip: 'zip',
    name: 'petName',
    breed: 'petBreed',
    weightLb: 'petWeightLb',
    coatType: 'petCoatType',
    temperamentNotes: 'temperamentNotes',
    vaccinationExpiry: 'vaccinationExpiry',
  };
  return map[path] ?? null;
}

function inputCls(err: string | undefined): string {
  return (
    'block w-full rounded-lg border px-3 py-2 text-sm ' +
    (err
      ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200'
      : 'border-gray-300 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200')
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
        {label}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-700">{error}</span> : null}
    </label>
  );
}

function FieldSet({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

function TwoCol({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
