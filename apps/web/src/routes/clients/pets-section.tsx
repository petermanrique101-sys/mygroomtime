import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  COAT_TYPES,
  PetInputSchema,
  type CoatType,
  type PetOutput,
} from '@mygroomtime/shared';
import { addPet, deletePet } from '../../lib/clients-api';
import { SelectField, TextField } from './form-fields';

type Props = {
  clientId: string;
  pets: PetOutput[];
};

type Draft = {
  name: string;
  breed: string;
  weightLb: string;
  coatType: CoatType;
  preferredCutStyle: string;
};

const emptyDraft = (): Draft => ({
  name: '',
  breed: '',
  weightLb: '',
  coatType: 'short',
  preferredCutStyle: '',
});

export function PetsSection({ clientId, pets }: Props): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: async (input: Draft) => {
      const parsed = PetInputSchema.safeParse({
        name: input.name,
        breed: input.breed,
        weightLb: input.weightLb === '' ? null : Number(input.weightLb),
        coatType: input.coatType,
        preferredCutStyle: input.preferredCutStyle,
      });
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.');
          if (!next[key]) next[key] = issue.message;
        }
        setErrors(next);
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid pet.');
      }
      const res = await addPet(clientId, parsed.data);
      if (!res.ok) throw new Error(res.error.message);
      return res.data.pet;
    },
    onSuccess: async () => {
      setShowForm(false);
      setDraft(emptyDraft());
      setErrors({});
      await qc.invalidateQueries({ queryKey: ['client', clientId] });
      await qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (petId: string) => {
      const res = await deletePet(clientId, petId);
      if (!res.ok) throw new Error(res.error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['client', clientId] });
    },
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pets</h2>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="min-h-[44px] text-sm font-semibold text-gray-900 underline"
          >
            + Add pet
          </button>
        ) : null}
      </div>

      {pets.length === 0 ? (
        <p className="text-sm text-gray-500">No pets yet.</p>
      ) : (
        <ul className="space-y-2">
          {pets.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900">{p.name}</div>
                <div className="text-sm text-gray-500">
                  {p.breed}
                  {p.weightLb !== null ? ` · ${p.weightLb} lb` : ''} · {p.coatType}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remove ${p.name}?`)) deleteMutation.mutate(p.id);
                }}
                className="min-h-[44px] px-2 text-sm text-red-600 underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            addMutation.mutate(draft);
          }}
          className="space-y-3 rounded-lg border border-gray-200 p-3"
          noValidate
        >
          <TextField
            label="Name"
            name="new-pet-name"
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            required
            error={errors.name}
          />
          <TextField
            label="Breed"
            name="new-pet-breed"
            value={draft.breed}
            onChange={(v) => setDraft((d) => ({ ...d, breed: v }))}
            required
            error={errors.breed}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Weight (lb)"
              name="new-pet-weight"
              inputMode="numeric"
              value={draft.weightLb}
              onChange={(v) => setDraft((d) => ({ ...d, weightLb: v }))}
              error={errors.weightLb}
            />
            <SelectField
              label="Coat"
              name="new-pet-coat"
              value={draft.coatType}
              onChange={(v) => setDraft((d) => ({ ...d, coatType: v as CoatType }))}
              options={COAT_TYPES}
            />
          </div>
          <TextField
            label="Preferred cut style"
            name="new-pet-cut"
            value={draft.preferredCutStyle}
            onChange={(v) => setDraft((d) => ({ ...d, preferredCutStyle: v }))}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="block min-h-[44px] flex-1 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {addMutation.isPending ? 'Saving…' : 'Add pet'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setDraft(emptyDraft());
                setErrors({});
                setError(null);
              }}
              className="block min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
