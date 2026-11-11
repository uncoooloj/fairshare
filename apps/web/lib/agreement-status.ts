import type { Agreement } from "./model";
import type { AgreementMember } from "./agreement-api";
import {
  awaitingAdvanceConfirmation,
  unconfirmedAdvance,
} from "./advance-status";
import { formatMoneyHeadline } from "./preferences";

/** Where the agreement stands, from the viewer's side. Drives the one-line header. */
export enum AgreementStage {
  /** Payouts are paused while a payment is checked. */
  OnHold = "on-hold",
  /** Rules are switched on and no change is waiting. */
  AllSet = "all-set",
  /** The viewer's approval is the one still needed (possibly among others). */
  WaitingForYou = "waiting-for-you",
  /** Waiting for other people to approve. */
  WaitingForOthers = "waiting-for-others",
  /** Everyone approved; the organizer still has to confirm the advance was paid. */
  AdvanceUnconfirmed = "advance-unconfirmed",
  /** Someone asked for a change; the organizer edits and sends again. */
  ChangeRequested = "change-requested",
  /** Nothing has been sent for approval yet. */
  NotSent = "not-sent",
}

/** The one button the header can offer. */
export enum StageAction {
  None = "none",
  Approve = "approve",
  SeeRequest = "see-request",
  /** Organizer: ready-made messages for the people still to approve. */
  Nudge = "nudge",
  /** Organizer: confirm the advance was paid, which switches the split on. */
  ConfirmAdvance = "confirm-advance",
}

export enum StageTone {
  Calm = "",
  Good = "good",
  Warning = "warning",
}

export interface AgreementStatus {
  stage: AgreementStage;
  /** One sentence, shown as the header line. */
  line: string;
  /** Optional quieter text after the line. */
  note?: string;
  /** Short chip label, matching the agreements list. */
  chip: string;
  tone: StageTone;
  action: StageAction;
}

const AWAITING = "AWAITING_APPROVAL";
const DRAFT = "DRAFT";
const ORGANIZER = "ORGANIZER";

/** "Riley", "Riley and Jordan", "Riley, Jordan and Sam". */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const DAY = 24 * 60 * 60 * 1000;
const SENT = "SENT_FOR_REVIEW";
const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** "sent today", "sent yesterday", "sent 3 days ago"; empty when we can't tell. */
export function sentAgo(agreement: Agreement, now = Date.now()) {
  const at = Date.parse(
    agreement.value.audit.findLast((entry) => entry.type === SENT)?.at ?? "",
  );
  if (!Number.isFinite(at)) return "";
  const days = Math.max(0, Math.floor((now - at) / DAY));
  if (days === 0) return "sent today";
  if (days === 1) return "sent yesterday";
  return `sent ${days} days ago`;
}

/** Role-aware status from real agreement data only. */
export function agreementStatus(
  agreement: Agreement,
  userId: string,
  now = Date.now(),
): AgreementStatus {
  const value = agreement.value;
  const latest = value.versions.at(-1);
  const organizer =
    value.members.find((m) => m.userId === userId)?.role === ORGANIZER;
  const nameOf = (id: string) =>
    firstName(
      value.members.find((m) => m.userId === id)?.displayName || "Someone",
    );
  const advance = unconfirmedAdvance(agreement);
  /** "Maya's $2,000" or "your $2,000". */
  const advanceOf = advance
    ? `${advance.recipientId === userId ? "your" : `${nameOf(advance.recipientId)}'s`} ${formatMoneyHeadline(advance.amountCents)}`
    : "";
  if (value.reviewHold)
    return {
      stage: AgreementStage.OnHold,
      line: "Payouts are paused while we check a payment. Nobody's share has changed.",
      chip: "Needs attention",
      tone: StageTone.Warning,
      action: StageAction.None,
    };
  if (latest?.status === AWAITING) {
    const missing = (value.members as AgreementMember[]).filter(
      (m) => !latest.approvals[m.userId],
    );
    const others = missing.filter((m) => m.userId !== userId);
    const youToo = missing.some((m) => m.userId === userId);
    const change = !!value.activeVersionId;
    if (youToo)
      return {
        stage: AgreementStage.WaitingForYou,
        line: change
          ? "A change to the split is waiting for you to approve"
          : "Waiting for you to approve",
        chip: "Needs your approval",
        tone: StageTone.Calm,
        action: StageAction.Approve,
      };
    if (others.length) {
      const names = (list: typeof others) =>
        joinNames(list.map((m) => firstName(m.displayName)));
      const approved = value.members.filter(
        (m) => m.userId !== userId && latest.approvals[m.userId],
      );
      const waiting = others.filter((m) => !m.pending);
      const notJoined = others.filter((m) => m.pending);
      const parts = [
        approved.length ? `${names(approved)} approved` : "",
        waiting.length ? `waiting for ${names(waiting)}` : "",
        notJoined.length
          ? `${names(notJoined)} ${notJoined.length > 1 ? "haven’t" : "hasn’t"} joined yet`
          : "",
        sentAgo(agreement, now),
      ].filter(Boolean);
      return {
        stage: AgreementStage.WaitingForOthers,
        line: capitalize(parts.join(" · ")),
        note: advance
          ? `${capitalize(advanceOf)} advance still needs confirming.`
          : "It switches on by itself once everyone approves.",
        chip: "Waiting for approval",
        tone: StageTone.Calm,
        action: organizer ? StageAction.Nudge : StageAction.None,
      };
    }
    if (awaitingAdvanceConfirmation(agreement))
      return {
        stage: AgreementStage.AdvanceUnconfirmed,
        line: organizer
          ? `Everyone approved. Confirm ${advanceOf} is paid to switch it on.`
          : `Waiting for ${advanceOf} to be confirmed.`,
        chip: organizer ? "Confirm the advance" : "Waiting for approval",
        tone: StageTone.Calm,
        action: organizer ? StageAction.ConfirmAdvance : StageAction.None,
      };
    // Older agreements: everyone approved but the rules were never switched on.
    if (!change)
      return {
        stage: AgreementStage.WaitingForOthers,
        line: organizer
          ? "Everyone approved. Switch it on in Agreement."
          : "Everyone approved. Waiting for the organizer to switch it on.",
        chip: "Waiting for approval",
        tone: StageTone.Calm,
        action: StageAction.None,
      };
  }
  if (latest?.status === DRAFT && latest.changeRequests.length) {
    const asked = [
      ...new Set(latest.changeRequests.map((r) => nameOf(r.userId))),
    ];
    return {
      stage: AgreementStage.ChangeRequested,
      line: `${joinNames(asked)} asked for a change`,
      chip: "Change requested",
      tone: StageTone.Warning,
      action: StageAction.SeeRequest,
    };
  }
  if (value.activeVersionId)
    return {
      stage: AgreementStage.AllSet,
      line: organizer ? "All set. Payments split automatically." : "All set",
      chip: "Active",
      tone: StageTone.Good,
      action: StageAction.None,
    };
  const organizerName = value.members.find((m) => m.role === ORGANIZER);
  return {
    stage: AgreementStage.NotSent,
    line: organizer
      ? "Not sent for approval yet"
      : `Waiting for ${organizerName ? firstName(organizerName.displayName) : "the organizer"}`,
    chip: "Draft",
    tone: StageTone.Calm,
    action: StageAction.None,
  };
}
