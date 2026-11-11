"use client";

import { useEffect, useRef, useState } from "react";
import { createInvitation } from "../lib/agreement-invitations";
import { readAgreement, type ExtractionResponse } from "../lib/reading";
import {
  DocumentMode,
  DocumentStep,
  MAX_DOCUMENT_TEXT_LENGTH,
  validateDocumentFile,
} from "./document-step";
import { PeopleStep, validatePeople, type PersonDraft } from "./people-step";
import { ReadingDocument } from "./reading-document";
import {
  WIZARD_STEP_LABELS,
  WizardFrame,
  WizardStep,
  WizardStepper,
} from "./wizard-chrome";
import {
  DetailsStep,
  emptyDetails,
  validateDetails,
  type DetailsDraft,
} from "./wizard-details-step";
import {
  buildIntakeInput,
  isUnreadableDocument,
  type AgreementIntakeInput,
  type CreatedAgreement,
} from "./wizard-intake";
import { InviteLinks, type InviteResult } from "./wizard-invite-links";
import { ReviewStep } from "./wizard-review-step";

/** Where the wizard is after the user leaves the four editable steps. */
export enum CreationPhase {
  EDITING = "editing",
  CREATING = "creating",
  SHARING = "sharing",
  READING = "reading",
}

export const creationSteps = [
  WizardStep.DETAILS,
  WizardStep.DOCUMENT,
  WizardStep.PEOPLE,
  WizardStep.REVIEW,
].map((step) => WIZARD_STEP_LABELS[step]);

const STEP_INTRO: Record<WizardStep, string> = {
  [WizardStep.DETAILS]:
    "Name the agreement and set when it applies. Nothing is saved until you create it.",
  [WizardStep.DOCUMENT]:
    "Upload the signed agreement. Fairshare reads the revenue clauses from it.",
  [WizardStep.PEOPLE]:
    "Everyone who shares in this agreement’s revenue. You’re the owner.",
  [WizardStep.REVIEW]: "Check the details, then create the agreement.",
};

export interface WizardPrefill {
  details?: Partial<DetailsDraft>;
  text?: string;
}

/**
 * Details → Document → People → Review, all held in memory. Review's button is the only
 * thing that writes: intake (agreement + source + details, idempotent per attempt), one
 * invitation per person, then optional reading.
 */
export function AgreementCreationWizard({
  owner,
  prefill,
  onCreate,
  onFinish,
  onClose,
  onBusyChange,
}: {
  owner: { id: string; name: string; email: string };
  prefill?: WizardPrefill;
  onCreate: (input: AgreementIntakeInput) => Promise<CreatedAgreement>;
  onFinish: (
    created: CreatedAgreement,
    extraction: ExtractionResponse | null,
  ) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [step, setStep] = useState(WizardStep.DETAILS);
  const [phase, setPhase] = useState(CreationPhase.EDITING);
  const [details, setDetailsState] = useState<DetailsDraft>(() => ({
    ...emptyDetails(),
    ...prefill?.details,
  }));
  const [detailsTouched, setDetailsTouched] = useState(false);
  const [mode, setModeState] = useState(
    prefill?.text ? DocumentMode.PASTE : DocumentMode.UPLOAD,
  );
  const [file, setFileState] = useState<File | null>(null);
  const [text, setTextState] = useState(prefill?.text ?? "");
  const [documentError, setDocumentError] = useState("");
  const [people, setPeopleState] = useState<PersonDraft[]>([]);
  const [consent, setConsentState] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedAgreement | null>(null);
  const [invites, setInvites] = useState<InviteResult[]>([]);
  const [retrying, setRetrying] = useState(false);
  // One idempotency key per attempt: kept across a retry of the same input, cleared on any edit.
  const requestId = useRef("");
  const locked = useRef(false);
  const extraction = useRef<ExtractionResponse | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase === CreationPhase.EDITING) heading.current?.focus();
  }, [step, phase]);

  function changed() {
    requestId.current = "";
    setError("");
  }
  const setDetails = (next: DetailsDraft) => {
    changed();
    setDetailsTouched(true);
    setDetailsState(next);
  };
  const setFile = (next: File | null) => {
    changed();
    setDocumentError("");
    setFileState(next);
  };
  const setText = (next: string) => {
    changed();
    setDocumentError("");
    setTextState(next);
  };
  const setMode = (next: DocumentMode) => {
    changed();
    setDocumentError("");
    setModeState(next);
  };
  const setPeople = (next: PersonDraft[]) => {
    changed();
    setPeopleState(next);
  };
  const setConsent = (next: boolean) => {
    // Consent isn't sent to intake, so it doesn't change the idempotency key.
    setError("");
    setConsentState(next);
  };

  function stepProblem(target: WizardStep): string | undefined {
    if (target === WizardStep.DETAILS) return validateDetails(details);
    if (target === WizardStep.DOCUMENT) {
      if (documentError) return documentError;
      if (mode === DocumentMode.UPLOAD)
        return file
          ? validateDocumentFile(file)
          : "Choose a document to continue.";
      if (!text.trim()) return "Paste the agreement text to continue.";
      if (text.length > MAX_DOCUMENT_TEXT_LENGTH)
        return "Use up to 40,000 characters of agreement text.";
      return undefined;
    }
    if (target === WizardStep.PEOPLE)
      return validatePeople(people, owner.email);
    return undefined;
  }
  const problem = stepProblem(step);
  const dirty =
    !!details.name.trim() ||
    !!details.effectiveFrom ||
    !!details.effectiveTo ||
    details.noEndDate ||
    !!file ||
    !!text.trim() ||
    people.length > 0;
  const creating = phase === CreationPhase.CREATING;

  function go(next: WizardStep) {
    if (creating) return;
    setError("");
    setStep(next);
  }

  async function createInvites(
    made: CreatedAgreement,
    pending: InviteResult[],
  ): Promise<InviteResult[]> {
    const results: InviteResult[] = [];
    for (const invite of pending) {
      if (invite.token) {
        results.push(invite);
        continue;
      }
      const person = people.find((item) => item.key === invite.key);
      try {
        const result = await createInvitation(
          made.workspaceId,
          made.agreementId,
          {
            name: invite.name,
            email: invite.email,
            role: person!.role,
          },
        );
        results.push({
          ...invite,
          token: result.invitation.token,
          error: undefined,
        });
      } catch (cause) {
        results.push({
          ...invite,
          error:
            cause instanceof Error
              ? cause.message
              : "Couldn’t create this link.",
        });
      }
    }
    return results;
  }

  function afterInvites(made: CreatedAgreement, results: InviteResult[]) {
    if (results.length) setPhase(CreationPhase.SHARING);
    else if (consent) setPhase(CreationPhase.READING);
    else onFinish(made, null);
  }

  async function create() {
    if (locked.current || created) return;
    locked.current = true;
    setPhase(CreationPhase.CREATING);
    onBusyChange(true);
    setError("");
    let made: CreatedAgreement;
    try {
      requestId.current ||= crypto.randomUUID();
      const input = await buildIntakeInput({
        requestId: requestId.current,
        mode,
        file,
        text,
        details,
      });
      made = await onCreate(input);
      setCreated(made);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "We couldn’t create the agreement. Your inputs are still here; try again.";
      setPhase(CreationPhase.EDITING);
      if (isUnreadableDocument(cause)) {
        requestId.current = "";
        setDocumentError(message);
        setStep(WizardStep.DOCUMENT);
      } else setError(message);
      locked.current = false;
      onBusyChange(false);
      return;
    }
    try {
      const results = await createInvites(
        made,
        people.map((person) => ({
          key: person.key,
          name: person.name.trim(),
          email: person.email.trim(),
        })),
      );
      setInvites(results);
      afterInvites(made, results);
    } finally {
      locked.current = false;
      onBusyChange(false);
    }
  }

  async function retryInvites() {
    if (!created || locked.current) return;
    locked.current = true;
    setRetrying(true);
    onBusyChange(true);
    try {
      setInvites(await createInvites(created, invites));
    } finally {
      locked.current = false;
      setRetrying(false);
      onBusyChange(false);
    }
  }

  function close() {
    if (creating) return;
    if (created) {
      onFinish(created, null);
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "Discard this agreement? Nothing has been created yet, so your inputs will be lost.",
      )
    )
      return;
    onClose();
  }

  if (phase === CreationPhase.READING && created)
    return (
      <ReadingDocument
        key={created.documentId}
        fileName={
          mode === DocumentMode.UPLOAD && file ? file.name : details.name.trim()
        }
        run={async () => {
          const result = await readAgreement({
            workspaceId: created.workspaceId,
            agreementId: created.agreementId,
            documentId: created.documentId,
            consent,
          });
          extraction.current = result.extraction;
          return result.outcome;
        }}
        onDone={() => onFinish(created, extraction.current)}
      />
    );

  if (phase === CreationPhase.SHARING && created)
    return (
      <WizardFrame
        onClose={close}
        closeLabel="Close and open the agreement"
        closeDisabled={retrying}
        footer={
          <>
            <span />
            <button
              type="button"
              className="button primary"
              disabled={retrying}
              onClick={() =>
                consent
                  ? setPhase(CreationPhase.READING)
                  : onFinish(created, null)
              }
            >
              {consent ? "Read document" : "Open agreement"}
            </button>
          </>
        }
      >
        <InviteLinks
          invites={invites}
          retrying={retrying}
          onRetry={retryInvites}
        />
      </WizardFrame>
    );

  const primaryLabel = creating
    ? "Creating…"
    : step !== WizardStep.REVIEW
      ? "Continue"
      : consent
        ? "Create & read document"
        : "Create agreement";

  return (
    <WizardFrame
      onClose={close}
      closeDisabled={creating}
      busy={creating}
      stepper={<WizardStepper step={step} />}
      footer={
        <>
          {step === WizardStep.DETAILS ? (
            <span />
          ) : (
            <button
              type="button"
              className="button secondary"
              disabled={creating}
              onClick={() => go(step - 1)}
            >
              Back
            </button>
          )}
          <button
            type="submit"
            form="wiz-form"
            className="button primary"
            disabled={creating || !!problem}
          >
            {primaryLabel}
          </button>
        </>
      }
    >
      <form
        id="wiz-form"
        className="wiz-step"
        noValidate
        aria-labelledby="wiz-step-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (creating || problem) return;
          if (step === WizardStep.REVIEW) void create();
          else go(step + 1);
        }}
      >
        <h1 id="wiz-step-title" ref={heading} tabIndex={-1}>
          {WIZARD_STEP_LABELS[step]}
        </h1>
        <p className="wiz-lede">{STEP_INTRO[step]}</p>
        {error && (
          <p className="wiz-error wiz-error-banner" role="alert">
            {error}
          </p>
        )}
        {step === WizardStep.DETAILS && (
          <DetailsStep
            details={details}
            showErrors={detailsTouched}
            disabled={creating}
            onChange={setDetails}
          />
        )}
        {step === WizardStep.DOCUMENT && (
          <DocumentStep
            file={file}
            text={text}
            mode={mode}
            error={documentError || undefined}
            disabled={creating}
            onFile={setFile}
            onText={setText}
            onMode={setMode}
          />
        )}
        {step === WizardStep.PEOPLE && (
          <PeopleStep
            owner={{ name: owner.name, email: owner.email }}
            people={people}
            onChange={setPeople}
            disabled={creating}
          />
        )}
        {step === WizardStep.REVIEW && (
          <ReviewStep
            details={details}
            mode={mode}
            file={file}
            text={text}
            owner={owner}
            people={people}
            consent={consent}
            disabled={creating}
            onConsent={setConsent}
            onEdit={go}
          />
        )}
      </form>
    </WizardFrame>
  );
}
