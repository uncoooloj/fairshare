import { useEffect, useRef, useState } from "react";
import { parseShare, type Member } from "../lib/model";
import { toneInRoster } from "../lib/person";
import { Avatar, AvatarSize, SplitBar } from "./person";
import { Button } from "./ui";
export function SplitRuleEditor({
  members,
  values,
  original,
  onCancel,
  onApply,
  onFocusMember,
}: {
  members: Member[];
  values: Record<string, string>;
  original: string[];
  onCancel: () => void;
  onApply: (values: Record<string, string>) => void;
  onFocusMember: (name: string) => void;
}) {
  const [draft, setDraft] = useState(values);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      opener.current?.focus();
    };
  }, []);
  let total: number | null = null;
  try {
    total = members.reduce(
      (sum, member) => sum + parseShare(draft[member.userId] ?? ""),
      0,
    );
  } catch {
    /* Keep invalid draft local until corrected. */
  }
  const shares = members
    .map((member) => {
      let basisPoints = 0;
      try {
        basisPoints = parseShare(draft[member.userId] ?? "");
      } catch {
        // An incomplete row has no bar segment until the person corrects it.
      }
      return {
        userId: member.userId,
        name: member.displayName,
        basisPoints,
        tone: toneInRoster(member.userId, members),
      };
    })
    .filter((share) => share.basisPoints > 0);
  return (
    <div
      ref={panel}
      className="split-rule-editor panel"
      data-local-rule-edit
      role="region"
      aria-label="Edit split rule"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <header className="f3-split-header">
        <div>
          <p className="f3-split-kicker">Edit rule</p>
          <h4>Revenue split</h4>
          <p>
            Change the proposed split after recoupment. This edits the draft,
            not the signed agreement.
          </p>
        </div>
        <span className={`f3-total-badge ${total === 10000 ? "is-valid" : ""}`}>
          {total === null ? "Check total" : `${total / 100}%`}
        </span>
      </header>
      <div className="f3-split-bar">
        <SplitBar segments={shares} />
      </div>
      <div className="f3-split-rows" aria-label="Proposed split">
        {members.map((member) => (
          <label className="f3-split-row" key={member.userId}>
            <Avatar
              name={member.displayName}
              tone={toneInRoster(member.userId, members)}
              size={AvatarSize.SMALL}
              label={false}
            />
            <span className="f3-split-name">{member.displayName}</span>
            <span className="f3-split-input">
              <input
                aria-label={`${member.displayName} proposed share percentage`}
                inputMode="decimal"
                onFocus={() => onFocusMember(member.displayName)}
                value={draft[member.userId] ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, [member.userId]: event.target.value })
                }
              />
              <span aria-hidden="true">%</span>
            </span>
          </label>
        ))}
      </div>
      <p
        role="status"
        className={`f3-total-line ${total === 10000 ? "" : "split-total-invalid"}`}
      >
        {total === null
          ? "Enter valid percentages that add to 100%."
          : total === 10000
            ? "Total 100%"
            : `Total ${total / 100}% · must equal 100%`}
      </p>
      <details className="f3-original">
        <summary>Original extraction · unchanged</summary>
        {original.length ? (
          original.map((text, index) => (
            <blockquote key={index}>{text}</blockquote>
          ))
        ) : (
          <p>
            No validated source extraction is available. Confirm these terms
            manually.
          </p>
        )}
      </details>
      <footer className="f3-split-footer">
        <small>
          Save the proposal afterward. Every participant must approve the new
          version.
        </small>
        <div className="row">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={total !== 10000}
            onClick={() => onApply(draft)}
          >
            Apply to draft
          </Button>
        </div>
      </footer>
    </div>
  );
}
