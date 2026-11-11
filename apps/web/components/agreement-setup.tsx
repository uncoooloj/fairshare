"use client";
import { useState } from "react";
import { AgreementTab, type Agreement } from "../lib/model";
import { Button, Field } from "./ui";
export function NewAgreement({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="setup-layout">
      <form
        className="panel setup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && name.trim()) onCreate(name.trim());
        }}
      >
        <span className="eyebrow">NEW AGREEMENT</span>
        <h2>Give your collaboration a home</h2>
        <p className="muted">
          Start with a name everyone will recognise. You’ll add the people and
          source document next.
        </p>
        <Field label="Agreement name" hint="For example, Summer Sessions EP">
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="Name your agreement"
          />
        </Field>
        <div className="setup-footer">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create and add people"}
          </Button>
        </div>
      </form>
      <aside className="panel setup-explainer">
        <h3>What happens next</h3>
        <ol>
          <li>
            <strong>Bring everyone in</strong>
            <p>Invite everyone who gets a share.</p>
          </li>
          <li>
            <strong>Make the rules clear</strong>
            <p>Add your agreement. We'll suggest the split; you check it.</p>
          </li>
          <li>
            <strong>Everyone approves</strong>
            <p>When the last person approves, payments split automatically.</p>
          </li>
        </ol>
        <small>No money moves yet.</small>
      </aside>
    </div>
  );
}
/** Only for agreements that never got a split (made before the wizard).
 * Once a split is sent, the header's status line says where things stand. */
export function AgreementSetup({
  agreement,
  tab,
  onNavigate,
}: {
  agreement: Agreement;
  tab: AgreementTab;
  onNavigate: (tab: AgreementTab) => void;
}) {
  if (agreement.value.activeVersionId) return null;
  if (agreement.value.versions.length) return null;
  const target = AgreementTab.Terms;
  return (
    <section className="setup-progress" aria-label="Agreement setup status">
      <strong>Set the split</strong>
      <p>Add everyone in People first, then set the split in Agreement.</p>
      {tab !== target && (
        <Button variant="secondary" onClick={() => onNavigate(target)}>
          Set the split
        </Button>
      )}
    </section>
  );
}
