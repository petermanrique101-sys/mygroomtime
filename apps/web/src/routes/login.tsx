import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export default function LoginRoute(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await login({ email, password });
    setBusy(false);
    if (result.ok) navigate('/home', { replace: true });
    else setError(result.error.message);
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 text-sm text-gray-500">Welcome back to MyGroomTime.</p>
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
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="mt-6 space-y-2 text-sm">
          <Link to="/magic-link" className="block text-gray-700 underline">
            Email me a magic link instead
          </Link>
          <Link to="/signup" className="block text-gray-700 underline">
            Create a new business account
          </Link>
        </div>
      </div>
    </main>
  );
}
