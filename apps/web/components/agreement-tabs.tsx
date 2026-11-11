"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { AgreementTab } from "../lib/model";
import { tabDestination } from "../lib/tab-navigation";

/** Four tabs: money first, then the people and the agreement itself.
 * Splits (Allocations) live inside Payments; the document lives inside Agreement. */
const TAB_ORDER = [
  AgreementTab.Overview,
  AgreementTab.Payments,
  AgreementTab.People,
  AgreementTab.Terms,
];

const TAB_LABEL: Record<AgreementTab, string> = {
  [AgreementTab.Overview]: "Overview",
  [AgreementTab.Payments]: "Payments",
  [AgreementTab.Allocations]: "Payments",
  [AgreementTab.People]: "People",
  [AgreementTab.Terms]: "Agreement",
  [AgreementTab.Document]: "Agreement",
};

/** Folded tabs open inside the tab that now holds them. */
export function visibleTab(tab: AgreementTab): AgreementTab {
  if (tab === AgreementTab.Allocations) return AgreementTab.Payments;
  if (tab === AgreementTab.Document) return AgreementTab.Terms;
  return tab;
}

/** Manual activation avoids discarding edits just by exploring tabs with arrows. */
export function AgreementTabs({
  value,
  onChange,
}: {
  value: AgreementTab;
  onChange: (value: AgreementTab) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = TAB_ORDER;
  const current = visibleTab(value);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>();
  useLayoutEffect(() => {
    const measure = () => {
      const active = buttons.current[tabs.indexOf(current)];
      if (active)
        setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current, tabs]);
  return (
    <div
      className={`tabs agreement-tabs ${indicator ? "has-indicator" : ""}`}
      role="tablist"
      aria-label="Agreement sections"
    >
      {tabs.map((tab, index) => (
        <button
          type="button"
          ref={(element) => {
            buttons.current[index] = element;
          }}
          key={tab}
          id={`agreement-tab-${tab}`}
          role="tab"
          aria-selected={current === tab}
          aria-controls={current === tab ? "agreement-panel" : undefined}
          tabIndex={current === tab ? 0 : -1}
          className={current === tab ? "active" : ""}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const next = tabDestination(event.key, index, tabs.length);
            if (next === null) return;
            event.preventDefault();
            buttons.current[next]?.focus();
          }}
        >
          {TAB_LABEL[tab]}
        </button>
      ))}
      {indicator && (
        <span
          className="tab-indicator"
          aria-hidden="true"
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
          }}
        />
      )}
    </div>
  );
}
