import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClientCreateRequestSchema,
  COAT_TYPES,
  type ClientCreateRequest,
  type CoatType,
} from '@mygroomtime/shared';
import { createClient } from '../../lib/clients-api';
import { SelectField, TextField } from './form-fields';

type PetDraft = {
  name: string;
  breed: string;
  weightLb: string;
  coatType: CoatType;
  preferredCutStyle: string;
};

const emptyPet = (): PetDraft => ({
  name: '',
  breed: '',
  weightLb: '',
  coatType: 'short',
  preferredCutStyle: '',
});

function toPayload(form: {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  pets: PetDraft[];
}): ClientCreateRequest {
  return {
    name: form.name,
    phone: form.phone,
    email: form.email.trim() === '' ? null : form.email,
    street: form.street,
    city: form.city,
    state: form.state,
    zip: form.zip,
    notes: form.notes,
    pets: form.pets.map((p) => ({
      name: p.name,
      breed: p.breed,
      weightLb: p.weightLb === '' ? null : Number(p.weightLb),
      coatType: p.coatType,
      preferredCutStyle: p.preferredCutStyle,
      temperamentNotes: '',
    })),
  };
}

export default function NewClientRoute(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    street: '',
    city: 'Plano',
    state: 'TX',
    zip: '',
    notes: '',
    pets: [emptyPet()],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: ClientCreateRequest) => {
      const res = await createClient(payload);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      navigate(`/clients/${data.client.id}`, { replace: true });
    },
  });

  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function patchPet(idx: number, key: keyof PetDraft, value: string): void {
    setForm((f) => ({
      ...f,
      pets: f.pets.map((p, i) => (i === idx ? { ...p, [key]: value } : p)),
    }));
  }

  function addPet(): void {
    setForm((f) => ({ ...f, pets: [...f.pets, emptyPet()] }));
  }

  function removePet(idx: number): void {
    setForm((f) =>
      f.pets.length > 1 ? { ...f, pets: f.pets.filter((_, i) => i !== idx) } : f,
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSubmitError(null);
    setErrors({});
    const payload = toPayload(form);
    const parsed = ClientCreateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    mutation.mutate(parsed.data, {
      onError: (err) => setSubmitError((err as Error).message),
    });
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-md px-4 pb-12 pt-5">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/clients" className="text-sm text-gray-600 underline">
            ← Clients
          </Link>
        </div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">New client</h1>
        <p className="mb-6 text-sm text-gray-500">
          Owner info, address, and at least one pet.
        </p>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Owner</h2>
            <TextField
              label="Name"
              name="name"
              value={form.name}
              onChange={(v) => patch('name', v)}
              required
              autoComplete="name"
              error={errors.name}
            />
            <TextField
              label="Phone"
              name="phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(v) => patch('phone', v)}
              required
              autoComplete="tel"
              error={errors.phone}
            />
            <TextField
              label="Email (optional)"
              name="email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(v) => patch('email', v)}
              autoComplete="email"
              error={errors.email}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Address</h2>
            <TextField
              label="Street"
              name="street"
              value={form.street}
              onChange={(v) => patch('street', v)}
              required
              autoComplete="address-line1"
              error={errors.street}
            />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <TextField
                  label="City"
                  name="city"
                  value={form.city}
                  onChange={(v) => patch('city', v)}
                  required
                  autoComplete="address-level2"
                  error={errors.city}
                />
              </div>
              <TextField
                label="State"
                name="state"
                value={form.state}
                onChange={(v) => patch('state', v.toUpperCase())}
                required
                error={errors.state}
              />
            </div>
            <TextField
              label="Zip"
              name="zip"
              inputMode="numeric"
              value={form.zip}
              onChange={(v) => patch('zip', v)}
              required
              autoComplete="postal-code"
              error={errors.zip}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pets</h2>
            {form.pets.map((p, idx) => (
              <div key={idx} className="space-y-3 rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Pet {idx + 1}</span>
                  {form.pets.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removePet(idx)}
                      className="min-h-[44px] text-sm text-red-600 underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <TextField
                  label="Name"
                  name={`pet-${idx}-name`}
                  value={p.name}
                  onChange={(v) => patchPet(idx, 'name', v)}
                  required
                  error={errors[`pets.${idx}.name`]}
                />
                <TextField
                  label="Breed"
                  name={`pet-${idx}-breed`}
                  value={p.breed}
                  onChange={(v) => patchPet(idx, 'breed', v)}
                  required
                  error={errors[`pets.${idx}.breed`]}
                />
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Weight (lb)"
                    name={`pet-${idx}-weight`}
                    inputMode="numeric"
                    value={p.weightLb}
                    onChange={(v) => patchPet(idx, 'weightLb', v)}
                    error={errors[`pets.${idx}.weightLb`]}
                  />
                  <SelectField
                    label="Coat"
                    name={`pet-${idx}-coat`}
                    value={p.coatType}
                    onChange={(v) => patchPet(idx, 'coatType', v as CoatType)}
                    options={COAT_TYPES}
                    error={errors[`pets.${idx}.coatType`]}
                  />
                </div>
                <TextField
                  label="Preferred cut style (optional)"
                  name={`pet-${idx}-cut`}
                  value={p.preferredCutStyle}
                  onChange={(v) => patchPet(idx, 'preferredCutStyle', v)}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addPet}
              className="block min-h-[44px] w-full rounded-lg border border-dashed border-gray-300 px-4 text-sm font-medium text-gray-700"
            >
              + Add another pet
            </button>
          </section>

          {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Save client'}
          </button>
        </form>
      </div>
    </main>
  );
}
