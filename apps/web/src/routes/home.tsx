import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export default function HomeRoute(): JSX.Element {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  if (!session) return <></>;

  async function onLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-10">
        <div className="mb-4 flex justify-end">
          <Link
            to="/settings/services"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-900"
          >
            Settings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hello {session.user.email} of {session.tenant.businessName}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          You&apos;re signed in. The real home is the calendar (coming soon).
        </p>
        <Link
          to="/clients"
          className="mt-8 block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-center text-base font-semibold leading-[44px] text-white"
        >
          Clients
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className="mt-4 block min-h-[44px] w-full rounded-lg border border-gray-300 px-4 text-base font-medium text-gray-900"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
