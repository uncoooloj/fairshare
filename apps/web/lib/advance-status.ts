import type { AgreementMember } from "./agreement-api";
import type { Agreement } from "./model";

/** Version statuses as the API returns them (mirrors the domain VersionStatus). */
enum VersionState {
  DRAFT = "DRAFT",
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
}

/** An advance in the current proposal that nobody has confirmed as paid yet. */
export interface UnconfirmedAdvance {
  advanceId: string;
  recipientId: string;
  amountCents: number;
  versionId: number;
}

/** The advance the organizer still has to confirm as paid, or undefined. The agreement can
 * be sent and approved before it is, but it only switches on once it is confirmed. */
export function unconfirmedAdvance(
  agreement: Agreement,
): UnconfirmedAdvance | undefined {
  const version = agreement.value.versions.at(-1);
  const advance = version?.rules.advance;
  if (
    !version ||
    !advance ||
    advance.verified ||
    !(
      [VersionState.DRAFT, VersionState.AWAITING_APPROVAL] as string[]
    ).includes(version.status)
  )
    return undefined;
  return {
    advanceId: advance.id,
    recipientId: advance.recipientId,
    amountCents: advance.amountCents,
    versionId: version.id,
  };
}

/** Everyone approved, and only the advance confirmation stands between the agreement and
 * switching on. */
export function awaitingAdvanceConfirmation(agreement: Agreement): boolean {
  const version = agreement.value.versions.at(-1);
  if (
    !version ||
    version.status !== VersionState.AWAITING_APPROVAL ||
    !unconfirmedAdvance(agreement)
  )
    return false;
  const members = agreement.value.members as AgreementMember[];
  return members.every(
    (m) => !m.pending && Object.hasOwn(version.approvals, m.userId),
  );
}
