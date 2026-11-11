import type { Dispatch, SetStateAction } from "react";
import { OverviewDashboard } from "../overview-dashboard";
import { PlusIcon } from "../icons";
import { Heading } from "../agreement-widgets";
import { Section, type Agreement, type User } from "../../lib/model";
import { Button } from "../ui";
import type { Run } from "./types";

export interface OverviewSectionProps {
  user: User;
  agreements: Agreement[];
  payouts: any[];
  canCreateAgreement: boolean;
  setSection: Dispatch<SetStateAction<Section>>;
  setCreating: Dispatch<SetStateAction<boolean>>;
  run: Run;
  openAgreement: (a: Agreement) => Promise<void>;
}

/** Overview greeting, dashboard and link to all agreements. */
export function OverviewSection({
  user,
  agreements,
  payouts,
  canCreateAgreement,
  setSection,
  setCreating,
  run,
  openAgreement,
}: OverviewSectionProps) {
  return (
    <>
      <Heading
        title={`Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${user.name.split(" ")[0]}`}
        description={`Here's what needs you across ${agreements.length} agreement${agreements.length === 1 ? "" : "s"}.`}
        action={
          canCreateAgreement && (
            <Button
              onClick={() => {
                setSection(Section.Agreements);
                setCreating(true);
              }}
            >
              <PlusIcon />
              New agreement
            </Button>
          )
        }
      />
      <OverviewDashboard
        agreements={agreements}
        payouts={payouts}
        userId={user.id}
        onOpen={(a) => run(() => openAgreement(a))}
      />
      <p className="ov-footer-link">
        <button
          className="text-button"
          onClick={() => setSection(Section.Agreements)}
        >
          View all agreements
        </button>
      </p>
    </>
  );
}
