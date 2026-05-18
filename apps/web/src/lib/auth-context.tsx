import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AuthSession,
  LoginRequest,
  MagicLinkRequest,
  SignupRequest,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Status = 'loading' | 'authed' | 'anonymous';

type Result = { ok: true } | { ok: false; error: ApiError };

type AuthContextValue = {
  status: Status;
  session: AuthSession | null;
  refresh: () => Promise<void>;
  login: (req: LoginRequest) => Promise<Result>;
  signup: (req: SignupRequest) => Promise<Result>;
  logout: () => Promise<void>;
  requestMagicLink: (req: MagicLinkRequest) => Promise<Result>;
  consumeMagicLink: (token: string) => Promise<Result>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const refresh = useCallback(async () => {
    const res = await apiFetch<AuthSession>('/me');
    if (res.ok) {
      setSession(res.data);
      setStatus('authed');
    } else {
      setSession(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback<AuthContextValue['login']>(async (req) => {
    const res = await apiFetch<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    if (!res.ok) return { ok: false, error: res.error };
    setSession(res.data);
    setStatus('authed');
    return { ok: true };
  }, []);

  const signup = useCallback<AuthContextValue['signup']>(async (req) => {
    const res = await apiFetch<AuthSession>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    if (!res.ok) return { ok: false, error: res.error };
    setSession(res.data);
    setStatus('authed');
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
    setSession(null);
    setStatus('anonymous');
  }, []);

  const requestMagicLink = useCallback<AuthContextValue['requestMagicLink']>(async (req) => {
    const res = await apiFetch<void>('/auth/magic-link/request', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }, []);

  const consumeMagicLink = useCallback<AuthContextValue['consumeMagicLink']>(async (token) => {
    const res = await apiFetch<AuthSession>('/auth/magic-link/consume', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return { ok: false, error: res.error };
    setSession(res.data);
    setStatus('authed');
    return { ok: true };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, refresh, login, signup, logout, requestMagicLink, consumeMagicLink }),
    [status, session, refresh, login, signup, logout, requestMagicLink, consumeMagicLink],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

// why: chunk-9 calendar.test.tsx renders <CalendarRoute /> without AuthProvider. Chunk 16
// added a need to read tenant.plan from inside the route (route-optimization is Pro+).
// `useAuthOptional` lets the route degrade to "no session known" instead of crashing
// pre-existing tests we can't touch (constitution + 400-LOC carveout).
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
