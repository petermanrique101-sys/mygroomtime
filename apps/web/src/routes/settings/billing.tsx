import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PaidPlanTier,
  PreviewPlanChangeResponse,
  SettingsBillingResponse,
} from '@mygroomtime/shared';
import {
  confirmPlanChange,
  fetchSettingsBilling,
  openPortalSession,
  previewPlanChange,
} from '../../lib/settings-billing-api.js';
import { BillingTierCard, TIERS } from './billing-tier-card';
import { BillingPreviewModal } from './billing-preview-modal';
import { centsToDollarString } from './money';

const QUERY_KEY = ['settings-billing'] as const;
const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 30_000;

type ModalState =
  | { kind: 'closed' }
  | { kind: 'loading-preview'; targetPlan: PaidPlanTier }
  | { kind: 'open'; targetPlan: PaidPlanTier; preview: PreviewPlanChangeResponse };

function planTier(plan: SettingsBillingResponse['plan']): PaidPlanTier | null {
  if (plan === 'starter' || plan === 'pro' || plan === 'business') return plan;
  return null;
}

function tierLabel(t: PaidPlanTier): string {
  if (t === 'starter') return 'Starter';
  if (t === 'pro') return 'Pro';
  return 'Business';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function SettingsBillingRoute(): JSX.Element {
  const qc = useQueryClient();
  const query = useQuery<SettingsBillingResponse, Error>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetchSettingsBilling();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  const [topError, setTopError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const currentTier = useMemo(
    () => (query.data ? planTier(query.data.plan) : null),
    [query.data],
  );

  function stopPolling(): void {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setPolling(false);
  }

  function startPolling(awaitedTier: PaidPlanTier): void {
    const started = Date.now();
    setPolling(true);
    const tick = async (): Promise<void> => {
      const res = await fetchSettingsBilling();
      if (res.ok) {
        qc.setQueryData(QUERY_KEY, res.data);
        if (res.data.plan === awaitedTier) {
          stopPolling();
          setToast(`Now on ${tierLabel(awaitedTier)}.`);
          return;
        }
      }
      if (Date.now() - started > POLL_DEADLINE_MS) {
        stopPolling();
        setToast('Plan change taking longer than expected. Refresh in a moment.');
        return;
      }
      pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    pollTimer.current = window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function onSwitch(target: PaidPlanTier): Promise<void> {
    setTopError(null);
    setModal({ kind: 'loading-preview', targetPlan: target });
    const res = await previewPlanChange(target);
    if (!res.ok) {
      setModal({ kind: 'closed' });
      setTopError(res.error.message);
      return;
    }
    setModal({ kind: 'open', targetPlan: target, preview: res.data });
    setModalError(null);
  }

  const confirmMut = useMutation({
    mutationFn: async (target: PaidPlanTier) => {
      const res = await confirmPlanChange(target);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (_, target) => {
      setModal({ kind: 'closed' });
      setModalError(null);
      setToast('Plan change in progress — your account will update in a moment.');
      startPolling(target);
    },
    onError: (err) => setModalError((err as Error).message),
  });

  const portalMut = useMutation({
    mutationFn: async () => {
      const res = await openPortalSession();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      window.location.assign(data.url);
    },
    onError: (err) => setTopError((err as Error).message),
  });

  const data = query.data;
  const periodEndLabel = formatDate(data?.currentPeriodEnd ?? null);
  const currentPrice =
    currentTier && data
      ? data.available.find((a) => a.tier === currentTier)?.priceMonthlyCents ?? 0
      : 0;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/settings" className="text-sm text-gray-600 underline">
              ← Settings
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Billing</h1>
            <span className="w-12" />
          </div>
        </header>

        <section className="flex-1 space-y-5 px-4 py-4">
          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="text-sm text-red-700">{(query.error as Error).message}</p>
          ) : data ? (
            <>
              <div className="rounded-xl border border-gray-200 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Current plan
                </p>
                <p className="mt-1 text-lg font-semibold">
                  {currentTier
                    ? `${tierLabel(currentTier)} — $${centsToDollarString(currentPrice)}/mo`
                    : data.plan === 'past_due'
                      ? 'Past due'
                      : data.plan === 'canceled'
                        ? 'Canceled'
                        : 'No active plan'}
                </p>
                {currentTier ? (
                  <p className="mt-1 text-sm text-gray-600">
                    Next charge: ${centsToDollarString(currentPrice)} on {periodEndLabel}.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => portalMut.mutate()}
                  disabled={portalMut.isPending}
                  className="mt-4 block min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 disabled:opacity-50"
                >
                  {portalMut.isPending
                    ? 'Opening Stripe…'
                    : 'Update card / Manage subscription'}
                </button>
              </div>

              {topError ? (
                <p role="alert" className="text-sm text-red-700">
                  {topError}
                </p>
              ) : null}
              {toast ? (
                <p
                  role="status"
                  className="rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white"
                >
                  {toast}
                </p>
              ) : null}

              <div className="space-y-3">
                {TIERS.map((t) => {
                  const row = data.available.find((a) => a.tier === t.tier);
                  if (!row) return null;
                  return (
                    <BillingTierCard
                      key={t.tier}
                      tier={t}
                      priceMonthlyCents={row.priceMonthlyCents}
                      isCurrent={currentTier === t.tier}
                      disabled={
                        modal.kind !== 'closed' || confirmMut.isPending || polling
                      }
                      onSwitch={() => void onSwitch(t.tier)}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {modal.kind === 'loading-preview' ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Loading preview"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-sm text-gray-700 shadow-xl">
            Calculating proration…
          </div>
        </div>
      ) : null}

      {modal.kind === 'open' && currentTier ? (
        <BillingPreviewModal
          currentPlan={currentTier}
          preview={modal.preview}
          submitting={confirmMut.isPending}
          error={modalError}
          onConfirm={() => confirmMut.mutate(modal.targetPlan)}
          onCancel={() => {
            setModal({ kind: 'closed' });
            setModalError(null);
          }}
        />
      ) : null}
    </main>
  );
}
