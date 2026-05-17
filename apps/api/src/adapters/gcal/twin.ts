import type {
  GcalAdapter,
  GcalAdapterEnv,
  GcalCalendar,
  GcalTokens,
  GcalRefreshedToken,
  ExchangeOAuthCodeInput,
  RefreshAccessTokenInput,
  ListCalendarsInput,
  InsertEventInput,
  InsertEventOutput,
  UpdateEventInput,
  UpdateEventOutput,
  DeleteEventInput,
  ListEventsInput,
  ListEventsOutput,
  WatchChannelInput,
  WatchChannelOutput,
} from './types.js';

function notImplemented(method: string): never {
  throw new Error(`not implemented: gcal.twin.${method}`);
}

export function createGcalTwinAdapter(_env: GcalAdapterEnv): GcalAdapter {
  return {
    mode: 'twin',
    async exchangeOAuthCode(_input: ExchangeOAuthCodeInput): Promise<GcalTokens> {
      notImplemented('exchangeOAuthCode');
    },
    async refreshAccessToken(
      _input: RefreshAccessTokenInput,
    ): Promise<GcalRefreshedToken> {
      notImplemented('refreshAccessToken');
    },
    async listCalendars(_input: ListCalendarsInput): Promise<GcalCalendar[]> {
      notImplemented('listCalendars');
    },
    async insertEvent(_input: InsertEventInput): Promise<InsertEventOutput> {
      notImplemented('insertEvent');
    },
    async updateEvent(_input: UpdateEventInput): Promise<UpdateEventOutput> {
      notImplemented('updateEvent');
    },
    async deleteEvent(_input: DeleteEventInput): Promise<void> {
      notImplemented('deleteEvent');
    },
    async listEvents(_input: ListEventsInput): Promise<ListEventsOutput> {
      notImplemented('listEvents');
    },
    async watchChannel(_input: WatchChannelInput): Promise<WatchChannelOutput> {
      notImplemented('watchChannel');
    },
  };
}
