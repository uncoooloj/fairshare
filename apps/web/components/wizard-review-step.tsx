"use client";
import type { ReactNode } from "react";
import { toneForId } from "../lib/person";
import { Avatar, AvatarSize } from "./person";
import type { PersonDraft } from "./people-step";
import { DocumentMode } from "./document-step";
import { WizardStep } from "./wizard-chrome";
import { formatDateRange, type DetailsDraft } from "./wizard-details-step";

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileIcon() {
  return (
    <svg
      className="wiz-file-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M9 13h6M9 17h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Contract.pdf · 2.4 MB" or "Pasted text · 1,204 characters". */
export function documentSummary(
  mode: DocumentMode,
  file: File | null,
  text: string,
) {
  if (mode === DocumentMode.UPLOAD && file)
    return `${file.name} · ${formatFileSize(file.size)}`;
  return `Pasted text · ${text.length.toLocaleString("en-US")} characters`;
}

function Row({
  label,
  children,
  step,
  onEdit,
  disabled,
}: {
  label: string;
  children: ReactNode;
  step: WizardStep;
  onEdit(step: WizardStep): void;
  disabled: boolean;
}) {
  return (
    <div className="wiz-review-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
      <button
        type="button"
        className="text-button wiz-edit"
        disabled={disabled}
        onClick={() => onEdit(step)}
      >
        Edit<span className="visually-hidden"> {label.toLowerCase()}</span>
      </button>
    </div>
  );
}

export function ReviewStep({
  details,
  mode,
  file,
  text,
  owner,
  people,
  consent,
  disabled = false,
  onConsent,
  onEdit,
}: {
  details: DetailsDraft;
  mode: DocumentMode;
  file: File | null;
  text: string;
  owner: { id: string; name: string };
  people: PersonDraft[];
  consent: boolean;
  disabled?: boolean;
  onConsent(consent: boolean): void;
  onEdit(step: WizardStep): void;
}) {
  return (
    <>
      <dl className="wiz-review">
        <Row
          label="Name"
          step={WizardStep.DETAILS}
          onEdit={onEdit}
          disabled={disabled}
        >
          {details.name.trim()}
        </Row>
        <div className="wiz-review-row">
          <dt>Currency</dt>
          <dd>USD · US dollar</dd>
        </div>
        <Row
          label="Dates"
          step={WizardStep.DETAILS}
          onEdit={onEdit}
          disabled={disabled}
        >
          {formatDateRange(details)}
        </Row>
        <Row
          label="Document"
          step={WizardStep.DOCUMENT}
          onEdit={onEdit}
          disabled={disabled}
        >
          <span className="wiz-review-doc">
            <FileIcon />
            {documentSummary(mode, file, text)}
          </span>
        </Row>
        <Row
          label="People"
          step={WizardStep.PEOPLE}
          onEdit={onEdit}
          disabled={disabled}
        >
          <ul className="wiz-review-people">
            <li>
              <Avatar
                name={owner.name}
                tone={toneForId(owner.id)}
                size={AvatarSize.SMALL}
                label={false}
              />
              <span>{owner.name}</span>
              <small>Owner</small>
            </li>
            {people.map((person) => (
              <li key={person.key}>
                <Avatar
                  name={person.name}
                  tone={toneForId(person.email.trim().toLowerCase())}
                  size={AvatarSize.SMALL}
                  label={false}
                />
                <span>{person.name.trim()}</span>
                <small>Collaborator</small>
              </li>
            ))}
          </ul>
        </Row>
      </dl>
      <label className="wiz-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={disabled}
          onChange={(event) => onConsent(event.target.checked)}
        />
        <span>
          <strong>Let Fairshare read this agreement to suggest rules</strong>
          <small>
            We send the document to Cloudflare AI. Suggestions stay drafts until
            everyone approves. Leave unticked to add rules yourself.
          </small>
        </span>
      </label>
      <p className="wiz-hint">
        Sandbox only: creating this draft moves no money.
      </p>
    </>
  );
}
