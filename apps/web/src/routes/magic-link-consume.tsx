import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

type State = { kind: 'pending' } | { kind: 'error'; message: string };

export default function MagicLinkConsumeRoute(): JSX.Element {
  const { consumeMagicLink } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>({ kind: 'pending' });

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token. Request a new one.' });
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await consumeMagicLink(token);
      if (cancelled) return;
      if (result.ok) navigate('/home', { replace: true });
      else setState({ kind: 'error', message: result.error.message });
    })();
    return () => {
      cancelled = true;
    };
  }, [params, consumeMagicLink, navigate]);

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        {state.kind === 'pending' ? (
          <p className="text-sm text-gray-600">Signing you in…</p>
        ) : (
          <>
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">Sign-in failed</h1>
            <p className="mb-6 text-sm text-red-600">{state.message}</p>
            <Link to="/magic-link" className="text-sm text-gray-700 underline">
              Request a new magic link
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
