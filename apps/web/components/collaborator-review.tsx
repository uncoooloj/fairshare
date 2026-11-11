"use client";
import { useEffect, useState } from "react";
import { api, type Agreement, type Version } from "../lib/model";
import { formatDate, formatMoneyHeadline } from "../lib/preferences";
import { toneInRoster } from "../lib/person";
import { SplitBar } from "./person";
import { Button, Notice } from "./ui";
import { SomethingWrongDrawer } from "./something-wrong-drawer";
import { PostApprovalPayout } from "./post-approval-payout";

/** The example payment shown to collaborators, in cents ($3,000). */
export const EXAMPLE_PAYMENT_CENTS = 300000;

/** Where a collaborator is in reviewing the latest terms. */
export enum CollaboratorStage {
  /** The latest terms wait for this person's approval. */
  REVIEW = "REVIEW",
  /** This person approved; others still need to. */
  WAITING = "WAITING",
  /** The terms are switched on. */
  ALL_SET = "ALL_SET",
  /** Someone asked for a change; the organizer is updating the terms. */
  UPDATING = "UPDATING",
  /** Nothing has been sent yet. */
  NOT_SENT = "NOT_SENT",
}

const percent = (basisPoints: number) =>
  `${Number((basisPoints / 100).toFixed(2))}%`;

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function listNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function collaboratorStage(
  agreement: Agreement,
  version: Version | undefined,
  userId: string,
): CollaboratorStage {
  if (!version) return CollaboratorStage.NOT_SENT;
  if (
    version.status === "ACTIVE" ||
    version.id === agreement.value.activeVersionId
  )
    return CollaboratorStage.ALL_SET;
  if (version.status === "AWAITING_APPROVAL")
    return Object.hasOwn(version.approvals, userId)
      ? CollaboratorStage.WAITING
      : CollaboratorStage.REVIEW;
  if (version.status === "DRAFT" && agreement.value.versions.length > 1)
    return CollaboratorStage.UPDATING;
  if (version.status === "DRAFT" && version.changeRequests.length)
    return CollaboratorStage.UPDATING;
  return CollaboratorStage.NOT_SENT;
}

export interface CollaboratorSummary {
  organizerName: string;
  /** "You get 20% after Maya's $2,000 is paid back." */
  headline: string;
  /** Plain sentences describing the whole agreement. */
  sentences: string[];
  /** Real people who still need to approve (not you). */
  waitingOn: string[];
}

/** Plain-English summary of the terms, from this person's point of view. */
export function collaboratorSummary(
  agreement: Agreement,
  version: Version,
  userId: string,
): CollaboratorSummary {
  const members = agreement.value.members;
  const nameOf = (id: string) =>
    members.find((m) => m.userId === id)?.displayName ?? "Someone";
  const organizer = members.find((m) => m.role === "ORGANIZER");
  const organizerName = firstName(organizer?.displayName ?? "The organizer");
  const rules = version.rules;
  const mine = rules.shares.find((s) => s.userId === userId)?.basisPoints ?? 0;
  const advance = rules.advance;
  const left = advance
    ? Math.max(
        0,
        advance.amountCents -
          (agreement.value.recoupedByAdvance[advance.id] || 0),
      )
    : 0;
  const advanceMoney = formatMoneyHeadline(left);
  const advanceIsMine = advance?.recipientId === userId;
  const advanceOwner = advance ? firstName(nameOf(advance.recipientId)) : "";
  let headline: string;
  if (!mine && !advanceIsMine)
    headline = "You don’t get a share of this agreement.";
  else if (advance && left > 0 && advanceIsMine)
    headline = mine
      ? `You get your ${advanceMoney} back first, then ${percent(mine)} of every payment.`
      : `You get your ${advanceMoney} back first.`;
  else if (advance && left > 0)
    headline = `You get ${percent(mine)} after ${advanceOwner}’s ${advanceMoney} is paid back.`;
  else headline = `You get ${percent(mine)} of every payment.`;
  const sentences: string[] = [];
  if (advance && left > 0)
    sentences.push(
      advanceIsMine
        ? `You paid ${formatMoneyHeadline(advance.amountCents)} upfront. You’re paid back first, before anything is split.`
        : `${advanceOwner} paid ${formatMoneyHeadline(advance.amountCents)} upfront. ${advanceOwner} is paid back first, before anything is split.`,
    );
  const split = rules.shares
    .map(
      (s) =>
        `${s.userId === userId ? "you" : firstName(nameOf(s.userId))} ${percent(s.basisPoints)}`,
    )
    .join(", ");
  sentences.push(
    `${advance && left > 0 ? "After that, every" : "Every"} payment is split: ${split}.`,
  );
  if (rules.feePolicy === "ORGANIZER_SHARE") {
    const bearer = rules.feeBearerId ?? organizer?.userId ?? "";
    sentences.push(
      bearer === userId
        ? "Payment fees come out of your share."
        : `Payment fees come out of ${firstName(nameOf(bearer))}’s share.`,
    );
  } else sentences.push("Payment fees come off the top, before the split.");
  const details = agreement.value.details;
  // Dates are calendar days; read them at midday so no time zone shifts the day.
  const day = (value: string) => formatDate(`${value}T12:00:00`);
  if (details?.effectiveFrom)
    sentences.push(
      details.effectiveTo
        ? `It covers payments from ${day(details.effectiveFrom)} to ${day(details.effectiveTo)}.`
        : `It covers payments from ${day(details.effectiveFrom)}.`,
    );
  const switchedOn =
    version.status === "ACTIVE" ||
    version.id === agreement.value.activeVersionId;
  if (!switchedOn) sentences.push("Nothing is paid until everyone approves.");
  const waitingOn = members
    .filter(
      (m) => m.userId !== userId && !Object.hasOwn(version.approvals, m.userId),
    )
    .map((m) => firstName(m.displayName));
  return { organizerName, headline, sentences, waitingOn };
}

/** What this person gets from the example payment, from the real split engine. */
function useExampleAmount(base: string, version: Version, userId: string) {
  const [cents, setCents] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setCents(null);
    setFailed(false);
    // Preview persists nothing: it is not a payment, approval or payout.
    api(`${base}/versions/${version.id}/preview`, "POST", {
      grossCents: EXAMPLE_PAYMENT_CENTS,
      feeCents: 0,
    })
      .then((r: { allocations: { userId: string; totalCents: number }[] }) => {
        if (!live) return;
        setCents(
          r.allocations.find((a) => a.userId === userId)?.totalCents ?? 0,
        );
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [base, version.id, userId]);
  return { cents, failed };
}

export function exampleLine(cents: number) {
  return `On a ${formatMoneyHeadline(EXAMPLE_PAYMENT_CENTS)} payment, that’s ${formatMoneyHeadline(cents)}.`;
}

function WhatYouGet({
  agreement,
  version,
  userId,
  base,
  onOpenDocument,
}: {
  agreement: Agreement;
  version: Version;
  userId: string;
  base: string;
  onOpenDocument: () => void;
}) {
  const summary = collaboratorSummary(agreement, version, userId);
  const example = useExampleAmount(base, version, userId);
  const roster = agreement.value.members;
  return (
    <>
      <p className="collab-headline">{summary.headline}</p>
      {example.cents !== null ? (
        <p className="collab-example">{exampleLine(example.cents)}</p>
      ) : (
        !example.failed && (
          <p className="collab-example muted" role="status">
            Working out an example…
          </p>
        )
      )}
      <div className="collab-split">
        <SplitBar
          segments={version.rules.shares.map((s) => ({
            userId: s.userId,
            name:
              roster.find((m) => m.userId === s.userId)?.displayName ??
              "Someone",
            basisPoints: s.basisPoints,
            tone: toneInRoster(s.userId, roster),
          }))}
        />
      </div>
      <ul className="collab-sentences">
        {summary.sentences.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <button type="button" className="collab-link" onClick={onOpenDocument}>
        See the full agreement
      </button>
    </>
  );
}

export interface CollaboratorTermsProps {
  agreement: Agreement;
  version: Version | undefined;
  userId: string;
  base: string;
  busy: boolean;
  /** True right after this person approved: show the "get paid" step. */
  justApproved: boolean;
  onApprove: () => Promise<void>;
  onRequestChange: (reason: string) => Promise<void>;
  onOpenDocument: () => void;
  onPayoutDone: () => void;
}

/** The collaborator's Terms view: what you get, approve or flag a problem, then get paid. */
export function CollaboratorTerms({
  agreement,
  version,
  userId,
  base,
  busy,
  justApproved,
  onApprove,
  onRequestChange,
  onOpenDocument,
  onPayoutDone,
}: CollaboratorTermsProps) {
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  const stage = collaboratorStage(agreement, version, userId);
  const member = agreement.value.members.some((m) => m.userId === userId);
  const organizer = firstName(
    agreement.value.members.find((m) => m.role === "ORGANIZER")?.displayName ??
      "The organizer",
  );
  if (justApproved)
    return <PostApprovalPayout base={base} onDone={onPayoutDone} />;
  if (!version || stage === CollaboratorStage.NOT_SENT)
    return (
      <section className="collab-review" aria-labelledby="collab-title">
        <h2 id="collab-title" className="collab-title">
          Nothing to review yet
        </h2>
        <p className="muted">
          {organizer} hasn’t sent the terms yet. You’ll be asked to approve them
          here.
        </p>
      </section>
    );
  const summary = collaboratorSummary(agreement, version, userId);
  const reviewing = stage === CollaboratorStage.REVIEW && member;
  const status =
    stage === CollaboratorStage.ALL_SET
      ? "All set. Payments will split automatically."
      : stage === CollaboratorStage.WAITING
        ? summary.waitingOn.length
          ? `You approved. Waiting for ${listNames(summary.waitingOn)}.`
          : "You approved."
        : stage === CollaboratorStage.UPDATING
          ? `${organizer} is updating the terms. You’ll be asked to approve again.`
          : `${organizer} is asking you to approve how the money is split.`;
  const myRequests = version.changeRequests.filter((r) => r.userId === userId);
  return (
    <section
      className={`collab-review ${reviewing ? "has-footer" : ""}`}
      aria-labelledby="collab-title"
    >
      <h2 id="collab-title" className="collab-title" tabIndex={-1}>
        {reviewing ? "What you get" : status}
      </h2>
      {reviewing && <p className="muted">{status}</p>}
      <WhatYouGet
        agreement={agreement}
        version={version}
        userId={userId}
        base={base}
        onOpenDocument={onOpenDocument}
      />
      {myRequests.length > 0 && stage === CollaboratorStage.UPDATING && (
        <div className="collab-note">
          <strong>Your note</strong>
          <p>{myRequests.at(-1)!.reason}</p>
        </div>
      )}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      {reviewing && (
        <div className="collab-footer" role="group" aria-label="Your decision">
          <Button
            variant="secondary"
            disabled={busy || approving}
            onClick={() => setDrawer(true)}
          >
            Something’s not right
          </Button>
          <Button
            disabled={busy || approving}
            onClick={async () => {
              setError("");
              setApproving(true);
              try {
                await onApprove();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Your approval wasn’t saved. Try again.",
                );
              } finally {
                setApproving(false);
              }
            }}
          >
            {approving ? "Approving…" : "Approve"}
          </Button>
        </div>
      )}
      {drawer && (
        <SomethingWrongDrawer
          organizerName={organizer}
          busy={busy}
          onSend={(reason) => onRequestChange(reason)}
          onClose={() => setDrawer(false)}
        />
      )}
    </section>
  );
}
