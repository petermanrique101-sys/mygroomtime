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

export function createTwilioTwinAdapter(env: TwilioAdapterEnv): TwilioAdapter {
  const deps: SendDeps = {
    fromNumber: env.fromNumber,
    log: consoleLog,
    async doSend({ to, from, body }): Promise<DoSendResult> {
      const url = `${env.twinUrl.replace(/\/+$/, '')}/2010-04-01/Accounts/${env.accountSid}/Messages.json`;
      const formBody = new URLSearchParams({ From: from, To: to, Body: body }).toString();
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: formBody,
        });
        if (res.status < 200 || res.status >= 300) {
          const text = await res.text();
          return { ok: false, errorMessage: `twin returned ${res.status}: ${text.slice(0, 200)}` };
        }
        const json = (await res.json()) as { sid?: unknown };
        if (typeof json.sid !== 'string') {
          return { ok: false, errorMessage: 'twin response missing sid' };
        }
        return { ok: true, twilioSid: json.sid };
      } catch (err) {
        return { ok: false, errorMessage: (err as Error).message };
      }
    },
  };

  return {
    mode: 'twin',
    sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      return runSendSms(input, deps);
    },
    verifyWebhookSignature(input: VerifyTwilioWebhookInput): boolean {
      return verifyWebhookSignature(env.authToken, input);
    },
  };
}
