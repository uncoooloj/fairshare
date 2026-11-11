import type { Agreement } from "./model";

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
  GetPaid = "get-paid",
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

/** Role-aware status from real agreement data only. */
export function agreementStatus(
  agreement: Agreement,
  userId: string,
): AgreementStatus {
  const value = agreement.value;
  const latest = value.versions.at(-1);
  const organizer =
    value.members.find((m) => m.userId === userId)?.role === ORGANIZER;
  const nameOf = (id: string) =>
    firstName(
      value.members.find((m) => m.userId === id)?.displayName || "Someone",
    );
  if (value.reviewHold)
    return {
      stage: AgreementStage.OnHold,
      line: "Payouts are paused while we check a payment. Nobody's share has changed.",
      chip: "Needs attention",
      tone: StageTone.Warning,
      action: StageAction.None,
    };
  if (latest?.status === AWAITING) {
    const missing = value.members.filter((m) => !latest.approvals[m.userId]);
    const others = missing
      .filter((m) => m.userId !== userId)
      .map((m) => firstName(m.displayName));
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
    if (others.length)
      return {
        stage: AgreementStage.WaitingForOthers,
        line: organizer
          ? `Waiting for ${joinNames(others)} to approve`
          : `Waiting for ${joinNames(others)}`,
        chip: "Waiting for approval",
        tone: StageTone.Calm,
        action: StageAction.None,
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
      action: organizer ? StageAction.GetPaid : StageAction.None,
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
