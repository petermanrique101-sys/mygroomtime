import type {
  TwilioAdapter,
  TwilioAdapterEnv,
  SendSmsInput,
  SendSmsOutput,
  VerifyTwilioWebhookInput,
} from './types.js';

function notImplemented(method: string): never {
  throw new Error(`not implemented: twilio.live.${method}`);
}

export function createTwilioLiveAdapter(_env: TwilioAdapterEnv): TwilioAdapter {
  return {
    mode: 'live',
    async sendSms(_input: SendSmsInput): Promise<SendSmsOutput> {
      notImplemented('sendSms');
    },
    async verifyWebhookSignature(_input: VerifyTwilioWebhookInput): Promise<boolean> {
      notImplemented('verifyWebhookSignature');
    },
  };
}
