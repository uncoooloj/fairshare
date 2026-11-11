"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const TOAST_DURATION_MS = 4000;

export type ToastMessage = { id: number; message: string };

/** One confirmation at a time, with a fresh lifetime for every successful action. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const sequence = useRef(0);
  const showToast = useCallback((message: string) => {
    setToast({ id: ++sequence.current, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, showToast };
}

/** Keep the live region mounted before its content changes; never move focus. */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  return (
    <div
      className="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toast && (
        <div className="toast" key={toast.id}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
