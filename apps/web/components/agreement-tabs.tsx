"use client";
import { useRef } from "react";
import { AgreementTab } from "../lib/model";
import { tabDestination } from "../lib/tab-navigation";

/** Manual activation avoids discarding edits just by exploring tabs with arrows. */
export function AgreementTabs({
  value,
  onChange,
}: {
  value: AgreementTab;
  onChange: (value: AgreementTab) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = Object.values(AgreementTab);
  return (
    <div className="tabs" role="tablist" aria-label="Agreement sections">
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
    </div>
  );
}
