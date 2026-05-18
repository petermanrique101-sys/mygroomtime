import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createMemorySessionStore } from '../adapters/session/index.js';
import {
  consumeJti,
  issueRescheduleToken,
  verifyRescheduleToken,
} from './reschedule-tokens.js';

const SECRET = 'test-reschedule-secret-32-bytes-pad!';

function future(hoursAhead: number): Date {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
}

describe('reschedule-tokens — issue + verify roundtrip', () => {
  it('issued token verifies with the same secret and surfaces claims', async () => {
    const sessionStore = createMemorySessionStore();
    const { token, jti } = await issueRescheduleToken({
      appointmentId: 'appt-1',
      tenantId: 'tenant-1',
      scheduledStart: future(72),
      webOrigin: 'http://localhost:5173',
      tenantSlug: 'planopupspa',
      secret: SECRET,
      sessionStore,
    });
    const verify = await verifyRescheduleToken(token, SECRET);
    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.claims.appointmentId).toBe('appt-1');
      expect(verify.claims.tenantId).toBe('tenant-1');
      expect(verify.claims.jti).toBe(jti);
    }
    await sessionStore.close();
  });

  it('URL embeds tenant slug as subdomain of WEB_ORIGIN host', async () => {
    const sessionStore = createMemorySessionStore();
    const { url } = await issueRescheduleToken({
      appointmentId: 'a',
      tenantId: 't',
      scheduledStart: future(72),
      webOrigin: 'http://localhost:5173',
      tenantSlug: 'planopupspa',
      secret: SECRET,
      sessionStore,
    });
    expect(url.startsWith('http://planopupspa.localhost:5173/public/reschedule/')).toBe(true);
    await sessionStore.close();
  });

  it('invalid signature is rejected', async () => {
    const sessionStore = createMemorySessionStore();
    const { token } = await issueRescheduleToken({
      appointmentId: 'a',
      tenantId: 't',
      scheduledStart: future(72),
      webOrigin: 'http://localhost:5173',
      tenantSlug: 'slug',
      secret: SECRET,
      sessionStore,
    });
    const result = await verifyRescheduleToken(token, 'wrong-secret-here-32-bytes-of-pad!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
    await sessionStore.close();
  });

  it('expired token is rejected', async () => {
    // why: directly mint a JWT with exp=1 to confirm verify maps to the expired branch
    const past = new SignJWT({
      type: 'reschedule',
      appointmentId: 'a',
      tenantId: 't',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti('jti-x')
      .setExpirationTime(1);
    const token = await past.sign(new TextEncoder().encode(SECRET));
    const result = await verifyRescheduleToken(token, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('jti is single-use: first consume returns true, second returns false', async () => {
    const sessionStore = createMemorySessionStore();
    const { jti } = await issueRescheduleToken({
      appointmentId: 'a',
      tenantId: 't',
      scheduledStart: future(72),
      webOrigin: 'http://localhost:5173',
      tenantSlug: 'slug',
      secret: SECRET,
      sessionStore,
    });
    expect(await consumeJti(sessionStore, jti)).toBe(true);
    expect(await consumeJti(sessionStore, jti)).toBe(false);
    await sessionStore.close();
  });
});
