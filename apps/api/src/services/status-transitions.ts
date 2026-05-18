import { AppointmentStatus } from '@mygroomtime/db';

export type TransitionReason = 'terminal' | 'invalid_edge' | 'unknown_status';

export class TransitionError extends Error {
  constructor(
    readonly reason: TransitionReason,
    readonly current: AppointmentStatus,
    readonly attempted: AppointmentStatus,
  ) {
    super(`Invalid status transition: ${current} -> ${attempted} (${reason})`);
    this.name = 'TransitionError';
  }
}

// why: the matrix is the contract. Lookup-by-current returns the set of statuses the
// owner is allowed to move the appointment into. Anything outside that set is rejected
// with TransitionError(reason='invalid_edge') so callers can render a coherent message
// ("can't mark a canceled appointment on-the-way") instead of a generic 4xx.
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  [AppointmentStatus.scheduled]: [
    AppointmentStatus.on_the_way,
    AppointmentStatus.started,
    AppointmentStatus.canceled,
    AppointmentStatus.no_show,
  ],
  [AppointmentStatus.on_the_way]: [
    AppointmentStatus.started,
    AppointmentStatus.canceled,
    AppointmentStatus.no_show,
  ],
  [AppointmentStatus.started]: [AppointmentStatus.completed],
  [AppointmentStatus.completed]: [],
  [AppointmentStatus.canceled]: [],
  [AppointmentStatus.no_show]: [],
};

const TERMINAL: ReadonlySet<AppointmentStatus> = new Set([
  AppointmentStatus.completed,
  AppointmentStatus.canceled,
  AppointmentStatus.no_show,
]);

export function getValidNextStatuses(
  current: AppointmentStatus,
): readonly AppointmentStatus[] {
  return TRANSITIONS[current] ?? [];
}

export function isTerminal(status: AppointmentStatus): boolean {
  return TERMINAL.has(status);
}

export function assertTransitionAllowed(
  current: AppointmentStatus,
  next: AppointmentStatus,
): void {
  const allowed = TRANSITIONS[current];
  if (!allowed) {
    throw new TransitionError('unknown_status', current, next);
  }
  if (TERMINAL.has(current)) {
    throw new TransitionError('terminal', current, next);
  }
  if (!allowed.includes(next)) {
    throw new TransitionError('invalid_edge', current, next);
  }
}
