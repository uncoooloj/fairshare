import type { Dispatch, SetStateAction } from "react";
import { PlusIcon } from "../icons";
import { Heading, AgreementList } from "../agreement-widgets";
import {
  AgreementIntake,
  type AgreementIntakeInput,
} from "../agreement-intake";
import type { Agreement } from "../../lib/model";
import { Button } from "../ui";
import type { Run } from "./types";

export interface AgreementsSectionProps {
  creating: boolean;
  canCreateAgreement: boolean;
  busy: boolean;
  agreements: Agreement[];
  workspaces: any[];
  workspace: string;
  setCreating: Dispatch<SetStateAction<boolean>>;
  createFromAgreement: (input: AgreementIntakeInput) => Promise<void>;
  run: Run;
  openAgreement: (a: Agreement) => Promise<void>;
}

/** Agreement list, or the intake form while creating one. */
export function AgreementsSection({
  creating,
  canCreateAgreement,
  busy,
  agreements,
  workspaces,
  workspace,
  setCreating,
  createFromAgreement,
  run,
  openAgreement,
}: AgreementsSectionProps) {
  const workspaceRole = workspaces.find((item) => item.id === workspace)?.role;
  return (
    <>
      <Heading
        title={creating ? "Create an agreement" : "Agreements"}
        description={
          creating
            ? "Bring the people, terms and money into one place."
            : undefined
        }
        action={
          !creating &&
          canCreateAgreement && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New agreement
            </Button>
          )
        }
      />
      {creating && canCreateAgreement ? (
        <AgreementIntake
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={createFromAgreement}
        />
      ) : (
        <AgreementList
          agreements={agreements}
          workspaceRole={workspaceRole}
          onOpen={(a) => run(() => openAgreement(a))}
        />
      )}
    </>
  );
}
