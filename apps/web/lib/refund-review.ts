/** Fields the API keeps on an agreement for refunds (see packages/domain applyCaptureRefund). */
export interface RefundReviewState {
  reviewHold: boolean;
  /** Per person: paid out beyond what refunds left them, still to be settled. */
  owedBack?: Record<string, number>;
  /** Owed amounts are coming off each person's next shares. */
  offsetOwedBack?: boolean;
  members: { userId: string; displayName: string; role: string }[];
}
/** What the paused banner shows to the person looking. */
export enum PausedView {
  NONE = "NONE",
  ORGANIZER = "ORGANIZER",
  COLLABORATOR = "COLLABORATOR",
}
export function pausedView(
  state: RefundReviewState,
  userId: string,
): PausedView {
  if (!state.reviewHold) return PausedView.NONE;
  return state.members.some(
    (m) => m.userId === userId && m.role === "ORGANIZER",
  )
    ? PausedView.ORGANIZER
    : PausedView.COLLABORATOR;
}
export function pausedMessage(
  view: PausedView,
  state: RefundReviewState,
): string {
  if (view === PausedView.ORGANIZER) return "Payouts are paused after a refund";
  if (view === PausedView.COLLABORATOR) {
    const organizer =
      state.members.find((m) => m.role === "ORGANIZER")?.displayName ??
      "the organizer";
    return `Payouts are paused while ${organizer} reviews a refund.`;
  }
  return "";
}
/** Why payouts cannot resume yet; values match the API's ResumeBlocker. */
export enum ResumeBlocker {
  DISPUTE_OPEN = "DISPUTE_OPEN",
  WEBHOOK_UNRECONCILED = "WEBHOOK_UNRECONCILED",
  REFUND_UNRECONCILED = "REFUND_UNRECONCILED",
}
export const resumeBlockerCopy: Record<ResumeBlocker, string> = {
  [ResumeBlocker.DISPUTE_OPEN]:
    "A PayPal dispute is still open. You can resume once it’s closed.",
  [ResumeBlocker.WEBHOOK_UNRECONCILED]:
    "PayPal sent an update we haven’t checked yet. Check it under “Something wrong with a payment?” first.",
  [ResumeBlocker.REFUND_UNRECONCILED]:
    "A refund is still going through. Check its status under “Something wrong with a payment?” first.",
};
export function blockerMessages(codes: string[]): string[] {
  return codes.map((code) =>
    Object.values(ResumeBlocker).includes(code as ResumeBlocker)
      ? resumeBlockerCopy[code as ResumeBlocker]
      : "Something still needs checking with PayPal before payouts can resume.",
  );
}
/** One line per person who got more than the refund left them. */
export function owedLines(
  state: RefundReviewState,
): { userId: string; name: string; cents: number }[] {
  return Object.entries(state.owedBack ?? {})
    .filter(([, cents]) => cents > 0)
    .map(([userId, cents]) => ({
      userId,
      name:
        state.members.find((m) => m.userId === userId)?.displayName ??
        "Someone",
      cents,
    }));
}
