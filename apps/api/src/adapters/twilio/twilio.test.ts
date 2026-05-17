import { describe, it, expect } from 'vitest';
import { createTwilioAdapter } from './index.js';
import type { TwilioAdapterEnv } from './types.js';

const baseEnv: Omit<TwilioAdapterEnv, 'mode'> = {
  accountSid: 'AC_test',
  authToken: 'auth_test',
  fromNumber: '+15555550100',
  twinUrl: 'http://localhost:4243',
};

describe('twilio adapter — scaffold', () => {
  it('twin instance throws "not implemented: twilio.twin.<method>"', async () => {
    const adapter = createTwilioAdapter({ ...baseEnv, mode: 'twin' });
    expect(adapter.mode).toBe('twin');
    await expect(
      adapter.sendSms({ to: '+15555550111', body: 'hi' }),
    ).rejects.toThrow('not implemented: twilio.twin.sendSms');
  });

  it('live instance throws "not implemented: twilio.live.<method>"', async () => {
    const adapter = createTwilioAdapter({ ...baseEnv, mode: 'live' });
    expect(adapter.mode).toBe('live');
    await expect(
      adapter.sendSms({ to: '+15555550111', body: 'hi' }),
    ).rejects.toThrow('not implemented: twilio.live.sendSms');
  });
});
