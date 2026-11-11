import { useEffect, useRef, useState } from "react";
import { api, type Agreement, type Version } from "../lib/model";
import {
  isPendingMember,
  replacePersonLink,
  type AgreementMember,
} from "../lib/agreement-api";
import { approvalLabel, payoutReadinessLabel } from "../lib/people-readiness";
import { canRemind } from "../lib/review-discussion";
import { ReviewReminder } from "./review-discussion";
import { Button } from "./ui";
import { Drawer } from "./allocation-drawer";
import { PayoutEmailStep } from "./payout-email-step";
import { Avatar } from "./person";
import { toneInRoster } from "../lib/person";
import { publicWebOrigin } from "../lib/public-web-origin";
import { AGREEMENT_INVITE_PREFIX } from "./agreement-invitation";

function chipTone(label: string) {
  if (label === "Approved") return "good";
  if (label === "Ready to be paid") return "good";
  if (/Awaiting|Changes|Needs/.test(label)) return "warning";
  return "neutral";
}

/** Readiness only: the API never returns anyone's payout email here. */
type Readiness = { id: string; status: string };

/** Named-person links deliberately keep their bearer token out of server logs. */
export function personInviteLink(token: string, origin: string) {
  return `${publicWebOrigin(origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + token)}`;
}

export const isCurrentReissue = (
  startingRevision: number,
  latestRevision: number,
) => startingRevision === latestRevision;

export function AgreementPeople({
  agreement,
  version,
  userId,
  base,
  organizer = false,
  onAgreementChange,
}: {
  agreement: Agreement;
  version?: Version;
  userId: string;
  base: string;
  organizer?: boolean;
  onAgreementChange?: (agreement: Agreement) => void;
}) {
  const agreementIdentity = JSON.stringify([
    agreement.workspaceId,
    agreement.id,
    base,
  ]);
  const agreementIdentityRef = useRef(agreementIdentity);
  const latestRevisionRef = useRef(agreement.revision);
  const [currentAgreement, setCurrentAgreement] = useState(agreement);
  const [destinations, setDestinations] = useState<Readiness[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editingOwn, setEditingOwn] = useState(false);
  const [reissuing, setReissuing] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [issuedInvite, setIssuedInvite] = useState<{
    name: string;
    link: string;
  } | null>(null);
  useEffect(() => {
    setCurrentAgreement((current) =>
      agreement.revision >= current.revision ? agreement : current,
    );
  }, [agreement]);
  useEffect(() => {
    agreementIdentityRef.current = agreementIdentity;
    setIssuedInvite(null);
    setInviteError("");
    setReissuing("");
  }, [agreementIdentity]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ members: Readiness[] }>(
      `workspaces/${encodeURIComponent(currentAgreement.workspaceId)}/payment-accounts?version=2`,
    )
      .then((result) => {
        if (active) setDestinations(result.members);
      })
      .catch(() => {
        if (active) {
          setDestinations(null);
          setError("Couldn’t load payout readiness. Refresh to try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentAgreement.workspaceId, refresh]);
  latestRevisionRef.current = Math.max(
    latestRevisionRef.current,
    agreement.revision,
    currentAgreement.revision,
  );
  const members = currentAgreement.value.members as AgreementMember[];
  const currentVersion = version
    ? (currentAgreement.value.versions.find((item) => item.id === version.id) ??
      version)
    : undefined;
  const approved = currentVersion
    ? members.filter((m) => Object.hasOwn(currentVersion.approvals, m.userId))
        .length
    : 0;
  const sent = currentAgreement.value.versions.length > 0;
  async function reissue(member: AgreementMember) {
    const requestIdentity = agreementIdentity;
    const startingRevision = currentAgreement.revision;
    setReissuing(member.userId);
    setInviteError("");
    try {
      const result = await replacePersonLink(
        currentAgreement.workspaceId,
        currentAgreement.id,
        currentAgreement.revision,
        member.userId,
      );
      if (
        agreementIdentityRef.current !== requestIdentity ||
        !isCurrentReissue(startingRevision, latestRevisionRef.current)
      )
        return;
      latestRevisionRef.current = result.agreement.revision;
      setCurrentAgreement(result.agreement);
      onAgreementChange?.(result.agreement);
      setIssuedInvite({
        name: member.displayName,
        link: personInviteLink(result.invitation.token, location.origin),
      });
    } catch (cause) {
      if (
        agreementIdentityRef.current !== requestIdentity ||
        !isCurrentReissue(startingRevision, latestRevisionRef.current)
      )
        return;
      setInviteError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t create a new invite link.",
      );
    } finally {
      if (agreementIdentityRef.current === requestIdentity) setReissuing("");
    }
  }
  return (
    <section aria-label="Agreement participants" className="ag-people">
      {currentVersion && (
        <div className="panel ag-card ag-approval-progress">
          <strong>
            {approved} of {members.length} have approved v{currentVersion.id}
          </strong>
          <div
            className={`ag-progress ${approved === members.length ? "is-complete" : "is-brand"}`}
            role="progressbar"
            aria-label="People who approved"
            aria-valuemin={0}
            aria-valuemax={members.length}
            aria-valuenow={approved}
          >
            <span
              style={{
                width: `${members.length ? (approved / members.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="row ag-people-toolbar">
        <p className="muted">
          Payout emails are private. Everyone else only sees whether a person is
          ready to be paid.
        </p>
        <Button
          type="button"
          variant="quiet"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh readiness
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {inviteError && <p role="alert">{inviteError}</p>}
      <div className="people-table-scroll ag-people-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">
                {version ? `v${version.id} approval` : "Approval"}
              </th>
              <th scope="col">Payout</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const destination = destinations?.find(
                (item) => item.id === member.userId,
              );
              const approval = approvalLabel(currentVersion, member.userId);
              const readiness = loading
                ? "Loading…"
                : payoutReadinessLabel(destination?.status);
              return (
                <tr key={member.userId}>
                  <th scope="row">
                    <span className="ag-person-cell">
                      <Avatar
                        name={member.displayName}
                        tone={toneInRoster(member.userId, members)}
                        label={false}
                      />
                      <span>
                        {member.displayName}
                        {member.userId === userId && (
                          <small className="muted"> (you)</small>
                        )}
                      </span>
                    </span>
                  </th>
                  <td>
                    {member.role === "ORGANIZER" ? "Organizer" : "Collaborator"}
                  </td>
                  <td>
                    <span className={`status-chip ${chipTone(approval)}`}>
                      {approval}
                    </span>
                  </td>
                  <td>
                    <span className={`status-chip ${chipTone(readiness)}`}>
                      {readiness}
                    </span>
                  </td>
                  <td className="ag-row-actions">
                    <details className="people-actions ag-menu">
                      <summary
                        className="icon-button"
                        aria-label={`Actions for ${member.displayName}`}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                        >
                          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
                          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
                        </svg>
                      </summary>
                      <div className="ag-menu-list">
                        {currentVersion &&
                          canRemind(
                            currentAgreement,
                            currentVersion,
                            userId,
                            member.userId,
                          ) && (
                            <ReviewReminder
                              base={base}
                              agreement={currentAgreement}
                              version={currentVersion}
                              userId={userId}
                              recipientId={member.userId}
                            />
                          )}
                        {organizer && sent && isPendingMember(member) && (
                          <Button
                            type="button"
                            variant="quiet"
                            disabled={Boolean(reissuing)}
                            onClick={() => void reissue(member)}
                          >
                            {reissuing === member.userId
                              ? "Creating invite link…"
                              : "Create new invite link"}
                          </Button>
                        )}
                        {member.userId === userId && (
                          <Button
                            type="button"
                            variant="quiet"
                            onClick={() => setEditingOwn(true)}
                          >
                            Add or change my payout email
                          </Button>
                        )}
                        <p className="muted">
                          {currentAgreement.value.versions.length
                            ? "This agreement’s participant list is locked because a proposal exists."
                            : "Participants can be added before the first proposal. Removing participants or changing the organizer is not supported."}
                        </p>
                        <p className="muted">
                          Access permissions cannot change while a person
                          belongs to an agreement.
                        </p>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {issuedInvite && (
        <section className="panel ag-card" aria-label="New invite link">
          <h3>New invite link for {issuedInvite.name}</h3>
          <p className="muted">
            The previous link no longer works. Copy this link now; it is shown
            only once.
          </p>
          <input
            aria-label={`New invite link for ${issuedInvite.name}`}
            readOnly
            value={issuedInvite.link}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard.writeText(issuedInvite.link)
            }
          >
            Copy invite link
          </Button>
        </section>
      )}
      {editingOwn && (
        <Drawer label="Payout email" onClose={() => setEditingOwn(false)}>
          <PayoutEmailStep
            autoFocus={false}
            onDone={() => {
              setEditingOwn(false);
              setRefresh((value) => value + 1);
            }}
          />
        </Drawer>
      )}
    </section>
  );
}
