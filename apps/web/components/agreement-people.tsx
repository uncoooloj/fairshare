import { useEffect, useState } from "react";
import { api, type Agreement, type Version } from "../lib/model";
import { approvalLabel, payoutReadinessLabel } from "../lib/people-readiness";
import { canRemind } from "../lib/review-discussion";
import { ReviewReminder } from "./review-discussion";
import { Button } from "./ui";
import { Drawer } from "./allocation-drawer";
import { PayoutEmailStep } from "./payout-email-step";
import { Avatar } from "./person";
import { toneInRoster } from "../lib/person";

function chipTone(label: string) {
  if (label === "Approved") return "good";
  if (label === "Ready to be paid") return "good";
  if (/Awaiting|Changes|Needs/.test(label)) return "warning";
  return "neutral";
}

/** Readiness only: the API never returns anyone's payout email here. */
type Readiness = { id: string; status: string };
export function AgreementPeople({
  agreement,
  version,
  userId,
  base,
}: {
  agreement: Agreement;
  version?: Version;
  userId: string;
  base: string;
}) {
  const [destinations, setDestinations] = useState<Readiness[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editingOwn, setEditingOwn] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ members: Readiness[] }>(
      `workspaces/${encodeURIComponent(agreement.workspaceId)}/payment-accounts`,
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
  }, [agreement.workspaceId, refresh]);
  const members = agreement.value.members;
  const approved = version
    ? members.filter((m) => Object.hasOwn(version.approvals, m.userId)).length
    : 0;
  return (
    <section aria-label="Agreement participants" className="ag-people">
      {version && (
        <div className="panel ag-card ag-approval-progress">
          <strong>
            {approved} of {members.length} have approved v{version.id}
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
          Refresh
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
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
              const approval = approvalLabel(version, member.userId);
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
                        {version &&
                          canRemind(
                            agreement,
                            version,
                            userId,
                            member.userId,
                          ) && (
                            <ReviewReminder
                              base={base}
                              agreement={agreement}
                              version={version}
                              userId={userId}
                              recipientId={member.userId}
                            />
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
                          {agreement.value.versions.length
                            ? "People can’t be added once a split has been proposed."
                            : "Add people before proposing a split. You can’t remove people yet."}
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
