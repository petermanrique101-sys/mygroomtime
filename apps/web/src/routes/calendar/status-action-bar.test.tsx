import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CompletedSummary,
  StatusActionBar,
  TerminalBadge,
} from './status-action-bar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function harness() {
  return {
    onOnTheWay: vi.fn(),
    onStarted: vi.fn(),
    onComplete: vi.fn(),
    onNoShow: vi.fn(),
    onCancel: vi.fn(),
    onRebook: vi.fn(),
  };
}

describe('StatusActionBar', () => {
  it('scheduled → renders all four buttons', () => {
    const h = harness();
    render(<StatusActionBar status="scheduled" busy={false} {...h} />);
    expect(screen.getByRole('button', { name: /Mark On the Way/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mark Started/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mark No-Show/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Cancel$/i })).toBeTruthy();
  });

  it('on_the_way → drops "Mark On the Way", keeps the others', () => {
    const h = harness();
    render(<StatusActionBar status="on_the_way" busy={false} {...h} />);
    expect(screen.queryByRole('button', { name: /Mark On the Way/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Mark Started/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mark No-Show/i })).toBeTruthy();
  });

  it('started → only "Mark Completed"', () => {
    const h = harness();
    render(<StatusActionBar status="started" busy={false} {...h} />);
    expect(screen.queryByRole('button', { name: /Mark On the Way/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark No-Show/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Mark Completed/i })).toBeTruthy();
  });

  it('completed → empty (terminal handled elsewhere)', () => {
    const h = harness();
    const { container } = render(
      <StatusActionBar status="completed" busy={false} {...h} />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('button clicks invoke the right callback', async () => {
    const h = harness();
    render(<StatusActionBar status="scheduled" busy={false} {...h} />);
    await userEvent.click(screen.getByRole('button', { name: /Mark Started/i }));
    expect(h.onStarted).toHaveBeenCalledOnce();
    expect(h.onOnTheWay).not.toHaveBeenCalled();
  });

  it('busy=true disables all buttons', () => {
    const h = harness();
    render(<StatusActionBar status="scheduled" busy={true} {...h} />);
    for (const btn of screen.getAllByRole('button')) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('CompletedSummary', () => {
  it('renders completed time + total + Rebook button', () => {
    const onRebook = vi.fn();
    render(
      <CompletedSummary
        completedAt="2026-05-18T15:30:00.000Z"
        finalAmountCents={10000}
        onRebook={onRebook}
        busy={false}
      />,
    );
    expect(screen.getByText(/\$100\.00 total/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rebook/i })).toBeTruthy();
  });
});

describe('TerminalBadge', () => {
  it('no_show wording mentions deposit retained', () => {
    render(
      <TerminalBadge status="no_show" noShowAt="2026-05-18T15:30:00.000Z" canceledAt={null} />,
    );
    expect(screen.getByText(/Deposit retained/i)).toBeTruthy();
  });
  it('canceled wording', () => {
    render(
      <TerminalBadge
        status="canceled"
        canceledAt="2026-05-18T15:30:00.000Z"
        noShowAt={null}
      />,
    );
    expect(screen.getByText(/Canceled/i)).toBeTruthy();
  });
});
