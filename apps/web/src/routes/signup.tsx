import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

export default function SignupRoute(): JSX.Element {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signup({ email, password, businessName });
    setBusy(false);
    if (result.ok) navigate('/home', { replace: true });
    else setError(result.error.message);
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Start your business</h1>
        <p className="mb-6 text-sm text-gray-500">Create your MyGroomTime account.</p>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Business name</span>
            <input
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="block min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base focus:border-gray-900 focus:outline-none"
            />
          </label>
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
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Password <span className="text-gray-400">(10+ characters)</span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
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
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="mt-6 text-sm text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
