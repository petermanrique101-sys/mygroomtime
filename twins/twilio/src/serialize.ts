import type { TwinMessage } from './state.js';

export function serializeMessage(m: TwinMessage): Record<string, unknown> {
  return {
    sid: m.sid,
    account_sid: m.accountSid,
    from: m.from,
    to: m.to,
    body: m.body,
    direction: m.direction === 'out' ? 'outbound-api' : 'inbound',
    status: m.status,
    date_created: m.dateCreated,
    date_sent: null,
    error_code: null,
    error_message: null,
    num_segments: '1',
    num_media: '0',
    price: null,
    price_unit: 'USD',
    uri: `/2010-04-01/Accounts/${m.accountSid}/Messages/${m.sid}.json`,
  };
}
