"use client";
import type { ReactNode } from "react";

export enum WizardStep {
  DETAILS = 0,
  DOCUMENT = 1,
  PEOPLE = 2,
  REVIEW = 3,
}

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  [WizardStep.DETAILS]: "Details",
  [WizardStep.DOCUMENT]: "Document",
  [WizardStep.PEOPLE]: "People",
  [WizardStep.REVIEW]: "Review",
};

export const WIZARD_STEPS = [
  WizardStep.DETAILS,
  WizardStep.DOCUMENT,
  WizardStep.PEOPLE,
  WizardStep.REVIEW,
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Filled checks for finished steps, connector lines between steps. Not clickable: Review has Edit links. */
export function WizardStepper({ step }: { step: WizardStep }) {
  return (
    <nav className="wiz-stepper" aria-label="New agreement progress">
      <ol>
        {WIZARD_STEPS.map((item) => {
          const state =
            item < step ? "done" : item === step ? "current" : "upcoming";
          return (
            <li
              key={item}
              className={`wiz-stepper-item ${state}`}
              aria-current={item === step ? "step" : undefined}
            >
              <span className="wiz-stepper-mark" aria-hidden="true">
                {item < step ? <CheckIcon /> : item + 1}
              </span>
              <span className="wiz-stepper-label">
                {WIZARD_STEP_LABELS[item]}
                {item < step && (
                  <span className="visually-hidden"> (done)</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Full-screen frame: × top-left, centred title, scrolling body, sticky footer. */
export function WizardFrame({
  title = "New agreement",
  closeLabel = "Close new agreement",
  onClose,
  closeDisabled = false,
  stepper,
  footer,
  children,
  busy = false,
}: {
  title?: string;
  closeLabel?: string;
  onClose?: () => void;
  closeDisabled?: boolean;
  stepper?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="wiz" aria-busy={busy}>
      <header className="wiz-header">
        {onClose ? (
          <button
            type="button"
            className="wiz-close"
            aria-label={closeLabel}
            disabled={closeDisabled}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        ) : (
          <span />
        )}
        <p className="wiz-title">{title}</p>
        <span />
      </header>
      <div className="wiz-scroll">
        {stepper}
        <main className="wiz-main">{children}</main>
      </div>
      {footer && <footer className="wiz-footer">{footer}</footer>}
    </div>
  );
}
