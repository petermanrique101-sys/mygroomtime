import { db, isUniqueViolation, WebhookSource, WebhookProcessingStatus } from '@mygroomtime/db';

export type RecordOutcome =
  | { kind: 'new'; id: string }
  | { kind: 'duplicate' };

const DEAD_LETTER_AFTER = 5;

export async function recordIncomingEvent(
  eventId: string,
  payload: unknown,
): Promise<RecordOutcome> {
  try {
    const row = await db.global.webhookEvent.create({
      data: {
        source: WebhookSource.stripe,
        eventId,
        payload: payload as object,
        status: WebhookProcessingStatus.received,
      },
      select: { id: true },
    });
    return { kind: 'new', id: row.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { kind: 'duplicate' };
    }
    throw err;
  }
}

export async function markProcessed(rowId: string): Promise<void> {
  await db.global.webhookEvent.update({
    where: { id: rowId },
    data: { status: WebhookProcessingStatus.processed, processedAt: new Date() },
  });
}

export async function markFailed(rowId: string, message: string): Promise<{ deadLetter: boolean }> {
  const existing = await db.global.$transaction(async (tx) => {
    return tx.webhookEvent.findUnique({
      where: { id: rowId },
      select: { processingError: true },
    });
  });
  const prev = existing?.processingError ?? '';
  const attempts = countAttempts(prev) + 1;
  await db.global.webhookEvent.update({
    where: { id: rowId },
    data: {
      status: WebhookProcessingStatus.failed,
      processingError: `${prev}${prev ? '\n' : ''}attempt ${attempts}: ${truncate(message, 500)}`,
    },
  });
  return { deadLetter: attempts >= DEAD_LETTER_AFTER };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function countAttempts(s: string): number {
  if (!s) return 0;
  return s.split('\n').filter((line) => line.startsWith('attempt ')).length;
}
