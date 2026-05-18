import { useState } from 'react';
import type { AppointmentOutput } from '@mygroomtime/shared';
import { CompleteTipStep } from './complete-modal-tip';
import { CompleteRebookStep } from './complete-modal-rebook';

type Step = 'tip' | 'rebook';

type Props = {
  appointment: AppointmentOutput;
  defaultIntervalWeeks: number;
  busy: boolean;
  completeError: string | null;
  rebookError: string | null;
  rebookConflictMessage: string | null;
  onComplete: (tipCents: number) => Promise<boolean>;
  onRebook: (intervalWeeks: number) => Promise<boolean>;
  onClose: () => void;
};

export function CompleteModal({
  appointment,
  defaultIntervalWeeks,
  busy,
  completeError,
  rebookError,
  rebookConflictMessage,
  onComplete,
  onRebook,
  onClose,
}: Props): JSX.Element {
  // why: when the drawer's "Rebook" button is clicked on an already-completed
  // appointment, we skip the tip step entirely. The drawer hands us the appointment
  // with status='completed' as the entry signal.
  const [step, setStep] = useState<Step>(
    appointment.status === 'completed' ? 'rebook' : 'tip',
  );

  async function handleTipSubmit(tipCents: number): Promise<void> {
    const ok = await onComplete(tipCents);
    if (ok) setStep('rebook');
  }

  async function handleRebookSubmit(intervalWeeks: number): Promise<void> {
    const ok = await onRebook(intervalWeeks);
    if (ok) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={step === 'tip' ? 'Add tip' : 'Rebook appointment'}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 md:items-center"
    >
      <div className="flex max-h-[95vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl bg-white md:max-h-[90vh] md:rounded-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight">
            {step === 'tip' ? 'Mark complete' : 'Rebook'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-3 text-sm text-gray-600"
          >
            Close
          </button>
        </header>
        <div className="space-y-4 px-4 py-4 text-sm text-gray-800">
          {step === 'tip' ? (
            <CompleteTipStep
              petName={appointment.pet.name}
              basePriceCents={appointment.servicePriceCentsSnapshot}
              submitting={busy}
              error={completeError}
              onSubmit={handleTipSubmit}
              onCancel={onClose}
            />
          ) : (
            <CompleteRebookStep
              petName={appointment.pet.name}
              defaultIntervalWeeks={defaultIntervalWeeks}
              submitting={busy}
              error={rebookError}
              conflictMessage={rebookConflictMessage}
              onSubmit={handleRebookSubmit}
              onSkip={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
