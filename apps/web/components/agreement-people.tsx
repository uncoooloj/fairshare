import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Agreement, type Version } from "../lib/model";
import { isPendingMember, type AgreementMember } from "../lib/agreement-api";
import { approvalLabel, payoutReadinessLabel } from "../lib/people-readiness";
import { forgetStaleInviteTokens, issueInviteLink } from "../lib/share-link";
import { Button } from "./ui";
import { Drawer } from "./allocation-drawer";
import { PayoutEmailStep } from "./payout-email-step";
import { Avatar } from "./person";
import { toneInRoster } from "../lib/person";
import { oldLinkWarning, PersonShare } from "./person-share";

export { personInviteLink } from "../lib/share-link";

function chipTone(label: string) {
  if (label === "Approved") return "good";
  if (label === "Ready to be paid") return "good";
  if (/Awaiting|Changes|Needs|joined/.test(label)) return "warning";
  return "neutral";
}

/** Readiness only: the API never returns anyone's payout email here. */
type Readiness = { id: string; status: string };

/** Someone named by the organizer who hasn't accepted their invite yet. */
export const NOT_JOINED = "Hasn’t joined yet";

export function AgreementPeople({
  agreement,
  version,
  userId,
  base,
  onHandOver,
  organizer = false,
  onAgreementChange,
}: {
  agreement: Agreement;
  version?: Version;
  userId: string;
  base: string;
  /** Organizer only: offer the role to this joined person. */
  onHandOver?: (memberId: string) => void;
  organizer?: boolean;
  onAgreementChange?: (agreement: Agreement) => void;
}) {
  const agreementIdentity = JSON.stringify([
    agreement.workspaceId,
    agreement.id,
    base,
  ]);
  const agreementIdentityRef = useRef(agreementIdentity);
  const [currentAgreement, setCurrentAgreement] = useState(agreement);
  const [destinations, setDestinations] = useState<Readiness[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editingOwn, setEditingOwn] = useState(false);
  const [reissuing, setReissuing] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [confirmNewLink, setConfirmNewLink] = useState("");
  useEffect(() => {
    setCurrentAgreement((current) =>
      agreement.revision >= current.revision ? agreement : current,
    );
  }, [agreement]);
  useEffect(() => {
    agreementIdentityRef.current = agreementIdentity;
    setInviteNotice("");
    setConfirmNewLink("");
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
          setError("Couldn’t load PayPal status. Refresh to try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentAgreement.workspaceId, refresh]);
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible")
        setRefresh((value) => value + 1);
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);
  useEffect(
    () => forgetStaleInviteTokens(currentAgreement),
    [currentAgreement],
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
  /** Only while approvals are still coming in; the table says the rest. */
  const waitingOn =
    currentVersion?.status === "AWAITING_APPROVAL" && approved < members.length;
  /** A newer agreement from a link press: keep it here and hand it up. */
  function adopt(next: Agreement) {
    setCurrentAgreement((current) =>
      next.revision >= current.revision ? next : current,
    );
    onAgreementChange?.(next);
  }
  /** Only on request: the old link stops working, so never call this on load. */
  async function makeNewLink(member: AgreementMember) {
    const requestIdentity = agreementIdentity;
    setReissuing(member.userId);
    setConfirmNewLink("");
    setInviteNotice("");
    try {
      const result = await issueInviteLink(
        currentAgreement,
        member,
        location.origin,
      );
      if (agreementIdentityRef.current !== requestIdentity) return;
      adopt(result.agreement);
      setInviteNotice(
        `New link ready for ${member.displayName}. The old one no longer works.`,
      );
    } catch (cause) {
      if (agreementIdentityRef.current !== requestIdentity) return;
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") {
        let refreshFailed = false;
        try {
          const current = await api<Agreement>(base);
          if (agreementIdentityRef.current === requestIdentity) adopt(current);
        } catch {
          refreshFailed = true;
        }
        if (agreementIdentityRef.current !== requestIdentity) return;
        setInviteNotice(
          refreshFailed
            ? "Couldn’t load the latest agreement. Reload and try again."
            : "Someone else just changed this. Here’s the latest; try again.",
        );
      } else {
        setInviteNotice(
          cause instanceof Error ? cause.message : "Couldn’t make a new link.",
        );
      }
    } finally {
      if (agreementIdentityRef.current === requestIdentity) setReissuing("");
    }
  }
  return (
    <section aria-label="Agreement participants" className="ag-people">
      {waitingOn && (
        <p className="ag-people-count muted">
          {approved} of {members.length} approved
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {inviteNotice && <p role="status">{inviteNotice}</p>}
      {(() => {
        const member = members.find((m) => m.userId === confirmNewLink);
        if (!member || !isPendingMember(member)) return null;
        return (
          <div className="ag-new-link-confirm" role="group">
            <p>{oldLinkWarning(member)}</p>
            <div className="row">
              <Button
                type="button"
                disabled={Boolean(reissuing)}
                onClick={() => void makeNewLink(member)}
              >
                {reissuing ? "Making a new link…" : "Make a new link"}
              </Button>
              <Button
                type="button"
                variant="quiet"
                onClick={() => setConfirmNewLink("")}
              >
                Cancel
              </Button>
            </div>
          </div>
        );
      })()}
      <div className="people-table-scroll ag-people-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Approval</th>
              <th scope="col">
                <span
                  className="ag-th-hint"
                  tabIndex={0}
                  title="Payout emails are private. Others only see whether a person is ready to be paid."
                  aria-label="Payout. Payout emails are private. Others only see whether a person is ready to be paid."
                >
                  Payout
                </span>
              </th>
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
              const approval = isPendingMember(member)
                ? NOT_JOINED
                : approvalLabel(currentVersion, member.userId);
              const readiness =
                loading && !destinations
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
                    <div className="ag-row-actions-inner">
                      <PersonShare
                        agreement={currentAgreement}
                        member={member}
                        viewerId={userId}
                        organizer={organizer}
                        onAgreementChange={adopt}
                      />
                      {((organizer && isPendingMember(member)) ||
                        member.userId === userId ||
                        (onHandOver &&
                          member.userId !== userId &&
                          !isPendingMember(member))) && (
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
                              <circle
                                cx="3"
                                cy="8"
                                r="1.4"
                                fill="currentColor"
                              />
                              <circle
                                cx="8"
                                cy="8"
                                r="1.4"
                                fill="currentColor"
                              />
                              <circle
                                cx="13"
                                cy="8"
                                r="1.4"
                                fill="currentColor"
                              />
                            </svg>
                          </summary>
                          <div className="ag-menu-list">
                            {organizer && isPendingMember(member) && (
                              <div>
                                <Button
                                  type="button"
                                  variant="quiet"
                                  disabled={Boolean(reissuing)}
                                  onClick={(event) => {
                                    event.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open");
                                    setInviteNotice("");
                                    setConfirmNewLink(member.userId);
                                  }}
                                >
                                  Make a new link
                                </Button>
                              </div>
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
                            {onHandOver &&
                              member.userId !== userId &&
                              !isPendingMember(member) && (
                                <Button
                                  type="button"
                                  variant="quiet"
                                  onClick={() => onHandOver(member.userId)}
                                >
                                  Hand over organizing
                                </Button>
                              )}
                          </div>
                        </details>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
