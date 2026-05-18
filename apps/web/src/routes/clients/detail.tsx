import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClientUpdateSchema,
  type ClientWithPetsOutput,
} from '@mygroomtime/shared';
import { deleteClient, getClient, updateClient } from '../../lib/clients-api';
import { TextField } from './form-fields';
import { PetsSection } from './pets-section';

type ContactForm = {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

function fromClient(c: ClientWithPetsOutput): ContactForm {
  return {
    name: c.name,
    phone: c.phone,
    email: c.email ?? '',
    street: c.street,
    city: c.city,
    state: c.state,
    zip: c.zip,
    notes: c.notes,
  };
}

export default function ClientDetailRoute(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const res = await getClient(id);
      if (!res.ok) throw new Error(res.error.message);
      return res.data.client;
    },
    enabled: id !== '',
  });

  const [form, setForm] = useState<ContactForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data && form === null) setForm(fromClient(query.data));
  }, [query.data, form]);

  const updateMutation = useMutation({
    mutationFn: async (input: ContactForm) => {
      const parsed = ClientUpdateSchema.safeParse({
        ...input,
        email: input.email.trim() === '' ? null : input.email,
      });
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.');
          if (!next[key]) next[key] = issue.message;
        }
        setErrors(next);
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid update.');
      }
      const res = await updateClient(id, parsed.data);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: async (data) => {
      qc.setQueryData(['client', id], data.client);
      await qc.invalidateQueries({ queryKey: ['clients'] });
      setErrors({});
    },
    onError: (err) => setSaveError((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await deleteClient(id);
      if (!res.ok) throw new Error(res.error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['clients'] });
      navigate('/clients', { replace: true, state: { toast: 'Client removed.' } });
    },
  });

  if (query.isLoading || form === null) {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>
      </main>
    );
  }
  if (query.isError || !query.data) {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <p className="px-4 py-6 text-sm text-red-600">
          {(query.error as Error | undefined)?.message ?? 'Client not found.'}
        </p>
        <Link to="/clients" className="px-4 text-sm text-gray-700 underline">
          Back to clients
        </Link>
      </main>
    );
  }

  const client = query.data;

  function onSave(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setSaveError(null);
    if (form) updateMutation.mutate(form);
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-md px-4 pb-12 pt-5">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/clients" className="text-sm text-gray-600 underline">
            ← Clients
          </Link>
        </div>
        <h1 className="mb-4 text-xl font-semibold tracking-tight">{client.name}</h1>

        {!client.addressVerified ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            We couldn&apos;t verify this address. Edit the street, city, state, or zip and save to retry.
          </div>
        ) : null}

        <form onSubmit={onSave} className="space-y-4" noValidate>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Owner</h2>
            <TextField
              label="Name"
              name="name"
              value={form.name}
              onChange={(v) => setForm((f) => (f ? { ...f, name: v } : f))}
              required
              error={errors.name}
            />
            <div>
              <TextField
                label="Phone"
                name="phone"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(v) => setForm((f) => (f ? { ...f, phone: v } : f))}
                required
                error={errors.phone}
              />
              {client.smsOptOut ? (
                <p
                  className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
                  title="This customer replied STOP to a text. They won't receive any SMS until they text START."
                >
                  Opted out of SMS
                </p>
              ) : null}
            </div>
            <TextField
              label="Email"
              name="email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(v) => setForm((f) => (f ? { ...f, email: v } : f))}
              error={errors.email}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Address</h2>
            <TextField
              label="Street"
              name="street"
              value={form.street}
              onChange={(v) => setForm((f) => (f ? { ...f, street: v } : f))}
              required
              error={errors.street}
            />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <TextField
                  label="City"
                  name="city"
                  value={form.city}
                  onChange={(v) => setForm((f) => (f ? { ...f, city: v } : f))}
                  required
                  error={errors.city}
                />
              </div>
              <TextField
                label="State"
                name="state"
                value={form.state}
                onChange={(v) => setForm((f) => (f ? { ...f, state: v.toUpperCase() } : f))}
                required
                error={errors.state}
              />
            </div>
            <TextField
              label="Zip"
              name="zip"
              inputMode="numeric"
              value={form.zip}
              onChange={(v) => setForm((f) => (f ? { ...f, zip: v } : f))}
              required
              error={errors.zip}
            />
          </section>

          {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <div className="mt-8">
          <PetsSection clientId={client.id} pets={client.pets} />
        </div>

        <div className="mt-10 border-t border-gray-100 pt-6">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Remove ${client.name}? Their history will be kept.`)) {
                deleteMutation.mutate();
              }
            }}
            className="block min-h-[44px] w-full rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700"
          >
            Remove client
          </button>
        </div>
      </div>
    </main>
  );
}
