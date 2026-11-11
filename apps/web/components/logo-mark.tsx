/** The Fairshare mark: one source for the public site, sign-in and the app shell. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 22 21"
      fill="none"
      aria-hidden="true"
    >
      <rect width="22" height="5" rx="2.5" fill="currentColor" />
      <rect y="8" width="17" height="5" rx="2.5" fill="currentColor" />
      <rect y="16" width="11" height="5" rx="2.5" fill="currentColor" />
    </svg>
  );
}
