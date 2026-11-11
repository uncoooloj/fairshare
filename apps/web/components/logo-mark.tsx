/** The Fairshare mark: one source for the public site, sign-in and the app shell. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.75"
        y="2.75"
        width="18.5"
        height="18.5"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="6.5" y="6" width="2" height="12" rx="1" fill="currentColor" />
      <rect x="11" y="6" width="2" height="12" rx="1" fill="currentColor" />
      <rect x="15.5" y="6" width="2" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}
