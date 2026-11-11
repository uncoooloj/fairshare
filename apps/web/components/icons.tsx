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
