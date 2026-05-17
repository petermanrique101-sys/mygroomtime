import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ClientOutput } from '@mygroomtime/shared';
import { listClients } from '../../lib/clients-api';

function ClientRow({ c }: { c: ClientOutput }): JSX.Element {
  return (
    <li className="border-b border-gray-100 last:border-0">
      <Link
        to={`/clients/${c.id}`}
        className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-3 active:bg-gray-50"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-gray-900">{c.name}</div>
          <div className="truncate text-sm text-gray-500">
            {c.phone}
            {!c.addressVerified ? (
              <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                address unverified
              </span>
            ) : null}
          </div>
        </div>
        <span className="text-gray-300">›</span>
      </Link>
    </li>
  );
}

export default function ClientsListRoute(): JSX.Element {
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['clients', search],
    queryFn: async () => {
      const res = await listClients(search.trim() || undefined);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
            <Link
              to="/clients/new"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white"
            >
              + New client
            </Link>
          </div>
          <input
            type="search"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-3 block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
          />
        </header>

        <div className="flex-1">
          {query.isLoading ? (
            <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="px-4 py-6 text-sm text-red-600">{(query.error as Error).message}</p>
          ) : query.data && query.data.clients.length > 0 ? (
            <ul>
              {query.data.clients.map((c) => (
                <ClientRow key={c.id} c={c} />
              ))}
            </ul>
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-gray-500">No clients yet.</p>
              <Link
                to="/clients/new"
                className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white"
              >
                Add your first client
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
