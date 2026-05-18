export type TwinMessageDirection = 'out' | 'in';

export type TwinMessage = {
  sid: string;
  accountSid: string;
  from: string;
  to: string;
  body: string;
  direction: TwinMessageDirection;
  status: 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';
  statusCallback: string | null;
  dateCreated: string;
};

export class IdAllocator {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `SM_TWIN_${this.counter}`;
  }
  nextInbound(): string {
    this.counter += 1;
    return `SM_TWIN_IN_${this.counter}`;
  }
}

export type IdempotencyEntry = { sid: string; createdAtMs: number };

export class TwinState {
  readonly messages: TwinMessage[] = [];
  readonly idempotency = new Map<string, IdempotencyEntry>();
  readonly ids = new IdAllocator();

  reset(): void {
    this.messages.length = 0;
    this.idempotency.clear();
  }
}
