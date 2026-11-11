/** Small stroke icons shared across the app. Decorative: always pair with visible text or an aria-label. */
function Stroke({ size, d }: { size: number; d: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-icon"
    >
      <path d={d} />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: { size?: number }) {
  return <Stroke size={size} d="M12 5v14M5 12h14" />;
}

export function ChevronRightIcon({ size = 16 }: { size?: number }) {
  return <Stroke size={size} d="m9 6 6 6-6 6" />;
}

export function PaymentIcon({ size = 14 }: { size?: number }) {
  return <Stroke size={size} d="M3 7h18v10H3zM3 11h18M7 15h3" />;
}

export function XIcon({ size = 18 }: { size?: number }) {
  return <Stroke size={size} d="M6 6l12 12M18 6 6 18" />;
}

export function GearIcon({ size = 18 }: { size?: number }) {
  return (
    <Stroke
      size={size}
      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
    />
  );
}
