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
  googleUserId: string;
  googleEmail: string | null;
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

export type GcalExtendedPrivate = Record<string, string>;

export type GcalEventInput = {
  summary: string;
  description?: string;
  start: string;
  end: string;
  status?: 'confirmed' | 'cancelled';
  extendedProperties?: { private?: GcalExtendedPrivate };
};
export type GcalEventPatch = Partial<GcalEventInput>;
export type GcalEvent = {
  id: string;
  summary?: string;
  description?: string;
  start: string;
  end: string;
  status: 'confirmed' | 'cancelled';
  extendedProperties: { private: GcalExtendedPrivate };
  updated: string;
};

export type ExchangeOAuthCodeInput = { code: string; redirectUri: string };
export type RefreshAccessTokenInput = { refreshToken: string };
export type RevokeTokenInput = { refreshToken: string };

export type ListCalendarsInput = { accessToken: string };

export type InsertEventInput = {
  accessToken: string;
  calendarId: string;
  event: GcalEventInput;
};
export type InsertEventOutput = { id: string; updated: string };

export type UpdateEventInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  patch: GcalEventPatch;
};
export type UpdateEventOutput = { id: string; updated: string };

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
  fullResyncRequired?: boolean;
};

export type WatchChannelInput = {
  accessToken: string;
  calendarId: string;
  webhookUrl: string;
  channelId: string;
  channelToken: string;
  ttlSeconds?: number;
};
export type WatchChannelOutput = {
  channelId: string;
  resourceId: string;
  expirationMs: number;
};

export type StopChannelInput = {
  accessToken: string;
  channelId: string;
  resourceId: string;
};

export interface GcalAdapter {
  readonly mode: GcalMode;
  exchangeOAuthCode(input: ExchangeOAuthCodeInput): Promise<GcalTokens>;
  refreshAccessToken(input: RefreshAccessTokenInput): Promise<GcalRefreshedToken>;
  revokeRefreshToken(input: RevokeTokenInput): Promise<void>;
  listCalendars(input: ListCalendarsInput): Promise<GcalCalendar[]>;
  insertEvent(input: InsertEventInput): Promise<InsertEventOutput>;
  updateEvent(input: UpdateEventInput): Promise<UpdateEventOutput>;
  deleteEvent(input: DeleteEventInput): Promise<void>;
  listEvents(input: ListEventsInput): Promise<ListEventsOutput>;
  watchChannel(input: WatchChannelInput): Promise<WatchChannelOutput>;
  stopChannel(input: StopChannelInput): Promise<void>;
}
