"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { AgreementTab } from "../lib/model";
import { tabDestination } from "../lib/tab-navigation";

/** Reference order: money first, then the rules and the people behind them. */
const TAB_ORDER = [
  AgreementTab.Overview,
  AgreementTab.Payments,
  AgreementTab.Allocations,
  AgreementTab.Terms,
  AgreementTab.People,
  AgreementTab.Document,
];

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
  const [indicator, setIndicator] = useState<{ left: number; width: number }>();
  useLayoutEffect(() => {
    const measure = () => {
      const active = buttons.current[tabs.indexOf(value)];
      if (active)
        setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, tabs]);
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
          aria-selected={value === tab}
          aria-controls={value === tab ? "agreement-panel" : undefined}
          tabIndex={value === tab ? 0 : -1}
          className={value === tab ? "active" : ""}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const next = tabDestination(event.key, index, tabs.length);
            if (next === null) return;
            event.preventDefault();
            buttons.current[next]?.focus();
          }}
        >
          {tab}
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
