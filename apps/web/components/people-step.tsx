"use client";

import { useEffect, useRef, useState } from "react";
import { InviteeRole } from "../lib/agreement-invitations";
import { toneForId } from "../lib/person";
import { PlusIcon } from "./icons";
import { Avatar, AvatarSize } from "./person";

export interface PersonDraft {
  key: string;
  name: string;
  email: string;
  role: InviteeRole;
}

export interface PersonErrors {
  name?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_LABELS: Record<InviteeRole, string> = {
  [InviteeRole.COLLABORATOR]: "Collaborator",
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Per-row errors, keyed by draft key. Later duplicates are flagged, not the first. */
export function peopleErrors(
  people: PersonDraft[],
  ownerEmail?: string,
): Record<string, PersonErrors> {
  const owner = ownerEmail ? normalizeEmail(ownerEmail) : "";
  const seen = new Set<string>();
  const errors: Record<string, PersonErrors> = {};
  for (const person of people) {
    const rowErrors: PersonErrors = {};
    if (!person.name.trim()) rowErrors.name = "Enter a name.";
    const email = normalizeEmail(person.email);
    if (!email) rowErrors.email = "Enter an email.";
    else if (!EMAIL_PATTERN.test(email))
      rowErrors.email = "Enter a valid email.";
    else if (owner && email === owner)
      rowErrors.email = "That's your email. You're already the owner.";
    else if (seen.has(email)) rowErrors.email = "This email is already added.";
    if (email) seen.add(email);
    if (rowErrors.name || rowErrors.email) errors[person.key] = rowErrors;
  }
  return errors;
}

/** First problem in row order, for the wizard footer. Undefined when the step can continue. */
export function validatePeople(
  people: PersonDraft[],
  ownerEmail?: string,
): string | undefined {
  const errors = peopleErrors(people, ownerEmail);
  for (const [index, person] of people.entries()) {
    const rowErrors = errors[person.key];
    if (!rowErrors) continue;
    const label = person.name.trim() || `Person ${index + 2}`;
    if (rowErrors.name) return `Person ${index + 2}: ${rowErrors.name}`;
    if (rowErrors.email) return `${label}: ${rowErrors.email}`;
  }
  return undefined;
}

let draftCounter = 0;
export function newPersonDraft(): PersonDraft {
  draftCounter += 1;
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `person-${Date.now()}-${draftCounter}`;
  return { key, name: "", email: "", role: InviteeRole.COLLABORATOR };
}

function TrashIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-icon"
    >
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
      className="inline-icon"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

enum PeopleField {
  NAME = "name",
  EMAIL = "email",
}

export function PeopleStep({
  owner,
  people,
  onChange,
  disabled = false,
  showErrors = false,
}: {
  owner: { name: string; email: string };
  people: PersonDraft[];
  onChange(people: PersonDraft[]): void;
  disabled?: boolean;
  /** Set by the wizard after Continue is pressed so untouched rows show their errors too. */
  showErrors?: boolean;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const errors = peopleErrors(people, owner.email);

  useEffect(() => {
    if (!focusKey) return;
    nameInputs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const update = (key: string, patch: Partial<PersonDraft>) =>
    onChange(people.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const touch = (key: string, field: PeopleField) =>
    setTouched((current) => ({ ...current, [`${key}:${field}`]: true }));
  const visibleError = (key: string, field: PeopleField) =>
    showErrors || touched[`${key}:${field}`] ? errors[key]?.[field] : undefined;
  const add = () => {
    const draft = newPersonDraft();
    onChange([...people, draft]);
    setFocusKey(draft.key);
  };
  const remove = (key: string) => {
    onChange(people.filter((p) => p.key !== key));
    nameInputs.current.delete(key);
  };

  return (
    <section className="people-step" aria-labelledby="people-step-title">
      <h2 id="people-step-title">People</h2>
      <p className="people-step-lede">
        Everyone who shares in this agreement&rsquo;s revenue.
      </p>

      <div className="people-table" role="list" aria-label="People">
        <div className="people-head" aria-hidden="true">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span />
        </div>

        <div className="people-row people-row-owner" role="listitem">
          <div className="people-cell">
            <span className="people-field-label">Name</span>
            <span className="people-static">
              <Avatar
                name={owner.name}
                tone={toneForId(owner.email)}
                size={AvatarSize.SMALL}
                label={false}
              />
              <span className="people-static-text">{owner.name}</span>
              <span className="people-you">(you)</span>
            </span>
          </div>
          <div className="people-cell">
            <span className="people-field-label">Email</span>
            <span className="people-static people-static-muted">
              <span className="people-static-text">{owner.email}</span>
            </span>
          </div>
          <div className="people-cell">
            <span className="people-field-label">Role</span>
            <span className="people-static people-static-muted">Owner</span>
          </div>
          <span className="people-remove-slot" />
        </div>

        {people.map((person, index) => {
          const n = index + 2;
          const nameError = visibleError(person.key, PeopleField.NAME);
          const emailError = visibleError(person.key, PeopleField.EMAIL);
          const nameId = `person-${person.key}-name`;
          const emailId = `person-${person.key}-email`;
          const roleId = `person-${person.key}-role`;
          const who = person.name.trim() || "person";
          return (
            <div className="people-row" role="listitem" key={person.key}>
              <div className="people-cell">
                <label className="people-field-label" htmlFor={nameId}>
                  Name
                  <span className="visually-hidden">, person {n}</span>
                </label>
                <input
                  id={nameId}
                  ref={(el) => {
                    if (el) nameInputs.current.set(person.key, el);
                  }}
                  className="people-input"
                  value={person.name}
                  autoComplete="off"
                  placeholder="Full name"
                  disabled={disabled}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? `${nameId}-error` : undefined}
                  onChange={(e) => update(person.key, { name: e.target.value })}
                  onBlur={() => touch(person.key, PeopleField.NAME)}
                />
                {nameError && (
                  <small className="people-error" id={`${nameId}-error`}>
                    {nameError}
                  </small>
                )}
              </div>
              <div className="people-cell">
                <label className="people-field-label" htmlFor={emailId}>
                  Email
                  <span className="visually-hidden">, person {n}</span>
                </label>
                <input
                  id={emailId}
                  className="people-input"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="name@example.com"
                  value={person.email}
                  disabled={disabled}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? `${emailId}-error` : undefined}
                  onChange={(e) =>
                    update(person.key, { email: e.target.value })
                  }
                  onBlur={() => touch(person.key, PeopleField.EMAIL)}
                />
                {emailError && (
                  <small className="people-error" id={`${emailId}-error`}>
                    {emailError}
                  </small>
                )}
              </div>
              <div className="people-cell">
                <label className="people-field-label" htmlFor={roleId}>
                  Role
                  <span className="visually-hidden">, person {n}</span>
                </label>
                <select
                  id={roleId}
                  className="people-input people-select"
                  value={person.role}
                  disabled={disabled}
                  onChange={(e) =>
                    update(person.key, {
                      role: e.target.value as InviteeRole,
                    })
                  }
                >
                  {Object.values(InviteeRole).map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="people-remove"
                aria-label={`Remove ${who}`}
                disabled={disabled}
                onClick={() => remove(person.key)}
              >
                <TrashIcon />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="people-add"
        disabled={disabled}
        onClick={add}
      >
        <PlusIcon />
        Add person
      </button>

      {people.length === 0 && (
        <p className="people-hint">
          Just you for now. That works for a one-person agreement, and you can
          add people later.
        </p>
      )}

      <p className="people-callout">
        <InfoIcon />
        They&rsquo;ll get an invite link once the agreement is created. Nothing
        is sent yet.
      </p>
    </section>
  );
}
