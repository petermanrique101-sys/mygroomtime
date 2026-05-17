import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context.js';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

type Status = 'polling' | 'detected' | 'timeout';

export default function SignupBillingSuccessRoute(): JSX.Element {
  const { refresh, session } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>('polling');

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    async function tick(): Promise<void> {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      if (Date.now() - start >= POLL_TIMEOUT_MS) {
        setStatus('timeout');
        return;
      }
      setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (status !== 'polling') return;
    if (session && session.tenant.plan !== 'unpaid') {
      setStatus('detected');
      const t = setTimeout(() => navigate('/calendar', { replace: true }), 600);
      return () => clearTimeout(t);
    }
    return;
  }, [session, status, navigate]);

  const sessionId = params.get('session') ?? '';

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 py-10 text-center">
        {status === 'polling' && (
          <>
            <h1 className="text-xl font-semibold">Activating your account…</h1>
            <p className="mt-2 text-sm text-gray-500">
              We&apos;re waiting on Stripe to confirm{' '}
              <span className="font-mono text-xs">{sessionId.slice(0, 18) || 'your session'}</span>.
            </p>
          </>
        )}
        {status === 'detected' && (
          <>
            <h1 className="text-xl font-semibold">Subscription active</h1>
            <p className="mt-2 text-sm text-gray-500">Redirecting to your calendar…</p>
          </>
        )}
        {status === 'timeout' && (
          <>
            <h1 className="text-xl font-semibold">Payment confirmed</h1>
            <p className="mt-2 text-sm text-gray-500">
              We&apos;re still setting things up. Refresh in a moment — the rest happens
              automatically.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white"
            >
              Refresh
            </button>
          </>
        )}
      </div>
    </main>
  );
}
