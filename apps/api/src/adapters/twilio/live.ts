import Twilio from 'twilio';
import type {
  TwilioAdapter,
  TwilioAdapterEnv,
  SendSmsInput,
  SendSmsResult,
  VerifyTwilioWebhookInput,
} from './types.js';
import {
  runSendSms,
  verifyWebhookSignature,
  type DoSendResult,
  type SendDeps,
} from './compose.js';

const consoleLog: SendDeps['log'] = {
  info: (o, msg) => console.log(JSON.stringify({ level: 'info', msg, ...o })),
  warn: (o, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...o })),
};

export function createTwilioLiveAdapter(env: TwilioAdapterEnv): TwilioAdapter {
  // why: pass empty fallbacks so import-time construction with empty env doesn't throw
  // in tests/dev. Actual SMS sends still fail at the API call boundary if creds are bad.
  const client = Twilio(env.accountSid || 'AC_unconfigured', env.authToken || 'unconfigured');

  const deps: SendDeps = {
    fromNumber: env.fromNumber,
    log: consoleLog,
    async doSend({ to, from, body }): Promise<DoSendResult> {
      try {
        const msg = await client.messages.create({ to, from, body });
        if (!msg.sid) {
          return { ok: false, errorMessage: 'twilio response missing sid' };
        }
        return { ok: true, twilioSid: msg.sid };
      } catch (err) {
        // why: NEVER include the body or the to/from numbers in the log payload —
        // those are PII. The Twilio SDK error has .code + .message that are safe.
        const e = err as { code?: number | string; message?: string };
        const code = e.code !== undefined ? String(e.code) : 'unknown';
        const message = e.message ?? 'unknown error';
        return { ok: false, errorMessage: `twilio_${code}: ${message}` };
      }
    },
  };

  return {
    mode: 'live',
    sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      return runSendSms(input, deps);
    },
    verifyWebhookSignature(input: VerifyTwilioWebhookInput): boolean {
      return verifyWebhookSignature(env.authToken, input);
    },
  };
}
