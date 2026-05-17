export type GcalMode = 'live' | 'twin';

export type GcalAdapterEnv = {
  mode: GcalMode;
  oauthClientId: string;
  oauthClientSecret: string;
  twinUrl: string;
};

export type GcalTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
export type GcalRefreshedToken = {
  accessToken: string;
  expiresAt: number;
};

export type GcalCalendar = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
};

export type GcalEventInput = {
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendees?: { email: string }[];
};
export type GcalEventPatch = Partial<GcalEventInput>;
export type GcalEvent = {
  id: string;
  summary?: string;
  description?: string;
  start: string;
  end: string;
};

export type ExchangeOAuthCodeInput = { code: string; redirectUri: string };
export type RefreshAccessTokenInput = { refreshToken: string };

export type ListCalendarsInput = { accessToken: string };

export type InsertEventInput = {
  accessToken: string;
  calendarId: string;
  event: GcalEventInput;
};
export type InsertEventOutput = { id: string };

export type UpdateEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  patch: GcalEventPatch;
};
export type UpdateEventOutput = { id: string };

export type DeleteEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
};

export type ListEventsInput = {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
};
export type ListEventsOutput = {
  events: GcalEvent[];
  nextSyncToken: string | null;
};

export type WatchChannelInput = {
  accessToken: string;
  calendarId: string;
  webhookUrl: string;
};
export type WatchChannelOutput = {
  channelId: string;
  resourceId: string;
  expiration: number;
};

export interface GcalAdapter {
  readonly mode: GcalMode;
  exchangeOAuthCode(input: ExchangeOAuthCodeInput): Promise<GcalTokens>;
  refreshAccessToken(input: RefreshAccessTokenInput): Promise<GcalRefreshedToken>;
  listCalendars(input: ListCalendarsInput): Promise<GcalCalendar[]>;
  insertEvent(input: InsertEventInput): Promise<InsertEventOutput>;
  updateEvent(input: UpdateEventInput): Promise<UpdateEventOutput>;
  deleteEvent(input: DeleteEventInput): Promise<void>;
  listEvents(input: ListEventsInput): Promise<ListEventsOutput>;
  watchChannel(input: WatchChannelInput): Promise<WatchChannelOutput>;
}
