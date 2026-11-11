"use client";
import { SendReviewConfirmation } from "./send-review-confirmation";
import { useState } from "react";
import type { Agreement, Version } from "../lib/model";
import { contractReviewState, formatRuleChange } from "../lib/contract-review";
import { Button, Field, Notice } from "./ui";

type ReviewAction = "send" | "approve" | "activate" | "request-change";

/** Replace the terms action group and generic change-request form with this panel. */
export function ContractReviewPanel({
  agreement,
  version,
  userId,
  busy,
  onAction,
}: {
  agreement: Agreement;
  version: Version;
  userId: string;
  busy: boolean;
  onAction: (
    action: ReviewAction,
    payload?: { reason: string },
  ) => Promise<unknown>;
}) {
  const state = contractReviewState(agreement, version, userId);
  const [confirmSend, setConfirmSend] = useState(false);
  const [reason, setReason] = useState("");
  const [rule, setRule] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = busy || submitting;
  async function act(action: ReviewAction, payload?: { reason: string }) {
    setError("");
    setSubmitting(true);
    try {
      await onAction(action, payload);
      if (action === "request-change") setReason("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this action. Reload the latest agreement and try again.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  }
  // Rules in use need no review block: the rules card's badge says so.
  const inUse = version.status === "ACTIVE";
  if (
    inUse &&
    !state.blockers.length &&
    !version.changeRequests.length &&
    !error
  )
    return null;
  return (
    <section className="section" aria-label="Agreement review">
      {!inUse && (
        <>
          <h3>{state.heading}</h3>
          <p className="muted">{state.effect}</p>
        </>
      )}
      {state.blockers.length > 0 && (
        <Notice warning>
          <strong>Questions to answer</strong>
          <ul>
            {state.blockers.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <p>Answer these before asking for approval.</p>
        </Notice>
      )}
      {version.status === "AWAITING_APPROVAL" && (
        <ul aria-label="Participant decisions">
          {agreement.value.members.map((member) => (
            <li key={member.userId}>
              {member.displayName}:{" "}
              {Object.hasOwn(version.approvals, member.userId)
                ? "Approved"
                : "Waiting"}
            </li>
          ))}
        </ul>
      )}
      {confirmSend && (
        <SendReviewConfirmation
          agreement={agreement}
          version={version}
          userId={userId}
          busy={disabled}
          canSend={state.canSend}
          requestError={error}
          onSend={() => act("send")}
          onClose={() => setConfirmSend(false)}
        />
      )}
      <div className="actions">
        {version.status === "DRAFT" && (
          <Button
            disabled={disabled || !state.canSend}
            onClick={() => setConfirmSend(true)}
          >
            Ask everyone to approve
          </Button>
        )}
        {state.canApprove && (
          <Button disabled={disabled} onClick={() => void act("approve")}>
            Approve this split
          </Button>
        )}
        {state.canActivate && (
          <Button disabled={disabled} onClick={() => void act("activate")}>
            Switch on this split
          </Button>
        )}
      </div>
      {state.canRequestChange && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              void act("request-change", {
                reason: formatRuleChange(rule, reason),
              });
            } catch (cause) {
              setError((cause as Error).message);
            }
          }}
        >
          <h4>Ask for a change</h4>
          <p className="muted">
            Everyone will need to approve again. The current split stays in use
            meanwhile.
          </p>
          <Field label="What's it about?">
            <select
              value={rule}
              onChange={(event) => setRule(event.target.value)}
            >
              <option value="">The whole agreement</option>
              <option>The split</option>
              <option>Fees</option>
              <option>The advance</option>
              <option>How the agreement was read</option>
            </select>
          </Field>
          <Field
            label="What should change?"
            hint="Everyone on the agreement will see this."
          >
            <textarea
              required
              maxLength={1900}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Say what's wrong and what it should say."
            />
          </Field>
          <Button variant="secondary" disabled={disabled || !reason.trim()}>
            Ask for a change
          </Button>
        </form>
      )}
      {version.changeRequests.length > 0 && (
        <details>
          <summary>Change requests ({version.changeRequests.length})</summary>
          <ul>
            {version.changeRequests.map((request, index) => (
              <li key={index}>
                <strong>
                  {agreement.value.members.find(
                    (member) => member.userId === request.userId,
                  )?.displayName ?? "Participant"}
                </strong>
                : {request.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
    </section>
  );
}

export function ContractSourceGuidance({
  replacement = false,
}: {
  replacement?: boolean;
}) {
  return (
    <div className="section">
      <p className="muted">
        Upload a PDF or Word file up to 5 MB, or paste your agreement. We’ll
        read it and keep the original for everyone on the agreement. Check names
        and amounts before you send it.
      </p>
      {replacement && (
        <Notice>
          A changed agreement needs everyone to approve again. The current split
          stays in use until they do, and past payments don’t change.
        </Notice>
      )}
      <details>
        <summary>What Fairshare can split</summary>
        <p>
          Shares of money in US dollars, PayPal’s fee, and an advance paid back
          first. Check each rule against the agreement before you approve.
        </p>
        <p>
          Other costs, tax, dates, deadlines and refunds aren’t handled
          automatically. If your agreement depends on them, ask about it before
          approving.
        </p>
        <p>
          “Net revenue” can mean different things. Agree which costs come off
          first.
        </p>
        <p>
          You can always read the agreement. You can download the original file
          when it is available. A refund pauses payouts while it’s checked;
          nobody’s money is taken back automatically.
        </p>
      </details>
    </div>
  );
}
