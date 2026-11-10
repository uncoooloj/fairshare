"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./ui";
import {
  initialTermsStep,
  nextTermsStep,
  type TermsStep,
} from "../lib/terms-flow";

const labels = ["Source agreement", "Read the agreement", "Proposed rules"];

/** Keep panels mounted: moving back to read a clause must not erase a rules draft. */
export function AgreementTermsFlow({
  documentId,
  busy,
  sourceText,
  source,
  interpretation,
  rules,
}: {
  documentId: string;
  busy: boolean;
  sourceText: string;
  source: ReactNode;
  interpretation: ReactNode;
  rules: ReactNode;
}) {
  const [step, setStep] = useState<TermsStep>(() =>
    initialTermsStep(documentId),
  );
  const [read, setRead] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousDocument = useRef(documentId);
  const shouldFocus = useRef(false);
  function go(next: TermsStep) {
    if (busy) return;
    shouldFocus.current = true;
    setStep(next);
  }
  useEffect(() => {
    if (previousDocument.current === documentId) return;
    previousDocument.current = documentId;
    setRead(false);
    // Only committed documents advance. Failed saves leave the source visible.
    shouldFocus.current = !!documentId;
    setStep(initialTermsStep(documentId));
  }, [documentId]);
  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [step]);
  return (
    <section className="terms-flow" aria-label="Prepare agreement terms">
      <ol
        className="terms-flow-progress"
        aria-label="Terms preparation progress"
      >
        {labels.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <button
              type="button"
              disabled={
                busy || (index > 0 && !documentId) || (index === 2 && !read)
              }
              onClick={() => go(index as TermsStep)}
            >
              <span aria-hidden="true">{index + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>
      <h3 ref={heading} tabIndex={-1} className="terms-flow-heading">
        Step {step + 1} of 3: {labels[step]}
      </h3>
      <div hidden={step !== 0}>
        {source}
        {documentId && (
          <Button disabled={busy} onClick={() => go(1)}>
            Continue to read agreement
          </Button>
        )}
      </div>
      <div hidden={step !== 1}>
        <details className="panel">
          <summary>Read saved source text</summary>
          <pre className="terms-source-text">{sourceText}</pre>
        </details>
        {interpretation}
        <p className="muted">
          Review the source and any suggestions above. You can also enter rules
          manually without AI. Continuing does not approve or activate anything.
        </p>
        <div className="actions">
          <Button variant="secondary" disabled={busy} onClick={() => go(0)}>
            Edit source
          </Button>
          <Button
            disabled={busy || !documentId}
            onClick={() => {
              setRead(true);
              go(nextTermsStep(1, !!documentId));
            }}
          >
            Continue to proposed rules
          </Button>
        </div>
      </div>
      <div hidden={step !== 2}>
        <Button variant="secondary" disabled={busy} onClick={() => go(1)}>
          Back to agreement reading
        </Button>
        {rules}
      </div>
    </section>
  );
}
