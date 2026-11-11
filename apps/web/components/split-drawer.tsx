"use client";
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { rebalance, totalBasisPoints } from "../lib/rules-answers";
import type { PersonAnswer } from "../lib/rules-answers";
import { toneInRoster } from "../lib/person";
import { Avatar, SplitBar } from "./person";
import { WizardDrawer } from "./wizard-drawer";

const FULL = 10000;

/** "30", "33.33": percent text for a basis-point share. */
export function percentText(basisPoints: number) {
  return String(Math.round(basisPoints) / 100);
}

/** Parses a typed percent ("30", "12.5", "12.5%") into basis points, or undefined. */
export function parsePercent(text: string) {
  const trimmed = text.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(trimmed)) return undefined;
  const basisPoints = Math.round(Number(trimmed) * 100);
  return basisPoints <= FULL ? basisPoints : undefined;
}

/** Everyone the same, with the odd basis points going to the first rows so it still totals 100%. */
export function equalSplit(people: PersonAnswer[]): PersonAnswer[] {
  if (!people.length) return people;
  const each = Math.floor(FULL / people.length);
  const extra = FULL - each * people.length;
  return people.map((person, index) => ({
    ...person,
    basisPoints: each + (index < extra ? 1 : 0),
  }));
}

/**
 * `rebalance`, then keep everyone on whole percents when the changed share is a whole
 * percent, so a slider never leaves the others at 36.44%. Typed decimals stay exact.
 */
export function moveShare(
  people: PersonAnswer[],
  key: string,
  basisPoints: number,
): PersonAnswer[] {
  const next = rebalance(people, key, basisPoints);
  const fixed = next.find((person) => person.key === key);
  if (!fixed || fixed.basisPoints % 100 !== 0) return next;
  const others = next.filter((person) => person.key !== key);
  const units = (FULL - fixed.basisPoints) / 100;
  const weight = others.reduce((sum, person) => sum + person.basisPoints, 0);
  const rows = others.map((person, index) => {
    const exact = weight
      ? (units * person.basisPoints) / weight
      : units / others.length;
    return {
      key: person.key,
      index,
      whole: Math.floor(exact),
      rest: exact % 1,
    };
  });
  let left = units - rows.reduce((sum, row) => sum + row.whole, 0);
  for (const row of [...rows].sort(
    (a, b) => b.rest - a.rest || a.index - b.index,
  )) {
    if (left <= 0) break;
    row.whole += 1;
    left -= 1;
  }
  const shares = new Map(rows.map((row) => [row.key, row.whole * 100]));
  return next.map((person) =>
    person.key === key
      ? person
      : { ...person, basisPoints: shares.get(person.key)! },
  );
}

/** Adds someone with an equal share (whole percent), taken from everyone else in proportion. */
export function addPerson(people: PersonAnswer[], person: PersonAnswer) {
  const next = [...people, { ...person, basisPoints: 0 }];
  return moveShare(
    next,
    person.key,
    Math.round(FULL / next.length / 100) * 100,
  );
}

/** Removes someone; their share goes back to everyone else in proportion. */
export function removePerson(people: PersonAnswer[], key: string) {
  if (people.length <= 1) return people;
  return moveShare(people, key, 0).filter((person) => person.key !== key);
}

export function rosterTone(person: PersonAnswer, people: PersonAnswer[]) {
  return toneInRoster(
    person.userId ?? person.key,
    people.map((p) => ({ userId: p.userId ?? p.key })),
  );
}

let created = 0;
function newKey() {
  created += 1;
  return `new-${Date.now().toString(36)}-${created}`;
}

/** Linked sliders for who gets what: moving one share rebalances the rest so it always totals 100%. */
export function SplitDrawer({
  people: initial,
  lockedKeys = [],
  canAdd = true,
  onSave,
  onCancel,
}: {
  people: PersonAnswer[];
  /** People who can't be removed here, such as you or whoever is paid back first. */
  lockedKeys?: string[];
  /** False once the agreement was sent: the people are fixed, only shares change. */
  canAdd?: boolean;
  onSave(people: PersonAnswer[]): void;
  onCancel(): void;
}) {
  const [people, setPeople] = useState(initial);
  const [editing, setEditing] = useState<{ key: string; text: string }>();
  const [adding, setAdding] = useState<string>();
  const [addError, setAddError] = useState<string>();
  const addId = useId();
  const total = totalBasisPoints(people);
  const single = people.length === 1;
  const nameless = people.some((person) => !person.name.trim());

  function move(key: string, basisPoints: number) {
    setPeople((current) =>
      moveShare(current, key, Math.max(0, Math.min(FULL, basisPoints))),
    );
  }

  function type(key: string, text: string) {
    setEditing({ key, text });
    const basisPoints = parsePercent(text);
    if (basisPoints !== undefined) move(key, basisPoints);
  }

  function confirmAdd() {
    const name = adding?.trim() ?? "";
    if (!name) {
      setAddError("Enter a name.");
      return;
    }
    if (
      people.some(
        (person) => person.name.trim().toLowerCase() === name.toLowerCase(),
      )
    ) {
      setAddError(`${name} is already in the split.`);
      return;
    }
    setPeople((current) =>
      addPerson(current, {
        key: newKey(),
        name,
        basisPoints: 0,
        isSelf: false,
      }),
    );
    setAdding(undefined);
    setAddError(undefined);
  }

  function addKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmAdd();
    }
    if (event.key === "Escape" && adding !== undefined) {
      // Close the add row, not the whole drawer.
      event.preventDefault();
      event.stopPropagation();
      setAdding(undefined);
      setAddError(undefined);
    }
  }

  return (
    <WizardDrawer
      title="Who gets what"
      lede="Move a slider or type a number. The others adjust so it always adds up to 100%."
      saveDisabled={total !== FULL || nameless || adding !== undefined}
      onSave={() => onSave(people)}
      onCancel={onCancel}
    >
      <SplitBar
        segments={people.map((person) => ({
          userId: person.key,
          name: person.name,
          basisPoints: person.basisPoints,
          tone: rosterTone(person, people),
        }))}
      />
      <ul className="sd-rows">
        {people.map((person) => {
          const label = person.isSelf ? `${person.name} (you)` : person.name;
          const percent = percentText(person.basisPoints);
          const shown = editing?.key === person.key ? editing.text : percent;
          const locked = person.isSelf || lockedKeys.includes(person.key);
          return (
            <li key={person.key} className="sd-row">
              <div className="sd-who">
                <Avatar name={person.name} tone={rosterTone(person, people)} />
                <span className="sd-name">
                  {person.name}
                  {person.isSelf ? <span className="sd-you">You</span> : null}
                </span>
                <label className="sd-number">
                  <span className="sr-only">{`${label}'s share in percent`}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={shown}
                    disabled={single}
                    onFocus={() =>
                      setEditing({ key: person.key, text: percent })
                    }
                    onBlur={() => setEditing(undefined)}
                    onChange={(event) => type(person.key, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        // Commit the number; Save is a separate, deliberate press.
                        event.preventDefault();
                        setEditing(undefined);
                      }
                    }}
                  />
                  <span aria-hidden="true">%</span>
                </label>
                {locked || single ? (
                  <span className="sd-remove-space" aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    className="sd-remove"
                    aria-label={`Remove ${person.name}`}
                    onClick={() => {
                      setPeople((current) => removePerson(current, person.key));
                      setEditing(undefined);
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path
                        d="M3.5 3.5l9 9m0-9l-9 9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
              <input
                type="range"
                className={`sd-slider tone-${rosterTone(person, people)}`}
                min={0}
                max={FULL}
                step={100}
                value={person.basisPoints}
                disabled={single}
                aria-label={`${label}'s share`}
                aria-valuetext={`${person.name} ${percent} percent`}
                style={{ ["--fill" as string]: `${person.basisPoints / 100}%` }}
                onChange={(event) => {
                  setEditing(undefined);
                  move(person.key, Number(event.target.value));
                }}
              />
            </li>
          );
        })}
      </ul>
      <div className="sd-total" aria-live="polite">
        <span>Total</span>
        <strong className={total === FULL ? "good" : "bad"}>
          {percentText(total)}%
        </strong>
      </div>
      {adding === undefined ? (
        <div className="sd-actions">
          {canAdd ? (
            <button
              type="button"
              className="wc-link"
              onClick={() => setAdding("")}
            >
              + Add a person
            </button>
          ) : null}
          {people.length > 1 ? (
            <button
              type="button"
              className="wc-link"
              onClick={() => {
                setPeople((current) => equalSplit(current));
                setEditing(undefined);
              }}
            >
              Split equally
            </button>
          ) : null}
        </div>
      ) : (
        <div className="sd-add">
          <label htmlFor={addId}>Name</label>
          <div className="sd-add-row">
            <input
              id={addId}
              type="text"
              autoFocus
              autoComplete="off"
              value={adding}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? `${addId}-error` : undefined}
              onChange={(event) => {
                setAdding(event.target.value);
                setAddError(undefined);
              }}
              onKeyDown={addKey}
            />
            <button
              type="button"
              className="button secondary"
              onClick={confirmAdd}
            >
              Add
            </button>
            <button
              type="button"
              className="wc-link"
              onClick={() => {
                setAdding(undefined);
                setAddError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
          {addError ? (
            <p id={`${addId}-error`} className="wiz-error" role="alert">
              {addError}
            </p>
          ) : (
            <p className="wiz-hint">You'll add their email on the next step.</p>
          )}
        </div>
      )}
    </WizardDrawer>
  );
}
