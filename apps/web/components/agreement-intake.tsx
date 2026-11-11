"use client";
import { useState } from "react";
import { sampleAgreement, type Agreement } from "../lib/model";
import {
  AgreementCreationWizard,
  type WizardPrefill,
  type WizardResume,
} from "./agreement-creation-wizard";
import {
  FirstAgreementChoice,
  FirstAgreementChooser,
} from "./wizard-first-agreement";
import type { AgreementIntakeInput, CreatedAgreement } from "./wizard-intake";

export type { AgreementIntakeInput, CreatedAgreement } from "./wizard-intake";
export type { WizardResume } from "./agreement-creation-wizard";

/** The sample opens the wizard with its text already pasted. */
export const SAMPLE_PREFILL: WizardPrefill = { text: sampleAgreement };

/**
 * Full-screen agreement creation. First-time users choose between their own
 * document and the sample before the wizard opens. A saved draft reopens at Check.
 */
export function AgreementIntake({
  first = false,
  owner,
  resume,
  onCreate,
  onFinish,
  onKeepDraft,
  onClose,
  onSkip,
  onBusyChange,
  onLeaveAttempt,
}: {
  first?: boolean;
  owner: { id: string; name: string; email: string };
  resume?: WizardResume;
  onCreate: (input: AgreementIntakeInput) => Promise<CreatedAgreement>;
  onFinish: (agreement: Agreement) => void;
  onKeepDraft: (agreement: Agreement) => void;
  onClose: () => void;
  onSkip?: () => void;
  onBusyChange: (busy: boolean) => void;
  onLeaveAttempt?: (attempt: () => boolean) => void;
}) {
  const [choice, setChoice] = useState<FirstAgreementChoice | null>(
    first && !resume ? null : FirstAgreementChoice.UPLOAD,
  );
  if (choice === null)
    return (
      <FirstAgreementChooser
        onChoose={setChoice}
        onSkip={() => (onSkip ?? onClose)()}
      />
    );
  return (
    <AgreementCreationWizard
      key={resume ? resume.created.agreementId : choice}
      owner={owner}
      resume={resume}
      prefill={
        choice === FirstAgreementChoice.SAMPLE ? SAMPLE_PREFILL : undefined
      }
      onCreate={onCreate}
      onFinish={onFinish}
      onKeepDraft={onKeepDraft}
      // A first-time user who saved nothing returns to the chooser; everyone else returns to the app.
      onClose={first && !resume ? () => setChoice(null) : onClose}
      onBusyChange={onBusyChange}
      onLeaveAttempt={onLeaveAttempt}
    />
  );
}
