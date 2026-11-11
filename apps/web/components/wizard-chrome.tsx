"use client";
import type { ReactNode } from "react";

/** The four progress dots. Reading counts as Upload; Questions count as Check. */
export enum WizardStep {
  UPLOAD = 0,
  CHECK = 1,
  PEOPLE = 2,
  SEND = 3,
}

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  [WizardStep.UPLOAD]: "Upload",
  [WizardStep.CHECK]: "Check",
  [WizardStep.PEOPLE]: "People",
  [WizardStep.SEND]: "Send",
};

export const WIZARD_STEPS = [
  WizardStep.UPLOAD,
  WizardStep.CHECK,
  WizardStep.PEOPLE,
  WizardStep.SEND,
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

/**
 * Filled checks for finished steps, connector lines between steps. Not clickable. `detail`
 * is a small line under the current step, e.g. "Question 1 of 2" while Check has questions.
 */
export function WizardStepper({
  step,
  detail,
}: {
  step: WizardStep;
  detail?: string;
}) {
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
                {item === step && detail && (
                  <small className="wiz-stepper-detail">
                    <span className="visually-hidden">, </span>
                    {detail}
                  </small>
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
