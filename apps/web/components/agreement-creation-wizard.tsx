"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Agreement } from "../lib/model";
import { Button, Field, Notice } from "./ui";

export const creationSteps = [
  "Document",
  "Details",
  "People",
  "Review",
] as const;

/** One navigation model for the entire upload-first creation journey. */
export function CreationStepper({
  step,
  onStep,
  disabled = false,
}: {
  step: number;
  onStep?: (step: number) => void;
  disabled?: boolean;
}) {
  return (
    <nav aria-label="New agreement progress" className="creation-progress">
      <ol>
        {creationSteps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined}>
            <button
              type="button"
              disabled={disabled || !onStep || index > step}
              onClick={() => onStep?.(index)}
            >
              <span className="creation-number" aria-hidden="true">
                {index < step ? "✓" : index + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AgreementCreationWizard({
  agreement,
  source,
  members,
  userId,
  invitation,
  onSaveName,
  onAddMember,
  onRefresh,
  onComplete,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  agreement: Agreement;
  source: string;
  members: { id: string; name: string; email: string }[];
  userId: string;
  invitation?: ReactNode;
  onSaveName: (name: string) => Promise<void>;
  onAddMember: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onComplete: () => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(agreement.value.name);
  const [pending, setPending] = useState(false);
  const pendingRequest = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onDirtyChange(name.trim() !== agreement.value.name);
    return () => onDirtyChange(false);
  }, [name, agreement.value.name, onDirtyChange]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  async function perform(action: () => Promise<void>) {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    setPending(true);
    onBusyChange(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Your changes are still here. Please retry.",
      );
    } finally {
      pendingRequest.current = false;
      setPending(false);
      onBusyChange(false);
    }
  }
  function go(next: number) {
    if (!pending) {
      setError("");
      setStep(next);
    }
  }
  async function continueStep() {
    if (step === 1) {
      await perform(async () => {
        if (!name.trim())
          throw new Error("Give this agreement a name before continuing.");
        if (name.trim() !== agreement.value.name) await onSaveName(name.trim());
        setStep(2);
      });
    } else go(step + 1);
  }
  const available = members.filter(
    (member) =>
      !agreement.value.members.some((person) => person.userId === member.id),
  );
  return (
    <section
      className="creation-wizard"
      aria-label="Create agreement"
      aria-busy={pending}
    >
      <header className="creation-header">
        <h1>New agreement</h1>
        <Button
          variant="quiet"
          disabled={pending}
          onClick={() =>
            perform(async () => {
              if (!name.trim())
                throw new Error("Give this agreement a name before saving.");
              if (name.trim() !== agreement.value.name)
                await onSaveName(name.trim());
              onClose();
            })
          }
        >
          Save and close
        </Button>
      </header>
      <CreationStepper step={step} onStep={go} disabled={pending} />
      <div className="creation-body">
        <h2 ref={heading} tabIndex={-1}>
          {creationSteps[step]}
        </h2>
        {error && <Notice warning>{error}</Notice>}
        {step === 0 && (
          <>
            <p className="muted">
              Your document has been saved. Check the extracted text before
              continuing.
            </p>
            <div className="creation-document">
              <strong>Source agreement</strong>
              <span>
                Saved privately · {source.length.toLocaleString()} characters
              </span>
            </div>
            <details>
              <summary>Read extracted document</summary>
              <pre className="creation-source">{source}</pre>
            </details>
            <p className="muted">
              Need a different document? Save and close, then replace the source
              in Terms before proposing any rules.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <p className="muted">
              We named this from your document. Make it easy for everyone to
              recognise.
            </p>
            <Field label="Agreement name">
              <input
                value={name}
                maxLength={200}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Payment currency"
              hint="USD is currently supported. Currency and money rules are confirmed when you review the extracted terms."
            >
              <input value="USD – US dollar" readOnly />
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <p className="muted">
              Everyone who shares in this agreement’s revenue. Add everyone
              before proposing rules.
            </p>
            <div className="creation-people">
              {agreement.value.members.map((person) => (
                <div key={person.userId} className="creation-person">
                  <span className="avatar small" aria-hidden="true">
                    {person.displayName[0]}
                  </span>
                  <strong>
                    {person.displayName}
                    {person.userId === userId ? " (you)" : ""}
                  </strong>
                  <span>
                    {person.role === "ORGANIZER" ? "Owner" : "Collaborator"}
                  </span>
                </div>
              ))}
            </div>
            {available.length > 0 && (
              <section className="creation-section">
                <h3>Add someone you already work with</h3>
                {available.map((person) => (
                  <div className="creation-person" key={person.id}>
                    <span>
                      {person.name}
                      <small className="creation-email">{person.email}</small>
                    </span>
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => perform(() => onAddMember(person.id))}
                    >
                      Add person
                    </Button>
                  </div>
                ))}
              </section>
            )}
            <details className="creation-section">
              <summary>Invite someone new</summary>
              <p className="muted">
                Share a private invitation to this agreement. Once they accept,
                refresh to see them here.
              </p>
              {invitation || <p>Ask the organizer for an invitation link.</p>}
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => perform(onRefresh)}
              >
                Refresh accepted invitations
              </Button>
            </details>
            <p className="muted">
              Nothing is sent for approval yet. You can review on your own, but
              finish the participant list before saving a proposal.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <p className="muted">
              Check the details, then review the document’s revenue rules.
            </p>
            <dl className="creation-review">
              <div>
                <dt>Name</dt>
                <dd>
                  {agreement.value.name}
                  <Button variant="quiet" onClick={() => go(1)}>
                    Edit
                  </Button>
                </dd>
              </div>
              <div>
                <dt>Currency</dt>
                <dd>USD – US dollar</dd>
              </div>
              <div>
                <dt>Document</dt>
                <dd>
                  Source saved · {source.length.toLocaleString()} characters
                  <Button variant="quiet" onClick={() => go(0)}>
                    Review
                  </Button>
                </dd>
              </div>
              <div>
                <dt>People</dt>
                <dd>
                  {agreement.value.members.map((person) => (
                    <span key={person.userId}>
                      {person.displayName}
                      {person.userId === userId ? " (you)" : ""}
                    </span>
                  ))}
                  <Button variant="quiet" onClick={() => go(2)}>
                    Edit
                  </Button>
                </dd>
              </div>
            </dl>
            <p className="muted">
              Next, choose whether AI may interpret your source. Check every
              proposed rule and resolve questions before anyone approves.
              Creating this draft does not move money.
            </p>
          </>
        )}
        <footer className="creation-footer">
          <Button
            variant="secondary"
            disabled={pending || step === 0}
            onClick={() => go(step - 1)}
          >
            Back
          </Button>
          <Button
            disabled={pending || (step === 1 && !name.trim())}
            onClick={step === 3 ? onComplete : continueStep}
          >
            {pending
              ? "Saving…"
              : step === 3
                ? "Continue to read document"
                : "Continue"}
          </Button>
        </footer>
      </div>
    </section>
  );
}
