export type TwinEvent = {
  id: string;
  calendarId: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  status: 'confirmed' | 'cancelled';
  extendedProperties: { private: Record<string, string> };
  updated: string;
  createdAt: string;
};

export type TwinTokenGrant = {
  code: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresAt: number;
};

export type TwinWatchChannel = {
  channelId: string;
  resourceId: string;
  calendarId: string;
  accessToken: string;
  webhookUrl: string;
  token: string | null;
  expirationMs: number;
};

export type TwinSyncSnapshot = {
  token: string;
  calendarId: string;
  // why: a syncToken is "everything before this point is consumed". Subsequent
  // listEvents(syncToken) returns events with `updated > issuedAtMs`. We store the
  // issued time so the query is straightforward; restart re-issues 410-like behavior.
  issuedAtMs: number;
};

export type TwinDeliveryRecord = {
  at: string;
  channelId: string;
  status: number;
  error: string | null;
};

export class IdAllocator {
  private c = 0;
  next(prefix: string): string {
    this.c += 1;
    return `${prefix}_${this.c}`;
  }
}

export class TwinState {
  readonly events = new Map<string, TwinEvent>();
  readonly tokens = new Map<string, TwinTokenGrant>();
  readonly tokensByAccess = new Map<string, TwinTokenGrant>();
  readonly tokensByRefresh = new Map<string, TwinTokenGrant>();
  readonly watchChannels = new Map<string, TwinWatchChannel>();
  readonly syncTokens = new Map<string, TwinSyncSnapshot>();
  readonly deliveries: TwinDeliveryRecord[] = [];
  readonly ids = new IdAllocator();
  readonly bootedAtMs = Date.now();

  reset(): void {
    this.events.clear();
    this.tokens.clear();
    this.tokensByAccess.clear();
    this.tokensByRefresh.clear();
    this.watchChannels.clear();
    this.syncTokens.clear();
    this.deliveries.length = 0;
  }
}
