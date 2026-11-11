import { useState, type Dispatch, type SetStateAction } from "react";
import { AgreementPeople } from "../../agreement-people";
import { AgreementInvitation } from "../../agreement-invitation";
import { Heading } from "../../agreement-widgets";
import { Drawer } from "../../allocation-drawer";
import { organizerHandoverOf } from "../../../lib/agreement-api";
import type { Agreement, User, Version } from "../../../lib/model";
import { Button, Notice } from "../../ui";
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
  onAgreementChange: (agreement: Agreement) => void;
  /** Unused since the payout email moved to its own step; kept for callers. */
  setNotice: Dispatch<SetStateAction<string>>;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

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
  onAgreementChange,
}: AgreementPeopleTabProps) {
  const [handingTo, setHandingTo] = useState("");
  const nameOf = (id: string) =>
    firstName(
      selected.value.members.find((m) => m.userId === id)?.displayName ||
        "them",
    );
  const offer = organizerHandoverOf(selected);
  return (
    <>
      <Heading
        small
        title="People in this agreement"
        description={
          selected.value.versions.length
            ? "Each person approves the split for themselves."
            : "Add everyone before you set the split. Each person approves for themselves."
        }
      />
      {organizer && offer && (
        <Notice announcement="polite">
          <p>
            You asked {nameOf(offer.toUserId)} to take over organizing. Waiting
            for them to accept.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await mutate("/organizer-transfer", {}, "DELETE");
              })
            }
          >
            Cancel request
          </Button>
        </Notice>
      )}
      <AgreementPeople
        key={`${selected.workspaceId}:${selected.id}`}
        agreement={selected}
        version={latest}
        userId={user.id}
        base={base}
        onHandOver={organizer ? setHandingTo : undefined}
        organizer={organizer}
        onAgreementChange={onAgreementChange}
      />
      {handingTo && (
        <Drawer label="Hand over organizing" onClose={() => setHandingTo("")}>
          <p>
            {nameOf(handingTo)} will be asked to take over organizing{" "}
            {selected.value.name}. Once they accept, they add people, send
            changes and look after payments, and you become a collaborator.
          </p>
          <p>
            The split doesn’t change. Everyone keeps their share, and the
            advance and fees stay as they are.
          </p>
          <div className="collab-drawer-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setHandingTo("")}
            >
              Not now
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await mutate("/organizer-transfer", { toUserId: handingTo });
                  setHandingTo("");
                })
              }
            >
              Ask {nameOf(handingTo)}
            </Button>
          </div>
        </Drawer>
      )}
      {organizer && !selected.value.versions.length && (
        <section className="section">
          <h3>People you’ve worked with</h3>
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
