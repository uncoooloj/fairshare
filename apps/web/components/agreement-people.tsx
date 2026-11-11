import { useEffect, useState } from "react";
import { api, type Agreement, type Version } from "../lib/model";
import { approvalLabel, payoutReadinessLabel } from "../lib/people-readiness";
import { canRemind } from "../lib/review-discussion";
import { ReviewReminder } from "./review-discussion";
import { Button } from "./ui";

type Destination = { id: string; status: string; accountHint: string | null };
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
  const [destinations, setDestinations] = useState<Destination[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<{ members: Destination[] }>(
      `workspaces/${encodeURIComponent(agreement.workspaceId)}/payment-accounts`,
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
  }, [agreement.workspaceId, refresh]);
  return (
    <section aria-label="Agreement participants">
      <div className="row">
        <p className="muted">
          Payout destinations are private to each person. A saved ID is not
          proof of account ownership or payout eligibility.
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
      <div className="people-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Agreement role</th>
              <th scope="col">
                {version ? `Version ${version.id} review` : "Review"}
              </th>
              <th scope="col">Payout destination</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agreement.value.members.map((member) => {
              const destination = destinations?.find(
                (item) => item.id === member.userId,
              );
              return (
                <tr key={member.userId}>
                  <th scope="row">
                    <span className="avatar small" aria-hidden="true">
                      {member.displayName[0]}
                    </span>
                    {member.displayName}
                    {member.userId === userId ? " (you)" : ""}
                  </th>
                  <td>
                    {member.role === "ORGANIZER" ? "Organizer" : "Collaborator"}
                  </td>
                  <td>{approvalLabel(version, member.userId)}</td>
                  <td>
                    {loading
                      ? "Loading…"
                      : payoutReadinessLabel(destination?.status)}
                    {!loading && destination?.accountHint && (
                      <small className="muted">{destination.accountHint}</small>
                    )}
                  </td>
                  <td>
                    <details className="people-actions">
                      <summary aria-label={`Actions for ${member.displayName}`}>
                        Actions
                      </summary>
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
                          onClick={() => {
                            const form = document.getElementById(
                              "agreement-payout-destination",
                            );
                            form?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                            form
                              ?.querySelector<HTMLInputElement>("input")
                              ?.focus({ preventScroll: true });
                          }}
                        >
                          Manage my payout destination
                        </Button>
                      )}
                      <p className="muted">
                        {agreement.value.versions.length
                          ? "This agreement’s participant list is locked because a proposal exists."
                          : "Participants can be added before the first proposal. Removing participants or changing the organizer is not supported."}
                      </p>
                      <p className="muted">
                        Workspace permissions cannot change while a person
                        belongs to an agreement.
                      </p>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
