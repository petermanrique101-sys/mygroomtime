import { useEffect } from 'react';

type Props = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: Props): JSX.Element | null {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, 4500);
    return () => clearTimeout(id);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-lg">
        {message}
      </div>
    </div>
  );
}
