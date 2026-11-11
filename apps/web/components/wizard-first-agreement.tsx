"use client";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./logo-mark";

export enum FirstAgreementChoice {
  UPLOAD = "upload",
  SAMPLE = "sample",
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
      <path
        d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const OPTIONS = [
  {
    value: FirstAgreementChoice.UPLOAD,
    title: "Upload an agreement",
    body: "PDF or Word. We’ll read it and propose the rules.",
    icon: <UploadIcon />,
  },
  {
    value: FirstAgreementChoice.SAMPLE,
    title: "Try a sample first",
    body: "Explore with Maya, Jordan & Riley. No real money.",
    icon: <FlaskIcon />,
  },
];

/** B5: branded first-run choice. Selecting a card starts the wizard. */
export function FirstAgreementChooser({
  onChoose,
  onSkip,
}: {
  onChoose(choice: FirstAgreementChoice): void;
  onSkip(): void;
}) {
  const [choice, setChoice] = useState(FirstAgreementChoice.UPLOAD);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="wiz-onboarding">
      <div className="wiz-onboarding-brand">
        <LogoMark />
        Fairshare
      </div>
      <form
        className="wiz-onboarding-body"
        onSubmit={(event) => {
          event.preventDefault();
          onChoose(choice);
        }}
      >
        <span className="wiz-eyebrow">Step 2 of 2</span>
        <h1 ref={heading} tabIndex={-1}>
          Let’s set up your first agreement
        </h1>
        <fieldset className="wiz-choices">
          <legend className="visually-hidden">How do you want to start?</legend>
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`wiz-choice${choice === option.value ? " selected" : ""}`}
            >
              <span className="wiz-choice-icon" aria-hidden="true">
                {option.icon}
              </span>
              <span className="wiz-choice-text">
                <strong>{option.title}</strong>
                <small>{option.body}</small>
              </span>
              <input
                type="radio"
                name="first-agreement"
                value={option.value}
                checked={choice === option.value}
                onChange={() => setChoice(option.value)}
              />
            </label>
          ))}
        </fieldset>
        <button type="submit" className="button primary wiz-onboarding-go">
          Continue
        </button>
        <button type="button" className="text-button" onClick={onSkip}>
          Skip for now
        </button>
      </form>
    </div>
  );
}
