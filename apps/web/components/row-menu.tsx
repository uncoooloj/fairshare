"use client";
import React, {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Stand-in for the shared portal ActionMenu (fix/action-menu). Same item shape
 * (`{ id, label, onSelect, disabled }`) and `label` prop, so swapping is an
 * import change. Opens as a fixed layer so table scroll areas don't clip it.
 */
export interface RowMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/** Where a fixed layer goes next to its trigger, kept inside the viewport. */
function layerStyle(trigger: HTMLElement, height: number): CSSProperties {
  const box = trigger.getBoundingClientRect();
  const below = window.innerHeight - box.bottom;
  const top =
    below < height + 12 && box.top > below
      ? Math.max(8, box.top - 6 - height)
      : box.bottom + 6;
  return {
    position: "fixed",
    top,
    right: Math.max(8, window.innerWidth - box.right),
  };
}

export function RowMenu({
  label,
  items,
}: {
  label: string;
  items: RowMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const place = () =>
      trigger.current &&
      setStyle(
        layerStyle(
          trigger.current,
          list.current?.offsetHeight || 44 * items.length,
        ),
      );
    place();
    list.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const close = (event: Event) => {
      const target = event.target as Node;
      if (list.current?.contains(target) || trigger.current?.contains(target))
        return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, items.length]);
  if (!items.length) return null;
  return (
    <span className="row-menu">
      <button
        ref={trigger}
        type="button"
        className="icon-button row-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          // Place it before it renders so nothing jumps or scrolls on open.
          if (!open && trigger.current)
            setStyle(layerStyle(trigger.current, 44 * items.length + 16));
          setOpen((value) => !value);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className="ag-menu-list row-menu-list"
          style={style}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** A hover/focus tooltip on a fixed layer, so table scroll areas don't clip it. */
export function Tip({
  trigger,
  label,
  className = "",
  children,
}: {
  trigger: ReactNode;
  /** Accessible name for the trigger button. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLSpanElement>(null);
  const id = useId();
  const show = () => {
    if (!button.current) return;
    const box = button.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
    const height = body.current?.offsetHeight || 120;
    const top =
      window.innerHeight - box.bottom < height + 12 && box.top > height + 12
        ? box.top - 6 - height
        : box.bottom + 6;
    setStyle({ position: "fixed", top, left, width });
  };
  const hide = () => setStyle(null);
  return (
    <span className={`tip ${className}`.trim()} onMouseLeave={hide}>
      <button
        ref={button}
        type="button"
        className="tip-trigger"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(event) => event.key === "Escape" && hide()}
      >
        {trigger}
      </button>
      <span
        ref={body}
        id={id}
        role="tooltip"
        className="tip-body"
        style={style ?? undefined}
        data-open={style ? "true" : undefined}
      >
        {children}
      </span>
    </span>
  );
}
