import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { OfflineBanner } from './offline-banner';
import {
  __resetOfflineDbForTest,
  clear,
  enqueue,
  type QueuedMutation,
} from '../lib/offline-queue';
import { notifyOfflineQueueChanged } from '../lib/offline-bus';

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

function row(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: overrides.id ?? `id-${Math.random()}`,
    endpoint: '/appointments',
    method: 'POST',
    body: null,
    headers: {},
    resourceType: 'appointment',
    resourceId: null,
    createdAt: Date.now(),
    attempts: 0,
    status: overrides.status ?? 'pending',
    lastError: null,
    conflictServerStatus: null,
    conflictServerBody: null,
    label: overrides.label ?? 'New appointment',
  };
}

describe('OfflineBanner', () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(async () => {
    cleanup();
    await clear();
    __resetOfflineDbForTest();
    setOnline(true);
  });

  it('renders nothing when online + queue empty', async () => {
    const { container } = render(<OfflineBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="offline-banner"]')).toBeNull();
    });
  });

  it('shows "Offline — N changes queued" when offline + queue non-empty', async () => {
    await enqueue(row());
    await enqueue(row());
    render(<OfflineBanner />);
    act(() => {
      setOnline(false);
      notifyOfflineQueueChanged();
    });
    await waitFor(() => {
      expect(screen.getByText(/Offline — 2 changes queued/i)).toBeInTheDocument();
    });
  });

  it('shows "Syncing — N left" when online + pending', async () => {
    await enqueue(row());
    render(<OfflineBanner />);
    act(() => {
      notifyOfflineQueueChanged();
    });
    await waitFor(() => {
      expect(screen.getByText(/Syncing — 1 left/i)).toBeInTheDocument();
    });
  });

  it('shows "N changes need attention" when conflicts exist', async () => {
    await enqueue(row({ status: 'conflict' }));
    render(<OfflineBanner />);
    act(() => {
      notifyOfflineQueueChanged();
    });
    await waitFor(() => {
      expect(screen.getByText(/1 change need(s)? attention/i)).toBeInTheDocument();
    });
  });
});
