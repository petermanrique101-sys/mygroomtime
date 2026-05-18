import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoShowConfirm } from './no-show-confirm';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NoShowConfirm', () => {
  it('states deposit retention amount and pet name', () => {
    render(
      <NoShowConfirm
        petName="Buddy"
        depositCents={2000}
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Mark Buddy as a no-show\?/i)).toBeTruthy();
    // depositCents=2000 => $20.00 via centsToDollarString helper
    expect(screen.getByText(/\$20\.00 deposit/i)).toBeTruthy();
    expect(screen.getByText(/retained per your booking terms/i)).toBeTruthy();
  });

  it('Confirm + Back invoke the right callbacks', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <NoShowConfirm
        petName="Rex"
        depositCents={0}
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Yes, mark no-show/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('busy=true disables Confirm', () => {
    render(
      <NoShowConfirm
        petName="Rex"
        depositCents={2000}
        busy={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByRole('button', {
      name: /Yes, mark no-show/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
