import type { Dispatch, SetStateAction } from "react";
import { AgreementPeople } from "../../agreement-people";
import { AgreementInvitation } from "../../agreement-invitation";
import { Heading } from "../../agreement-widgets";
import type { Agreement, User, Version } from "../../../lib/model";
import { Button } from "../../ui";
import type { Mutate, Run } from "../types";

export interface AgreementPeopleTabProps {
  selected: Agreement;
  latest: Version | undefined;
  user: User;
  base: string;
  organizer: boolean;
  members: any[];
  busy: boolean;
  workspaces: any[];
  workspace: string;
  run: Run;
  mutate: Mutate;
  /** Unused since the payout email moved to its own step; kept for callers. */
  setNotice: Dispatch<SetStateAction<string>>;
}

/** People on the agreement and invitations. Your own payout email opens from your row. */
export function AgreementPeopleTab({
  selected,
  latest,
  user,
  base,
  organizer,
  members,
  busy,
  workspaces,
  workspace,
  run,
  mutate,
}: AgreementPeopleTabProps) {
  return (
    <>
      <Heading
        small
        title="People in this agreement"
        description="Add everyone before drafting rules. Each person approves their own account’s decision."
      />
      <AgreementPeople
        key={selected.id}
        agreement={selected}
        version={latest}
        userId={user.id}
        base={base}
      />
      {organizer && !selected.value.versions.length && (
        <section className="section">
          <h3>Add someone you already work with</h3>
          {members
            .filter(
              (m) => !selected.value.members.some((s) => s.userId === m.id),
            )
            .map((m) => (
              <div className="row" key={m.id}>
                <span>
                  {m.name} <small>{m.email}</small>
                </span>
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() =>
                    run(() => mutate("/members", { userId: m.id }))
                  }
                >
                  Add to agreement
                </Button>
              </div>
            ))}
          {workspaces.find((w) => w.id === workspace)?.role === "OWNER" && (
            <AgreementInvitation
              key={selected.id}
              base={base}
              name={selected.value.name}
            />
          )}
        </section>
      )}
    </>
  );
}
