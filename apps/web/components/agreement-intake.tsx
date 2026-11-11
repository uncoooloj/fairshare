"use client";
import { useState } from "react";
import { sampleAgreement } from "../lib/model";
import type { ExtractionResponse } from "../lib/reading";
import {
  AgreementCreationWizard,
  type WizardPrefill,
} from "./agreement-creation-wizard";
import {
  FirstAgreementChoice,
  FirstAgreementChooser,
} from "./wizard-first-agreement";
import type { AgreementIntakeInput, CreatedAgreement } from "./wizard-intake";

export type { AgreementIntakeInput, CreatedAgreement } from "./wizard-intake";

export const SAMPLE_PREFILL: WizardPrefill = {
  details: { name: "Sample agreement" },
  text: sampleAgreement,
};

/**
 * Full-screen agreement creation. First-time users choose between their own
 * document and the sample before the wizard opens. The server saves the
 * workspace, agreement and source together, or none at all.
 */
export function AgreementIntake({
  first = false,
  owner,
  onCreate,
  onFinish,
  onClose,
  onSkip,
  onBusyChange,
}: {
  first?: boolean;
  owner: { id: string; name: string; email: string };
  onCreate: (input: AgreementIntakeInput) => Promise<CreatedAgreement>;
  onFinish: (
    created: CreatedAgreement,
    extraction: ExtractionResponse | null,
  ) => void;
  onClose: () => void;
  onSkip?: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [choice, setChoice] = useState<FirstAgreementChoice | null>(
    first ? null : FirstAgreementChoice.UPLOAD,
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
      key={choice}
      owner={owner}
      prefill={
        choice === FirstAgreementChoice.SAMPLE ? SAMPLE_PREFILL : undefined
      }
      onCreate={onCreate}
      onFinish={onFinish}
      // A first-time user returns to the chooser; everyone else returns to the app.
      onClose={first ? () => setChoice(null) : onClose}
      onBusyChange={onBusyChange}
    />
  );
}
