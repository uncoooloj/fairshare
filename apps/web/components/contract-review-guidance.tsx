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
  return (
    <section className="section" aria-label="Agreement review">
      <h3>{state.heading}</h3>
      <p className="muted">{state.effect}</p>
      {state.blockers.length > 0 && (
        <Notice warning>
          <strong>Clarifications needed</strong>
          <ul>
            {state.blockers.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
          <p>
            Propose clarified terms before asking anyone to approve. AI
            suggestions do not resolve these questions by themselves.
          </p>
        </Notice>
      )}
      {version.status === "AWAITING_APPROVAL" && (
        <ul aria-label="Participant decisions">
          {agreement.value.members.map((member) => (
            <li key={member.userId}>
              {member.displayName}:{" "}
              {Object.hasOwn(version.approvals, member.userId)
                ? "Approved this version"
                : "Awaiting approval"}
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
            Send for everyone’s review
          </Button>
        )}
        {state.canApprove && (
          <Button disabled={disabled} onClick={() => void act("approve")}>
            Approve version {version.id}
          </Button>
        )}
        {state.canActivate && (
          <Button disabled={disabled} onClick={() => void act("activate")}>
            Activate version {version.id}
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
          <h4>Request a change</h4>
          <p className="muted">
            This returns the proposal to draft and clears all approvals.
            Everyone reviews again. Any previously active version stays active.
          </p>
          <Field label="What needs clarification?">
            <select
              value={rule}
              onChange={(event) => setRule(event.target.value)}
            >
              <option value="">Agreement overall</option>
              <option>Revenue split</option>
              <option>Fees and net revenue</option>
              <option>Advance and recoupment</option>
              <option>Source interpretation</option>
            </select>
          </Field>
          <Field
            label="Explain the change"
            hint="A request for this version, not a private comment."
          >
            <textarea
              required
              maxLength={1900}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explain the issue and suggest wording everyone can review."
            />
          </Field>
          <Button variant="secondary" disabled={disabled || !reason.trim()}>
            Request changes
          </Button>
        </form>
      )}
      {version.changeRequests.length > 0 && (
        <details>
          <summary>
            Previous change requests ({version.changeRequests.length})
          </summary>
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
        Upload a PDF or DOCX up to 5 MB, or paste your agreement. We’ll read it
        and keep the original for everyone in the agreement. Check names and
        amounts before sharing the terms.
      </p>
      {replacement && (
        <Notice>
          An amended agreement starts a new review. Saving its source does not
          change active rules or past allocations. Propose a new version and
          obtain fresh approval from everyone; the organizer then activates it.
        </Notice>
      )}
      <details>
        <summary>What Fairshare can turn into payment rules</summary>
        <p>
          USD revenue shares, payment processing fees, and a verified advance
          with recoupment. Compare every proposed rule with the source before
          approving.
        </p>
        <p>
          Other expenses, tax obligations, effective dates, payment deadlines
          and automatic refund offsets are not executed by this engine. If the
          agreement depends on them, request clarification rather than treating
          them as implemented.
        </p>
        <p>
          “Net revenue” is not necessarily just revenue after processing fees.
          Agree which costs apply; do not substitute one definition for another.
        </p>
        <p>
          The source view contains extracted text and provenance. New PDF and
          DOCX uploads also have an authenticated original download; older
          uploads may have text only. Refunds can place allocations on hold for
          reconciliation; they do not automatically claw back someone’s payout.
        </p>
      </details>
    </div>
  );
}
