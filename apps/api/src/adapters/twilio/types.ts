export type TwilioMode = 'live' | 'twin';

export type TwilioAdapterEnv = {
  mode: TwilioMode;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  twinUrl: string;
};

export type SendSmsInput = {
  to: string;
  body: string;
  statusCallback?: string;
};
export type SendSmsOutput = { sid: string };

export type VerifyTwilioWebhookInput = {
  url: string;
  params: Record<string, string>;
  signature: string;
  authToken: string;
};

export interface TwilioAdapter {
  readonly mode: TwilioMode;
  sendSms(input: SendSmsInput): Promise<SendSmsOutput>;
  verifyWebhookSignature(input: VerifyTwilioWebhookInput): Promise<boolean>;
}
