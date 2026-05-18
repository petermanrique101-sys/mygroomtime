import { Link } from 'react-router-dom';

const SECTIONS: { to: string; title: string; description: string }[] = [
  {
    to: '/settings/services',
    title: 'Services',
    description: 'Service menu, prices, deposits, calendar colors.',
  },
  {
    to: '/settings/payments',
    title: 'Payments',
    description: 'Connect Stripe to take customer deposits.',
  },
];

export default function SettingsIndexRoute(): JSX.Element {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/home" className="text-sm text-gray-600 underline">
              ← Home
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Settings</h1>
            <span className="w-12" />
          </div>
        </header>
        <section className="flex-1 px-4 py-4">
          <ul className="space-y-3">
            {SECTIONS.map((s) => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  className="block rounded-lg border border-gray-200 p-4 hover:bg-gray-50"
                >
                  <div className="text-base font-semibold">{s.title}</div>
                  <p className="mt-0.5 text-sm text-gray-500">{s.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
