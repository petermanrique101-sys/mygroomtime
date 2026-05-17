import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context.js';

const UNPAID_ALLOWED_PATHS: ReadonlyArray<string> = [
  '/signup/billing',
  '/signup/billing/success',
];

const CANCELED_ALLOWED_PATHS: ReadonlyArray<string> = ['/billing', '/signup/billing'];

function isAllowed(pathname: string, allowed: ReadonlyArray<string>): boolean {
  return allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function RequireAnon({ children }: { children: ReactNode }): JSX.Element {
  const { status, session } = useAuth();
  if (status === 'loading') return <></>;
  if (status === 'authed') {
    if (session?.tenant.plan === 'unpaid') return <Navigate to="/signup/billing" replace />;
    return <Navigate to="/calendar" replace />;
  }
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <></>;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function BillingGuard({ children }: { children: ReactNode }): JSX.Element {
  const { session, status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <></>;
  if (!session) return <>{children}</>;

  const plan = session.tenant.plan;

  if (plan === 'unpaid' && !isAllowed(location.pathname, UNPAID_ALLOWED_PATHS)) {
    return <Navigate to="/signup/billing" replace />;
  }
  if (plan === 'canceled' && !isAllowed(location.pathname, CANCELED_ALLOWED_PATHS)) {
    return <Navigate to="/billing" replace />;
  }
  return <>{children}</>;
}
