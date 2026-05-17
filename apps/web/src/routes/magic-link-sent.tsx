import { Link } from 'react-router-dom';

export default function MagicLinkSentRoute(): JSX.Element {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mb-6 text-sm text-gray-600">
          If an account with that email exists, we just sent a sign-in link. The link expires in 15 minutes.
        </p>
        <Link to="/login" className="text-sm text-gray-700 underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
