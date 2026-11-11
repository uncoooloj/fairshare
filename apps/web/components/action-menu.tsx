"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

export enum MenuTone {
  DEFAULT = "default",
  DANGER = "danger",
}

/** Which trigger edge the menu lines up with. */
export enum MenuAlign {
  END = "end",
  START = "start",
}

export enum MenuPlacement {
  BELOW = "below",
  ABOVE = "above",
}

/** Things that close (or toggle) the menu. */
export enum MenuEvent {
  TOGGLE = "toggle",
  ESCAPE = "escape",
  OUTSIDE = "outside",
  SELECT = "select",
  TAB = "tab",
}

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: MenuTone;
  disabled?: boolean;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Gap between trigger and menu, and the smallest distance kept from the viewport edge. */
const GAP = 6;
const MARGIN = 8;

/**
 * Where the menu goes, in viewport (fixed) coordinates. It opens below unless
 * it would not fit there and there is more room above, and it never leaves the
 * viewport horizontally.
 */
export function menuPosition(
  trigger: Box,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  align: MenuAlign = MenuAlign.END,
): { top: number; left: number; placement: MenuPlacement } {
  const below = viewport.height - (trigger.top + trigger.height) - GAP;
  const above = trigger.top - GAP;
  const placement =
    menu.height + MARGIN > below && above > below
      ? MenuPlacement.ABOVE
      : MenuPlacement.BELOW;
  const rawTop =
    placement === MenuPlacement.BELOW
      ? trigger.top + trigger.height + GAP
      : trigger.top - GAP - menu.height;
  const top = Math.max(
    MARGIN,
    Math.min(rawTop, viewport.height - menu.height - MARGIN),
  );
  const rawLeft =
    align === MenuAlign.END
      ? trigger.left + trigger.width - menu.width
      : trigger.left;
  const left = Math.max(
    MARGIN,
    Math.min(rawLeft, viewport.width - menu.width - MARGIN),
  );
  return { top, left, placement };
}

/**
 * The item index an arrow, Home or End key moves to, skipping disabled items.
 * Null when the key is not a navigation key or nothing can take focus.
 */
export function nextMenuIndex(
  key: string,
  current: number,
  disabled: boolean[],
): number | null {
  const enabled = disabled.flatMap((off, index) => (off ? [] : [index]));
  if (!enabled.length) return null;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  const at = enabled.indexOf(current);
  if (key === "ArrowDown")
    return at < 0 ? enabled[0] : enabled[(at + 1) % enabled.length];
  if (key === "ArrowUp")
    return at < 0
      ? enabled[enabled.length - 1]
      : enabled[(at - 1 + enabled.length) % enabled.length];
  return null;
}

/**
 * Open state after an event, and whether focus goes back to the trigger.
 * Outside clicks leave focus where the person sent it. Tab hands focus to the
 * trigger first, so the browser's own Tab then moves on from there instead of
 * from the end of the page, where the portalled list lives.
 */
export function menuTransition(
  open: boolean,
  event: MenuEvent,
): { open: boolean; restoreFocus: boolean } {
  if (event === MenuEvent.TOGGLE) return { open: !open, restoreFocus: open };
  if (!open) return { open: false, restoreFocus: false };
  return {
    open: false,
    restoreFocus: event !== MenuEvent.OUTSIDE,
  };
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="13" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * A "…" button that opens a list of actions. The list renders in a portal on
 * document.body, so table wrappers and cards with hidden overflow never clip it.
 */
export function ActionMenu({
  label,
  items,
  align = MenuAlign.END,
  note,
  className,
  ref,
}: {
  /** Accessible name of the trigger, e.g. "Actions for Maya". */
  label: string;
  items: MenuItem[];
  align?: MenuAlign;
  /** Short muted text under the actions. */
  note?: ReactNode;
  className?: string;
  /** The trigger button, e.g. to hand focus back after a follow-up form. */
  ref?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    placement: MenuPlacement;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Opening with ArrowUp focuses the last item instead of the first. */
  const focusLast = useRef(false);
  const menuId = useId();

  const close = useCallback(
    (event: MenuEvent) => {
      const next = menuTransition(open, event);
      setOpen(next.open);
      if (next.restoreFocus) trigger.current?.focus();
    },
    [open],
  );

  const place = useCallback(() => {
    if (!trigger.current || !popup.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPosition(
      menuPosition(
        rect,
        {
          width: popup.current.offsetWidth,
          height: popup.current.offsetHeight,
        },
        {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        },
        align,
      ),
    );
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
    const disabled = items.map((item) => Boolean(item.disabled));
    const index = nextMenuIndex(
      focusLast.current ? "End" : "Home",
      -1,
      disabled,
    );
    if (index === null) popup.current?.focus();
    else itemRefs.current[index]?.focus({ preventScroll: true });
    // Focus only when the menu opens, not when items change while open.
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popup.current?.contains(target) || trigger.current?.contains(target))
        return;
      close(MenuEvent.OUTSIDE);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);

  const onTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      close(MenuEvent.ESCAPE);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    focusLast.current = event.key === "ArrowUp";
    setOpen(true);
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(MenuEvent.ESCAPE);
      return;
    }
    if (event.key === "Tab") {
      close(MenuEvent.TAB);
      return;
    }
    const current = itemRefs.current.findIndex(
      (node) => node === document.activeElement,
    );
    const next = nextMenuIndex(
      event.key,
      current,
      items.map((item) => Boolean(item.disabled)),
    );
    if (next === null) return;
    event.preventDefault();
    itemRefs.current[next]?.focus();
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close(MenuEvent.SELECT);
    item.onSelect();
  };

  return (
    <>
      <button
        ref={(node) => {
          trigger.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        className={`icon-button action-menu-trigger${className ? ` ${className}` : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-open={open || undefined}
        onClick={() => {
          focusLast.current = false;
          close(MenuEvent.TOGGLE);
        }}
        onKeyDown={onTriggerKey}
      >
        <DotsIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="action-menu"
            data-placement={position?.placement}
            tabIndex={-1}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              // Measured before it shows; opacity (not visibility) so focus can land.
              opacity: position ? undefined : 0,
            }}
            onKeyDown={onMenuKey}
          >
            <div id={menuId} role="menu" aria-label={label}>
              {items.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="action-menu-item"
                  data-tone={item.tone ?? MenuTone.DEFAULT}
                  disabled={item.disabled}
                  aria-disabled={item.disabled || undefined}
                  onClick={() => select(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {note && <p className="action-menu-note">{note}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
