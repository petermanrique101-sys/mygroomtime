export type TwilioMode = 'live' | 'twin';

export type TwilioAdapterEnv = {
  mode: TwilioMode;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  twinUrl: string;
};

export type SendSmsInput = {
  toE164: string;
  body: string;
  idempotencyKey: string;
  tenantId: string;
  clientId: string;
  appointmentId?: string;
};

export type SendSmsFailureReason =
  | 'tier_gated'
  | 'opted_out'
  | 'duplicate'
  | 'truncated_blocked'
  | 'error';

export type SendSmsResult =
  | { sent: true; twilioSid: string; smsMessageId: string }
  | { sent: false; reason: SendSmsFailureReason; smsMessageId: string };

export type VerifyTwilioWebhookInput = {
  url: string;
  params: Record<string, string>;
  signature: string;
};

export interface TwilioAdapter {
  readonly mode: TwilioMode;
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  verifyWebhookSignature(input: VerifyTwilioWebhookInput): boolean;
}
