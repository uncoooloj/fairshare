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
            <p>
              Invite collaborators and add accepted members before proposing
              terms.
            </p>
          </li>
          <li>
            <strong>Make the rules clear</strong>
            <p>
              Add a PDF or text agreement. Review source-linked suggestions and
              resolve questions.
            </p>
          </li>
          <li>
            <strong>Agree, then start paying</strong>
            <p>Everyone approves the same version before payments begin.</p>
          </li>
        </ol>
        <small>Creating an agreement does not move money.</small>
      </aside>
    </div>
  );
}
export function AgreementSetup({
  agreement,
  tab,
  onNavigate,
}: {
  agreement: Agreement;
  tab: AgreementTab;
  onNavigate: (tab: AgreementTab) => void;
}) {
  const latest = agreement.value.versions.at(-1);
  if (agreement.value.activeVersionId) return null;
  const target = AgreementTab.Terms;
  return (
    <section className="setup-progress" aria-label="Agreement setup status">
      <strong>
        {latest
          ? "Review the proposal together"
          : "Finish setting up your agreement"}
      </strong>
      <p>
        {latest
          ? `${agreement.value.members.filter((m) => latest.approvals[m.userId]).length} of ${agreement.value.members.length} approved this version. Once everyone approves, these terms are used for payments.`
          : "Review the source in Terms. Add collaborators in People before saving a proposal for everyone to review."}
      </p>
      {tab !== target && (
        <Button variant="secondary" onClick={() => onNavigate(target)}>
          {latest ? "Review proposed terms" : "Continue setting up terms"}
        </Button>
      )}
    </section>
  );
}
