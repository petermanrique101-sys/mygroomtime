import type {
  TwilioAdapter,
  TwilioAdapterEnv,
  SendSmsInput,
  SendSmsOutput,
  VerifyTwilioWebhookInput,
} from './types.js';

function notImplemented(method: string): never {
  throw new Error(`not implemented: twilio.twin.${method}`);
}

export function createTwilioTwinAdapter(_env: TwilioAdapterEnv): TwilioAdapter {
  return {
    mode: 'twin',
    async sendSms(_input: SendSmsInput): Promise<SendSmsOutput> {
      notImplemented('sendSms');
    },
    async verifyWebhookSignature(_input: VerifyTwilioWebhookInput): Promise<boolean> {
      notImplemented('verifyWebhookSignature');
    },
  };
}
