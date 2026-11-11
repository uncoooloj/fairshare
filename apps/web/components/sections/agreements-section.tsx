import type { Dispatch, SetStateAction } from "react";
import { PlusIcon } from "../icons";
import { Heading, AgreementList } from "../agreement-widgets";
import type { Agreement } from "../../lib/model";
import { Button } from "../ui";
import type { Run } from "./types";

export interface AgreementsSectionProps {
  canCreateAgreement: boolean;
  agreements: Agreement[];
  workspaces: any[];
  workspace: string;
  /** Opens the full-screen creation wizard (rendered by FairshareApp outside the shell). */
  setCreating: Dispatch<SetStateAction<boolean>>;
  run: Run;
  openAgreement: (a: Agreement) => Promise<void>;
}

/** Agreement list. Creating one happens in the full-screen wizard. */
export function AgreementsSection({
  canCreateAgreement,
  agreements,
  workspaces,
  workspace,
  setCreating,
  run,
  openAgreement,
}: AgreementsSectionProps) {
  const workspaceRole = workspaces.find((item) => item.id === workspace)?.role;
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
      <AgreementList
        agreements={agreements}
        workspaceRole={workspaceRole}
        onOpen={(a) => run(() => openAgreement(a))}
      />
    </>
  );
}
