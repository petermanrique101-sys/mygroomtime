import type { Appointment, Client, TenantScopedDb } from '@mygroomtime/db';
import { AppointmentStatus } from '@mygroomtime/db';
import { db } from '@mygroomtime/db';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import { coordsKey, resolveAppointmentCoords, type LatLng } from './address.js';

export type OptimizeRouteInput = {
  tenantId: string;
  vehicleId: string;
  date: Date;
  gmaps: GmapsAdapter;
  depotLatLng?: LatLng | null;
  scoped?: TenantScopedDb;
  defaultBufferMin?: number;
};

export type OptimizeRouteStop = {
  appointmentId: string;
  startSuggested: Date;
  durationMin: number;
  driveFromPrevSec: number;
  driveFromPrevMin: number;
};

export type OptimizeRouteOutput = {
  orderedStops: OptimizeRouteStop[];
  totalDriveMin: number;
  depotUsed: boolean;
  warnings: string[];
};

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.scheduled,
  AppointmentStatus.on_the_way,
  AppointmentStatus.started,
];

type RouteAppt = Appointment & { client: Client; pet: { name: string } };

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

async function loadDayApptsForVehicle(
  scoped: TenantScopedDb,
  vehicleId: string,
  date: Date,
): Promise<RouteAppt[]> {
  const rows = (await scoped.appointment.findMany({
    where: {
      vehicleId,
      status: { in: ACTIVE_STATUSES },
      scheduledStart: { gte: startOfDay(date), lte: endOfDay(date) },
    },
    include: { client: true, pet: { select: { name: true } } },
    orderBy: { scheduledStart: 'asc' },
  })) as RouteAppt[];
  return rows;
}

type Node = {
  appt: RouteAppt;
  coords: LatLng | null;
  locked: boolean;
};

function classify(appts: RouteAppt[]): { nodes: Node[]; missingCoords: string[] } {
  const nodes: Node[] = [];
  const missing: string[] = [];
  for (const a of appts) {
    const coords = resolveAppointmentCoords(a, a.client);
    if (!coords) missing.push(a.pet.name);
    nodes.push({ appt: a, coords, locked: a.timeLocked || !coords });
  }
  return { nodes, missingCoords: missing };
}

function uniqueCoords(coords: (LatLng | null)[]): LatLng[] {
  const seen = new Set<string>();
  const out: LatLng[] = [];
  for (const c of coords) {
    if (!c) continue;
    const k = coordsKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

async function buildDriveMatrix(
  gmaps: GmapsAdapter,
  coords: LatLng[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (coords.length === 0) return out;
  const labels = coords.map(coordsKey);
  const res = await gmaps.distanceMatrix({ origins: labels, destinations: labels });
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = 0; j < labels.length; j += 1) {
      const cell = res.rows[i]?.[j];
      if (!cell || cell.status !== 'OK') continue;
      out.set(`${labels[i]}->${labels[j]}`, cell.durationSec);
    }
  }
  return out;
}

function driveSec(
  matrix: Map<string, number>,
  from: LatLng | null,
  to: LatLng | null,
  fallbackSec: number,
): number {
  if (!from || !to) return fallbackSec;
  return matrix.get(`${coordsKey(from)}->${coordsKey(to)}`) ?? fallbackSec;
}

function secToMin(sec: number): number {
  return Math.round(sec / 60);
}

type GreedyState = {
  prevLoc: LatLng | null;
  prevEndMs: number;
  // why: when no depot is configured, the day's first stop has no "previous" leg —
  // there's nothing to drive from. We force driveFromPrev=0 on the first placement
  // in that case. With a depot, the first leg is depot→stop and we report the real time.
  isFirstWithoutDepot: boolean;
};

function pickNearestUnlocked(
  state: GreedyState,
  movable: Node[],
  matrix: Map<string, number>,
  fallbackSec: number,
): { idx: number; driveSec: number } | null {
  if (movable.length === 0) return null;
  let bestIdx = 0;
  let bestDrive = driveSec(matrix, state.prevLoc, movable[0]!.coords, fallbackSec);
  for (let i = 1; i < movable.length; i += 1) {
    const d = driveSec(matrix, state.prevLoc, movable[i]!.coords, fallbackSec);
    if (d < bestDrive) {
      bestDrive = d;
      bestIdx = i;
    }
  }
  return { idx: bestIdx, driveSec: bestDrive };
}

function placeAnchor(
  node: Node,
  state: GreedyState,
  matrix: Map<string, number>,
  fallbackSec: number,
  out: OptimizeRouteStop[],
): number {
  const raw = driveSec(matrix, state.prevLoc, node.coords, fallbackSec);
  const drive = state.isFirstWithoutDepot ? 0 : raw;
  out.push({
    appointmentId: node.appt.id,
    startSuggested: node.appt.scheduledStart,
    durationMin: node.appt.durationMin,
    driveFromPrevSec: drive,
    driveFromPrevMin: secToMin(drive),
  });
  state.prevLoc = node.coords ?? state.prevLoc;
  state.prevEndMs = node.appt.scheduledStart.getTime() + node.appt.durationMin * 60_000;
  state.isFirstWithoutDepot = false;
  return drive;
}

function placeMovable(
  node: Node,
  driveSecValue: number,
  state: GreedyState,
  out: OptimizeRouteStop[],
): number {
  const drive = state.isFirstWithoutDepot ? 0 : driveSecValue;
  const startMs = state.prevEndMs + drive * 1000;
  const start = new Date(startMs);
  out.push({
    appointmentId: node.appt.id,
    startSuggested: start,
    durationMin: node.appt.durationMin,
    driveFromPrevSec: drive,
    driveFromPrevMin: secToMin(drive),
  });
  state.prevLoc = node.coords ?? state.prevLoc;
  state.prevEndMs = startMs + node.appt.durationMin * 60_000;
  state.isFirstWithoutDepot = false;
  return drive;
}

function greedyOrder(
  nodes: Node[],
  depot: LatLng | null,
  matrix: Map<string, number>,
  fallbackSec: number,
): { orderedStops: OptimizeRouteStop[]; totalDriveSec: number } {
  const movable = nodes.filter((n) => !n.locked);
  const anchors = nodes
    .filter((n) => n.locked)
    .sort((a, b) => a.appt.scheduledStart.getTime() - b.appt.scheduledStart.getTime());

  const earliestStart = nodes.reduce(
    (min, n) => Math.min(min, n.appt.scheduledStart.getTime()),
    Number.POSITIVE_INFINITY,
  );
  const startLoc = depot ?? movable[0]?.coords ?? anchors[0]?.coords ?? null;

  const state: GreedyState = {
    prevLoc: startLoc,
    prevEndMs: earliestStart,
    isFirstWithoutDepot: depot === null,
  };
  const out: OptimizeRouteStop[] = [];
  let totalDriveSec = 0;

  while (movable.length > 0 || anchors.length > 0) {
    const nextAnchor = anchors[0] ?? null;

    if (movable.length === 0 && nextAnchor) {
      totalDriveSec += placeAnchor(nextAnchor, state, matrix, fallbackSec, out);
      anchors.shift();
      continue;
    }

    const pick = pickNearestUnlocked(state, movable, matrix, fallbackSec);
    if (!pick) break;
    const candidate = movable[pick.idx]!;
    const candidateStartMs = state.prevEndMs + pick.driveSec * 1000;
    const candidateEndMs = candidateStartMs + candidate.appt.durationMin * 60_000;

    if (nextAnchor) {
      const driveToAnchorSec = driveSec(
        matrix,
        candidate.coords,
        nextAnchor.coords,
        fallbackSec,
      );
      const anchorMs = nextAnchor.appt.scheduledStart.getTime();
      if (candidateEndMs + driveToAnchorSec * 1000 > anchorMs) {
        // why: inserting the candidate before the anchor would push past the locked
        // start time. Jump straight to the anchor to respect the lock.
        totalDriveSec += placeAnchor(nextAnchor, state, matrix, fallbackSec, out);
        anchors.shift();
        continue;
      }
    }

    totalDriveSec += placeMovable(candidate, pick.driveSec, state, out);
    movable.splice(pick.idx, 1);
  }

  return { orderedStops: out, totalDriveSec };
}

export async function optimizeRoute(input: OptimizeRouteInput): Promise<OptimizeRouteOutput> {
  const scoped = input.scoped ?? db.forTenant(input.tenantId);
  const fallbackSec = (input.defaultBufferMin ?? 15) * 60;

  const appts = await loadDayApptsForVehicle(scoped, input.vehicleId, input.date);
  if (appts.length === 0) {
    return { orderedStops: [], totalDriveMin: 0, depotUsed: false, warnings: [] };
  }

  const { nodes, missingCoords } = classify(appts);
  const warnings: string[] = [];
  for (const petName of missingCoords) {
    warnings.push(
      `Appointment for ${petName} has no address coordinates — leaving in scheduled order.`,
    );
  }

  const depot = input.depotLatLng ?? null;
  const depotUsed = depot !== null;
  if (!depotUsed) {
    warnings.push(
      'No depot configured — using the first appointment as the start anchor. Set your depot in Settings.',
    );
  }

  const allCoords = uniqueCoords([depot, ...nodes.map((n) => n.coords)]);
  const matrix = await buildDriveMatrix(input.gmaps, allCoords);

  const { orderedStops, totalDriveSec } = greedyOrder(nodes, depot, matrix, fallbackSec);

  return {
    orderedStops,
    totalDriveMin: secToMin(totalDriveSec),
    depotUsed,
    warnings,
  };
}
