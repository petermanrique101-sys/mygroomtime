import { usePageTitle } from './page-title';

export default function PublicManageNotImplementedRoute(): JSX.Element {
  usePageTitle('Manage booking');
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="border-b border-gray-100 px-4 pb-4 pt-6">
          <h1 className="text-2xl font-semibold tracking-tight">Manage booking</h1>
        </header>
        <section className="flex-1 px-4 py-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Coming soon</p>
            <p className="mt-1">
              Self-serve rescheduling is in the next release. Your booking is still
              confirmed — contact the groomer to make changes.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
