import { useEffect, useRef, useState } from "react";
import { parseShare, type Member } from "../lib/model";
import { Button, Field } from "./ui";
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
  return (
    <div
      ref={panel}
      className="split-rule-editor panel"
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
      <h4>Edit rule · Revenue split</h4>
      <p>
        Change the proposed split after recoupment. This edits the draft, not
        the signed agreement.
      </p>
      {members.map((member) => (
        <Field
          key={member.userId}
          label={`${member.displayName} · proposed share %`}
        >
          <input
            inputMode="decimal"
            onFocus={() => onFocusMember(member.displayName)}
            value={draft[member.userId] ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, [member.userId]: event.target.value })
            }
          />
        </Field>
      ))}
      <p role="status" className={total === 10000 ? "" : "split-total-invalid"}>
        Total: {total === null ? "Enter valid percentages" : `${total / 100}%`}
        {total !== 10000 && " · must equal 100%"}
      </p>
      <details>
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
      <small>
        Save the proposal afterward. Every participant must approve the new
        version.
      </small>
    </div>
  );
}
