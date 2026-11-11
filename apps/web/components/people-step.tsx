"use client";

import { useState } from "react";
import { toneInRoster } from "../lib/person";
import type { AgreementAnswers, PersonAnswer } from "../lib/rules-answers";
import { Avatar, AvatarSize } from "./person";

export interface PersonErrors {
  name?: string;
  email?: string;
  notInSplit?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (email: string | undefined) =>
  (email ?? "").trim().toLowerCase();

const rosterId = (person: PersonAnswer) => person.userId ?? person.key;

/** Share as a whole-number-ish percent: 5000 → "50%", 3333 → "33.33%". */
export function sharePercent(basisPoints: number) {
  return `${Number((basisPoints / 100).toFixed(2))}%`;
}

const displayName = (person: PersonAnswer) =>
  person.name.trim() || "This person";

/**
 * Per-row errors, keyed by person key. The organizer (isSelf) is never checked: their
 * email comes from the account. Later duplicates are flagged, not the first.
 */
export function peopleEmailErrors(
  answers: AgreementAnswers,
  selfEmail?: string,
): Record<string, PersonErrors> {
  const people = answers.people.value;
  const self = people.find((p) => p.isSelf);
  const owner = normalizeEmail(selfEmail ?? self?.email);
  const seen = new Set<string>();
  const errors: Record<string, PersonErrors> = {};
  for (const person of people) {
    if (person.isSelf) continue;
    const rowErrors: PersonErrors = {};
    if (person.basisPoints <= 0) {
      rowErrors.notInSplit = `Remove ${displayName(person)}. They're not in the split.`;
      errors[person.key] = rowErrors;
      continue;
    }
    if (!person.name.trim()) rowErrors.name = "Enter a name.";
    const email = normalizeEmail(person.email);
    if (!email) rowErrors.email = "Enter an email.";
    else if (!EMAIL_PATTERN.test(email))
      rowErrors.email = "Enter a valid email.";
    else if (owner && email === owner)
      rowErrors.email = "That's your email. Add theirs instead.";
    else if (seen.has(email)) rowErrors.email = "This email is already added.";
    if (email) seen.add(email);
    if (rowErrors.name || rowErrors.email) errors[person.key] = rowErrors;
  }
  return errors;
}

/** First problem in row order, for the wizard footer. Undefined when the step can continue. */
export function validatePeopleEmails(
  answers: AgreementAnswers,
  selfEmail?: string,
): string | undefined {
  const errors = peopleEmailErrors(answers, selfEmail);
  for (const person of answers.people.value) {
    const rowErrors = errors[person.key];
    if (!rowErrors) continue;
    if (rowErrors.notInSplit) return rowErrors.notInSplit;
    if (rowErrors.name)
      return `Enter a name for the person with ${sharePercent(person.basisPoints)}.`;
    if (rowErrors.email) return `${displayName(person)}: ${rowErrors.email}`;
  }
  return undefined;
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

enum PeopleField {
  NAME = "name",
  EMAIL = "email",
}

export function PeopleStep({
  answers,
  onChange,
  showErrors = false,
  disabled = false,
  selfEmail,
}: {
  answers: AgreementAnswers;
  onChange(answers: AgreementAnswers): void;
  /** Set by the wizard after Continue is pressed so untouched rows show their errors too. */
  showErrors?: boolean;
  disabled?: boolean;
  /** The signed-in organizer's account email; falls back to the organizer row's email. */
  selfEmail?: string;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const people = answers.people.value;
  const roster = people.map((p) => ({ userId: rosterId(p) }));
  const errors = peopleEmailErrors(answers, selfEmail);

  const setPeople = (next: PersonAnswer[]) =>
    onChange({ ...answers, people: { ...answers.people, value: next } });
  const update = (key: string, patch: Partial<PersonAnswer>) =>
    setPeople(people.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const remove = (key: string) =>
    setPeople(people.filter((p) => p.key !== key));
  const touch = (key: string, field: PeopleField) =>
    setTouched((current) => ({ ...current, [`${key}:${field}`]: true }));
  const visibleError = (key: string, field: PeopleField) =>
    showErrors || touched[`${key}:${field}`] ? errors[key]?.[field] : undefined;

  return (
    <section className="people-step" aria-labelledby="people-step-title">
      <h2 id="people-step-title">Who should we send this to?</h2>
      <p className="people-step-lede">
        We found these people in your agreement. Add their emails so they can
        approve.
      </p>

      <ul className="people-list" aria-label="People">
        {people.map((person) => {
          const tone = toneInRoster(rosterId(person), roster);
          const nameId = `person-${person.key}-name`;
          const emailId = `person-${person.key}-email`;
          const who = person.name.trim() || "this person";
          const inSplit = person.basisPoints > 0;
          const nameError = person.isSelf
            ? undefined
            : visibleError(person.key, PeopleField.NAME);
          const emailError = visibleError(person.key, PeopleField.EMAIL);
          const ownEmail = selfEmail ?? person.email ?? "";
          return (
            <li
              key={person.key}
              className={[
                "people-row",
                person.isSelf ? "people-row-self" : "",
                inSplit ? "" : "people-row-out",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Avatar
                name={person.name || "?"}
                tone={tone}
                size={AvatarSize.SMALL}
                label={false}
              />

              <div className="people-cell people-cell-name">
                <label className="people-field-label" htmlFor={nameId}>
                  Name
                </label>
                {person.isSelf ? (
                  <span className="people-static" id={nameId}>
                    <span className="people-static-text">{person.name}</span>
                    <span className="people-you">You</span>
                  </span>
                ) : (
                  <>
                    <input
                      id={nameId}
                      className="people-input people-input-name"
                      value={person.name}
                      autoComplete="off"
                      placeholder="Full name"
                      disabled={disabled}
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={
                        nameError ? `${nameId}-error` : undefined
                      }
                      onChange={(e) =>
                        update(person.key, { name: e.target.value })
                      }
                      onBlur={() => touch(person.key, PeopleField.NAME)}
                    />
                    {nameError && (
                      <small className="people-error" id={`${nameId}-error`}>
                        {nameError}
                      </small>
                    )}
                  </>
                )}
              </div>

              <div className="people-cell people-cell-share">
                <span className="people-field-label">Share</span>
                {inSplit ? (
                  <span className="people-share">
                    {sharePercent(person.basisPoints)}
                  </span>
                ) : (
                  <span className="people-share people-share-out">
                    Not in the split
                  </span>
                )}
              </div>

              <div className="people-cell people-cell-email">
                {person.isSelf ? (
                  <>
                    <span className="people-field-label">Email</span>
                    <span className="people-static people-static-muted">
                      <span className="people-static-text">{ownEmail}</span>
                    </span>
                  </>
                ) : inSplit ? (
                  <>
                    <label className="people-field-label" htmlFor={emailId}>
                      Email
                      <span className="visually-hidden">, {who}</span>
                    </label>
                    <input
                      id={emailId}
                      className="people-input"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="name@example.com"
                      value={person.email ?? ""}
                      disabled={disabled}
                      aria-invalid={emailError ? true : undefined}
                      aria-describedby={
                        emailError ? `${emailId}-error` : undefined
                      }
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
                  </>
                ) : (
                  <button
                    type="button"
                    className="people-remove"
                    aria-label={`Remove ${who}`}
                    disabled={disabled}
                    onClick={() => remove(person.key)}
                  >
                    <TrashIcon />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
