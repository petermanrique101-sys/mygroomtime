import type { GcalEvent } from '../adapters/gcal/index.js';

// why: read full Appointment shape but only need a thin set. Keep the type local so
// service tests can construct fixtures without pulling Prisma.
export type ConflictAppointment = {
  id: string;
  scheduledStart: Date;
  durationMin: number;
  notes: string;
  status: string;
  updatedAt: Date;
};

export type ConflictResolution =
  | { kind: 'no_tag'; reason: 'no_mgt_tag' }
  | { kind: 'no_change' }
  | {
      kind: 'theirs_wins';
      patch: { scheduledStart?: Date; durationMin?: number; notes?: string };
    }
  | { kind: 'ours_wins' }
  | { kind: 'cancel_ours' };

// why: lexicographic compare on (externalUpdated, ourUpdated) ISO strings. Both come
// from the same clock domain (server time on each side); strings compare correctly so
// we don't have to parse + numeric-compare to milliseconds. Our-wins on tie keeps the
// rule "if both sides changed within the same second, our row is canonical."
export function resolveConflict(args: {
  ours: ConflictAppointment;
  theirs: GcalEvent;
  ourUpdatedIso?: string;
}): ConflictResolution {
  const tag = args.theirs.extendedProperties.private.mgtAppointmentId;
  if (!tag || tag !== args.ours.id) {
    return { kind: 'no_tag', reason: 'no_mgt_tag' };
  }

  if (args.theirs.status === 'cancelled') {
    return { kind: 'cancel_ours' };
  }

  const theirsUpdated = args.theirs.updated;
  const oursUpdated = args.ourUpdatedIso ?? args.ours.updatedAt.toISOString();
  if (oursUpdated >= theirsUpdated) {
    return { kind: 'ours_wins' };
  }

  const theirStart = new Date(args.theirs.start);
  const theirEnd = new Date(args.theirs.end);
  const theirDurationMin = Math.max(1, Math.round((theirEnd.getTime() - theirStart.getTime()) / 60000));
  const theirNotes = extractNotes(args.theirs.description);

  const startChanged = theirStart.getTime() !== args.ours.scheduledStart.getTime();
  const durationChanged = theirDurationMin !== args.ours.durationMin;
  const notesChanged = theirNotes !== args.ours.notes;
  if (!startChanged && !durationChanged && !notesChanged) {
    return { kind: 'no_change' };
  }

  const patch: { scheduledStart?: Date; durationMin?: number; notes?: string } = {};
  if (startChanged) patch.scheduledStart = theirStart;
  if (durationChanged) patch.durationMin = theirDurationMin;
  if (notesChanged) patch.notes = theirNotes;
  return { kind: 'theirs_wins', patch };
}

function extractNotes(description: string | undefined): string {
  if (!description) return '';
  // why: our push side renders the description as `{notes}\n\n{addressBlock}`. We pull
  // back the notes portion (everything before the blank-line address block). If the user
  // edited only the address line in Google we don't propagate that to notes — addresses
  // live on the Client / addressOverride columns and aren't editable via GCal in v1.
  const split = description.split(/\n\n/);
  return (split[0] ?? '').trim();
}
