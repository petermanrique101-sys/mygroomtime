import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export default function MagicLinkRoute(): JSX.Element {
  const { requestMagicLink } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBusy(true);
    await requestMagicLink({ email });
    setBusy(false);
    navigate('/magic-link/sent', { replace: true });
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Email me a magic link</h1>
        <p className="mb-6 text-sm text-gray-500">
          Enter your email and we&apos;ll send a link that signs you in instantly.
        </p>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
        <Link to="/login" className="mt-6 block text-sm text-gray-700 underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
