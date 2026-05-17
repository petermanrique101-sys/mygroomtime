import type { TwinEvent, TwinState } from './state.js';
import { signPayload } from './signature.js';

export type WebhookConfig = {
  url: string | null;
  secret: string;
};

export type DeliveryResult =
  | { ok: true; status: number; body: string }
  | { ok: false; reason: 'no-url' | 'fetch-failed' | 'http-error'; status?: number; error?: string };

export async function deliverEvent(
  cfg: WebhookConfig,
  event: TwinEvent,
): Promise<DeliveryResult> {
  if (!cfg.url) return { ok: false, reason: 'no-url' };
  const payload = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signPayload(cfg.secret, ts, payload);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: payload,
    });
    const body = await res.text();
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, body };
    }
    return { ok: false, reason: 'http-error', status: res.status, error: body };
  } catch (err) {
    return { ok: false, reason: 'fetch-failed', error: (err as Error).message };
  }
}

export function recordEvent(
  state: TwinState,
  type: string,
  object: Record<string, unknown>,
): TwinEvent {
  const event: TwinEvent = {
    id: state.ids.next('evt'),
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  state.events.set(event.id, event);
  return event;
}
