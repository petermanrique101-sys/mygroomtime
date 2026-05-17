import type { CookieSerializeOptions } from '@fastify/cookie';

export const SESSION_COOKIE = 'mgt_session';
export const SESSION_TTL_SEC = 60 * 60 * 24 * 14;

export function sessionCookieOptions(isProd: boolean): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    signed: true,
    maxAge: SESSION_TTL_SEC,
  };
}

export function clearedCookieOptions(isProd: boolean): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    signed: true,
    maxAge: 0,
  };
}
