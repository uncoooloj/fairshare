import type { Ref } from "react";
import { XIcon } from "./icons";

/** Icon-only ×: the one way to close a panel, drawer, dialog or banner. 32px target (44px on phones). */
export function CloseButton({
  onClick,
  label = "Close",
  disabled,
  autoFocus,
  className,
  ref,
}: {
  onClick: () => void;
  /** Accessible name, e.g. "Close notifications". */
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** The button, e.g. to focus it when a panel opens. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={["icon-button", "close-button", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={label}
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={onClick}
    >
      <XIcon />
    </button>
  );
}
