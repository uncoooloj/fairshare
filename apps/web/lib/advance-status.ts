import type { AgreementMember } from "./agreement-api";
import type { Agreement } from "./model";

/** Version statuses as the API returns them (mirrors the domain VersionStatus). */
enum VersionState {
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
}

/** An advance in the sent agreement that the organizer has not confirmed as paid yet. */
export interface AdvanceAwaitingConfirmation {
  advanceId: string;
  recipientName: string;
  amountCents: number;
}

/** The sent version, while it is still waiting (on approvals or on the advance). */
const sentVersion = (agreement: Agreement) => {
  const version = agreement.value.versions.at(-1);
  return version?.status === VersionState.AWAITING_APPROVAL
    ? version
    : undefined;
};

/** The advance the organizer still has to confirm as paid, or null. The agreement can be
 * sent and approved before it is, but it only switches on once it is confirmed. */
export function advanceAwaitingConfirmation(
  agreement: Agreement,
): AdvanceAwaitingConfirmation | null {
  const advance = sentVersion(agreement)?.rules.advance;
  if (!advance || advance.verified) return null;
  const recipient = agreement.value.members.find(
    (m) => m.userId === advance.recipientId,
  );
  return {
    advanceId: advance.id,
    recipientName: recipient?.displayName ?? "",
    amountCents: advance.amountCents,
  };
}

/** Everyone approved, and only the advance confirmation stands between the agreement and
 * switching on. */
export function readyButForAdvance(agreement: Agreement): boolean {
  const version = sentVersion(agreement);
  if (!version || !advanceAwaitingConfirmation(agreement)) return false;
  const members = agreement.value.members as AgreementMember[];
  return members.every(
    (m) => !m.pending && Object.hasOwn(version.approvals, m.userId),
  );
}

/** Earlier names for the same checks, kept for screens already built against them. */
export interface UnconfirmedAdvance {
  advanceId: string;
  recipientId: string;
  amountCents: number;
  versionId: number;
}
export function unconfirmedAdvance(
  agreement: Agreement,
): UnconfirmedAdvance | undefined {
  const version = sentVersion(agreement);
  const advance = version?.rules.advance;
  if (!version || !advance || advance.verified) return undefined;
  return {
    advanceId: advance.id,
    recipientId: advance.recipientId,
    amountCents: advance.amountCents,
    versionId: version.id,
  };
}
export const awaitingAdvanceConfirmation = readyButForAdvance;
