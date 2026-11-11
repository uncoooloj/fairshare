import type { Dispatch, SetStateAction } from "react";
import { OverviewDashboard } from "../overview-dashboard";
import { PlusIcon } from "../icons";
import { Heading } from "../agreement-widgets";
import {
  AgreementTab,
  Section,
  type Agreement,
  type User,
} from "../../lib/model";
import { Button } from "../ui";
import type { Run } from "./types";

export interface OverviewSectionProps {
  user: User;
  agreements: Agreement[];
  payouts: any[];
  payoutsComplete: boolean;
  payoutsUnavailable: boolean;
  canCreateAgreement: boolean;
  setSection: Dispatch<SetStateAction<Section>>;
  setCreating: Dispatch<SetStateAction<boolean>>;
  run: Run;
  openAgreement: (
    a: Agreement,
    initialTab?: AgreementTab,
  ) => Promise<void>;
}

/** Overview greeting, dashboard and link to all agreements. */
export function OverviewSection({
  user,
  agreements,
  payouts,
  payoutsComplete,
  payoutsUnavailable,
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
        payoutsComplete={payoutsComplete}
        payoutsUnavailable={payoutsUnavailable}
        userId={user.id}
        onOpen={(a) => run(() => openAgreement(a))}
        onSendReminder={(a) =>
          run(() => openAgreement(a, AgreementTab.People))
        }
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
