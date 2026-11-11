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
 * Sets one share exactly; only people not in `heldKeys` move to make up the difference.
 * When the new share is a whole percent, those who move stay on whole percents too, so a
 * slider never leaves the others at 36.44%. Typed decimals stay exact.
 */
export function moveShare(
  people: PersonAnswer[],
  key: string,
  basisPoints: number,
  heldKeys: readonly string[] = [],
): PersonAnswer[] {
  return rebalance(
    people,
    key,
    basisPoints,
    heldKeys.filter((held) => held !== key),
    basisPoints % 100 === 0 ? 100 : 1,
  );
}

/** Adds someone with an equal share (whole percent), taken in proportion from whoever isn't held.
 * If everyone is held, nothing moves and they start at whatever is left over (often 0%). */
export function addPerson(
  people: PersonAnswer[],
  person: PersonAnswer,
  heldKeys: readonly string[] = [],
) {
  const next = [...people, { ...person, basisPoints: 0 }];
  if (people.every((p) => heldKeys.includes(p.key)))
    return moveShare(
      next,
      person.key,
      Math.max(0, FULL - totalBasisPoints(people)),
      heldKeys,
    );
  return moveShare(
    next,
    person.key,
    Math.round(FULL / next.length / 100) * 100,
    heldKeys,
  );
}

/** Removes someone; their share goes back to whoever isn't held, in proportion. */
export function removePerson(
  people: PersonAnswer[],
  key: string,
  heldKeys: readonly string[] = [],
) {
  if (people.length <= 1) return people;
  return moveShare(people, key, 0, heldKeys).filter(
    (person) => person.key !== key,
  );
}

/** The drawer's working rows, plus who has been set by hand since it opened. */
export interface SplitState {
  people: PersonAnswer[];
  /** Keys of people whose share was typed or slid; rebalancing never moves them. */
  set: string[];
}

/** A typed share: it sticks exactly, and only people not set yet move. */
export function typeShare(
  state: SplitState,
  key: string,
  basisPoints: number,
): SplitState {
  return {
    people: moveShare(
      state.people,
      key,
      Math.max(0, Math.min(FULL, basisPoints)),
      state.set,
    ),
    set: state.set.includes(key) ? state.set : [...state.set, key],
  };
}

/** A slider move: snapped to a whole percent, then like a typed share. */
export function slideShare(
  state: SplitState,
  key: string,
  basisPoints: number,
): SplitState {
  return typeShare(state, key, Math.round(basisPoints / 100) * 100);
}

/** "Even split": everyone the same and nobody counted as set. */
export function evenSplit(state: SplitState): SplitState {
  return { people: equalSplit(state.people), set: [] };
}

/** Plain-English nudge when the split is off, or undefined when it is 100%. */
export function totalProblem(people: PersonAnswer[]) {
  const total = totalBasisPoints(people);
  return total === FULL
    ? undefined
    : `Adds up to ${percentText(total)}%. Make it 100% to continue.`;
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

/**
 * Linked sliders for who gets what. A typed or slid share sticks; only people not set yet
 * this time move to keep it at 100%. Once everyone is set nothing moves, and Save waits
 * until the numbers add up.
 */
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
  const [split, setSplit] = useState<SplitState>({ people: initial, set: [] });
  const { people } = split;
  const [editing, setEditing] = useState<{ key: string; text: string }>();
  const [adding, setAdding] = useState<string>();
  const [addError, setAddError] = useState<string>();
  const addId = useId();
  const total = totalBasisPoints(people);
  const single = people.length === 1;
  const nameless = people.some((person) => !person.name.trim());
  const problem = totalProblem(people);

  function type(key: string, text: string) {
    setEditing({ key, text });
    const basisPoints = parsePercent(text);
    if (basisPoints !== undefined)
      setSplit((current) => typeShare(current, key, basisPoints));
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
    setSplit((current) => ({
      ...current,
      people: addPerson(
        current.people,
        { key: newKey(), name, basisPoints: 0, isSelf: false },
        current.set,
      ),
    }));
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
      lede="Type a number or move a slider. Anyone you haven't set yet adjusts so it adds up to 100%."
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
                      setSplit((current) => ({
                        people: removePerson(
                          current.people,
                          person.key,
                          current.set,
                        ),
                        set: current.set.filter((key) => key !== person.key),
                      }));
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
                  const basisPoints = Number(event.target.value);
                  setSplit((current) =>
                    slideShare(current, person.key, basisPoints),
                  );
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
      {problem ? (
        <p className="wiz-error sd-problem" role="status">
          {problem}
        </p>
      ) : null}
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
                setSplit((current) => evenSplit(current));
                setEditing(undefined);
              }}
            >
              Even split
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
