import type { Appointment, Client, TenantScopedDb } from '@mygroomtime/db';
import { AppointmentStatus } from '@mygroomtime/db';
import { db } from '@mygroomtime/db';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import { coordsKey, resolveAppointmentCoords, type LatLng } from './address.js';

export type BufferEntry = { beforeBufferMin: number; afterBufferMin: number };
export type BufferMap = Map<string, BufferEntry>;

export type BuffersInput = {
  tenantId: string;
  date: Date;
  gmaps: GmapsAdapter;
  defaultBufferMin: number;
  scoped?: TenantScopedDb;
};

type ChronologicalAppt = Appointment & { client: Client };

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.scheduled,
  AppointmentStatus.on_the_way,
  AppointmentStatus.started,
  AppointmentStatus.completed,
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function loadDayAppointments(
  scoped: TenantScopedDb,
  date: Date,
): Promise<ChronologicalAppt[]> {
  const rows = (await scoped.appointment.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      scheduledStart: { gte: startOfDay(date), lte: endOfDay(date) },
    },
    include: { client: true },
    orderBy: { scheduledStart: 'asc' },
  })) as ChronologicalAppt[];
  return rows;
}

function groupByVehicle(appts: ChronologicalAppt[]): Map<string, ChronologicalAppt[]> {
  const out = new Map<string, ChronologicalAppt[]>();
  for (const a of appts) {
    const key = a.vehicleId ?? '__no_vehicle__';
    const list = out.get(key) ?? [];
    list.push(a);
    out.set(key, list);
  }
  for (const list of out.values()) {
    list.sort((x, y) => x.scheduledStart.getTime() - y.scheduledStart.getTime());
  }
  return out;
}

type Pair = { fromKey: string; toKey: string; from: LatLng; to: LatLng };

function collectPairs(groups: Map<string, ChronologicalAppt[]>): {
  pairs: Pair[];
  coordsByAppt: Map<string, LatLng | null>;
} {
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  const coordsByAppt = new Map<string, LatLng | null>();

  for (const list of groups.values()) {
    for (const a of list) {
      coordsByAppt.set(a.id, resolveAppointmentCoords(a, a.client));
    }
    for (let i = 0; i < list.length - 1; i += 1) {
      const fromA = list[i]!;
      const toA = list[i + 1]!;
      const from = coordsByAppt.get(fromA.id) ?? null;
      const to = coordsByAppt.get(toA.id) ?? null;
      if (!from || !to) continue;
      const fromKey = coordsKey(from);
      const toKey = coordsKey(to);
      const dedupKey = `${fromKey}->${toKey}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      pairs.push({ fromKey, toKey, from, to });
    }
  }
  return { pairs, coordsByAppt };
}

async function batchedDriveMinutes(
  gmaps: GmapsAdapter,
  pairs: Pair[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (pairs.length === 0) return out;

  const origins = Array.from(new Set(pairs.map((p) => p.fromKey)));
  const destinations = Array.from(new Set(pairs.map((p) => p.toKey)));
  const originIndex = new Map(origins.map((k, i) => [k, i]));
  const destIndex = new Map(destinations.map((k, i) => [k, i]));

  const res = await gmaps.distanceMatrix({ origins, destinations });
  for (const p of pairs) {
    const r = originIndex.get(p.fromKey);
    const c = destIndex.get(p.toKey);
    if (r === undefined || c === undefined) continue;
    const cell = res.rows[r]?.[c];
    if (!cell || cell.status !== 'OK') continue;
    const minutes = Math.max(1, Math.round(cell.durationSec / 60));
    out.set(`${p.fromKey}->${p.toKey}`, minutes);
  }
  return out;
}

export async function computeDayBuffers(input: BuffersInput): Promise<BufferMap> {
  const scoped = input.scoped ?? db.forTenant(input.tenantId);
  const appts = await loadDayAppointments(scoped, input.date);
  return computeBuffersFromAppointments(appts, input.gmaps, input.defaultBufferMin);
}

export async function computeBuffersFromAppointments(
  appts: ChronologicalAppt[],
  gmaps: GmapsAdapter,
  defaultBufferMin: number,
): Promise<BufferMap> {
  const out: BufferMap = new Map();
  for (const a of appts) {
    out.set(a.id, { beforeBufferMin: defaultBufferMin, afterBufferMin: defaultBufferMin });
  }

  const groups = groupByVehicle(appts);
  const { pairs, coordsByAppt } = collectPairs(groups);

  let drive: Map<string, number>;
  try {
    drive = await batchedDriveMinutes(gmaps, pairs);
  } catch {
    // why: any gmaps failure falls back to defaultBufferMinutes for all appointments —
    // a calendar that fails open is worse than one that uses the conservative fallback.
    return out;
  }

  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const current = list[i]!;
      const prev = i > 0 ? list[i - 1]! : null;
      const next = i < list.length - 1 ? list[i + 1]! : null;
      const entry = out.get(current.id)!;

      if (prev) {
        const from = coordsByAppt.get(prev.id) ?? null;
        const to = coordsByAppt.get(current.id) ?? null;
        if (from && to) {
          const k = `${coordsKey(from)}->${coordsKey(to)}`;
          const m = drive.get(k);
          if (m !== undefined) entry.beforeBufferMin = m;
        }
      }
      if (next) {
        const from = coordsByAppt.get(current.id) ?? null;
        const to = coordsByAppt.get(next.id) ?? null;
        if (from && to) {
          const k = `${coordsKey(from)}->${coordsKey(to)}`;
          const m = drive.get(k);
          if (m !== undefined) entry.afterBufferMin = m;
        }
      }
    }
  }
  return out;
}

export async function loadTenantDefaultBufferMin(tenantId: string): Promise<number> {
  const t = await db.global.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultBufferMinutes: true },
  });
  return t?.defaultBufferMinutes ?? 15;
}
