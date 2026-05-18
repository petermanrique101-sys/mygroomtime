import { openDB, type IDBPDatabase, type DBSchema } from 'idb';

// why: bumping this schema version triggers an upgrade migration. v1 is the chunk-18
// shape. The conflict columns and resourceType were already in v1 so chunk-22's operator
// log doesn't need to re-rev — but if we ever need to add a new column or index we
// upgrade here so existing-user IndexedDB stores survive.
const DB_NAME = 'mygroomtime-offline';
const DB_VERSION = 1;
const STORE = 'mutations';

export type QueuedMutationStatus = 'pending' | 'syncing' | 'conflict';

export type QueuedMutation = {
  id: string;
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body: unknown;
  headers: Record<string, string>;
  resourceType: string;
  resourceId: string | null;
  createdAt: number;
  attempts: number;
  status: QueuedMutationStatus;
  lastError: string | null;
  // why: when a 4xx lands the user needs to see what THEY tried and what the server says
  // now. We hold the server's response body so the modal can render side-by-side without
  // a second fetch.
  conflictServerStatus: number | null;
  conflictServerBody: unknown | null;
  // why: stable identifier used by the queued-mutations modal to render a human title
  // ("Mark started for Bruno"). Owned by the caller.
  label: string;
};

interface OfflineDbSchema extends DBSchema {
  [STORE]: {
    key: string;
    value: QueuedMutation;
    indexes: { 'by-createdAt': number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<OfflineDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('by-createdAt', 'createdAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueue(m: QueuedMutation): Promise<void> {
  const db = await getDb();
  await db.put(STORE, m);
}

export async function peekAll(): Promise<QueuedMutation[]> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readonly');
  const all = await tx.store.index('by-createdAt').getAll();
  return all;
}

export async function dequeue(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function markFailed(id: string, reason: string): Promise<void> {
  const db = await getDb();
  const row = await db.get(STORE, id);
  if (!row) return;
  await db.put(STORE, {
    ...row,
    status: 'conflict',
    lastError: reason,
  });
}

export async function markSyncing(id: string): Promise<void> {
  const db = await getDb();
  const row = await db.get(STORE, id);
  if (!row) return;
  await db.put(STORE, { ...row, status: 'syncing' });
}

export async function markPending(id: string, attempts: number, error: string | null): Promise<void> {
  const db = await getDb();
  const row = await db.get(STORE, id);
  if (!row) return;
  await db.put(STORE, { ...row, status: 'pending', attempts, lastError: error });
}

export async function attachConflictDetails(
  id: string,
  serverStatus: number,
  serverBody: unknown,
): Promise<void> {
  const db = await getDb();
  const row = await db.get(STORE, id);
  if (!row) return;
  await db.put(STORE, {
    ...row,
    status: 'conflict',
    conflictServerStatus: serverStatus,
    conflictServerBody: serverBody,
  });
}

export async function clear(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

// why: tests can hot-swap the underlying connection by calling this. NOT used in app code.
export function __resetOfflineDbForTest(): void {
  dbPromise = null;
}
