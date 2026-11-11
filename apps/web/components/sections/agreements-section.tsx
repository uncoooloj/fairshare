import type { Dispatch, SetStateAction } from "react";
import { PlusIcon } from "../icons";
import { Heading, AgreementList } from "../agreement-widgets";
import type { Agreement } from "../../lib/model";
import { Button } from "../ui";
import type { Run } from "./types";

/** Never sent, and yours: it reopens in the wizard instead of the agreement page. */
export function isDraftAgreement(a: Agreement, userId: string) {
  return (
    a.value.versions.length === 0 &&
    a.value.members.some((m) => m.userId === userId && m.role === "ORGANIZER")
  );
}

export interface AgreementsSectionProps {
  userId: string;
  canCreateAgreement: boolean;
  agreements: Agreement[];
  workspaces: any[];
  workspace: string;
  /** Opens the full-screen creation wizard (rendered by FairshareApp outside the shell). */
  setCreating: Dispatch<SetStateAction<boolean>>;
  run: Run;
  /** Drafts reopen in the wizard; everything else opens the agreement page. */
  openAgreement: (a: Agreement) => Promise<void>;
}

/** Agreement list, with unsent drafts first. Creating one happens in the full-screen wizard. */
export function AgreementsSection({
  userId,
  canCreateAgreement,
  agreements,
  workspaces,
  workspace,
  setCreating,
  run,
  openAgreement,
}: AgreementsSectionProps) {
  const workspaceRole = workspaces.find((item) => item.id === workspace)?.role;
  const drafts = agreements.filter((a) => isDraftAgreement(a, userId));
  const sent = agreements.filter((a) => !drafts.includes(a));
  return (
    <>
      <Heading
        title="Agreements"
        action={
          canCreateAgreement && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New agreement
            </Button>
          )
        }
      />
      {drafts.length > 0 && (
        <section className="wiz-drafts" aria-label="Not sent yet">
          <ul>
            {drafts.map((a) => (
              <li key={JSON.stringify([a.workspaceId, a.id])}>
                <span className="wiz-drafts-name">
                  <strong>{a.value.name}</strong>
                  <small>Not sent yet</small>
                </span>
                <Button
                  variant="secondary"
                  onClick={() => run(() => openAgreement(a))}
                >
                  Finish setting up
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(sent.length > 0 || drafts.length === 0) && (
        <AgreementList
          agreements={sent}
          workspaceRole={workspaceRole}
          onOpen={(a) => run(() => openAgreement(a))}
        />
      )}
    </>
  );
}
