import type { AppointmentStatus } from '@mygroomtime/shared';

type Props = {
  status: AppointmentStatus;
  busy: boolean;
  onOnTheWay: () => void;
  onStarted: () => void;
  onComplete: () => void;
  onNoShow: () => void;
  onCancel: () => void;
  onRebook: () => void;
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function StatusActionBar(props: Props): JSX.Element {
  const { status, busy } = props;
  if (status === 'scheduled') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <ActionPrimary disabled={busy} onClick={props.onOnTheWay}>
          Mark On the Way
        </ActionPrimary>
        <ActionPrimary disabled={busy} onClick={props.onStarted}>
          Mark Started
        </ActionPrimary>
        <ActionDanger disabled={busy} onClick={props.onNoShow}>
          Mark No-Show
        </ActionDanger>
        <ActionDanger disabled={busy} onClick={props.onCancel}>
          Cancel
        </ActionDanger>
      </div>
    );
  }
  if (status === 'on_the_way') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <ActionPrimary disabled={busy} onClick={props.onStarted}>
          Mark Started
        </ActionPrimary>
        <ActionDanger disabled={busy} onClick={props.onNoShow}>
          Mark No-Show
        </ActionDanger>
        <ActionDanger disabled={busy} onClick={props.onCancel} className="col-span-2">
          Cancel
        </ActionDanger>
      </div>
    );
  }
  if (status === 'started') {
    return (
      <ActionPrimary disabled={busy} onClick={props.onComplete} fullWidth>
        Mark Completed
      </ActionPrimary>
    );
  }
  return <></>;
}

export function CompletedSummary({
  completedAt,
  finalAmountCents,
  onRebook,
  busy,
}: {
  completedAt: string | null;
  finalAmountCents: number | null;
  onRebook: () => void;
  busy: boolean;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900">
        Completed{completedAt ? ` at ${formatTime(completedAt)}` : ''}
        {finalAmountCents != null ? ` · $${(finalAmountCents / 100).toFixed(2)} total` : ''}
      </div>
      <ActionPrimary disabled={busy} onClick={onRebook} fullWidth>
        Rebook
      </ActionPrimary>
    </div>
  );
}

export function TerminalBadge({
  status,
  noShowAt,
  canceledAt,
}: {
  status: AppointmentStatus;
  noShowAt: string | null;
  canceledAt: string | null;
}): JSX.Element {
  if (status === 'canceled') {
    return (
      <div className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
        Canceled{canceledAt ? ` at ${formatTime(canceledAt)}` : ''}.
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      No-show{noShowAt ? ` recorded at ${formatTime(noShowAt)}` : ''}. Deposit retained.
    </div>
  );
}

function ActionPrimary({
  children,
  onClick,
  disabled,
  fullWidth,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  fullWidth?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white disabled:opacity-50 ${
        fullWidth ? 'block w-full' : ''
      }`}
    >
      {children}
    </button>
  );
}

function ActionDanger({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[44px] rounded-lg border border-red-300 px-3 text-sm font-medium text-red-700 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
