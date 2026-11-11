import type { Dispatch, SetStateAction } from "react";
import { MoneyCard, RevenueRulesCard } from "../../agreement-workspace";
import { RevenueTable } from "../../agreement-widgets";
import { formatDate } from "../../../lib/preferences";
import { activitySentence } from "../../../lib/overview-summary";
import {
  AgreementTab,
  Section,
  type Agreement,
  type Revenue,
  type User,
  type Version,
} from "../../../lib/model";

export interface AgreementOverviewTabProps {
  selected: Agreement;
  active: Version | undefined;
  user: User;
  payouts: any[];
  payoutsComplete: boolean;
  payoutsUnavailable: boolean;
  changeAgreementTab: (next: AgreementTab) => void;
  setBreakdown: Dispatch<SetStateAction<Revenue | null>>;
  navigate: (s: Section) => boolean;
  /** Organizer only: opens the guided change to the split. */
  onChangeSplit?: () => void;
}

/** Agreement overview: the split in plain sentences, recent payments, activity and money. */
export function AgreementOverviewTab({
  selected,
  active,
  user,
  payouts,
  payoutsComplete,
  payoutsUnavailable,
  changeAgreementTab,
  setBreakdown,
  navigate,
  onChangeSplit,
}: AgreementOverviewTabProps) {
  // Money always follows the active rules. Before first approval, show the
  // pending version so people can review what they are being asked to approve.
  const shown = active ?? selected.value.versions.at(-1);
  return (
    <div className="detail-columns ag-overview">
      <div className="ag-stack">
        {shown ? (
          <RevenueRulesCard
            agreement={selected}
            version={shown}
            action={
              <>
                {onChangeSplit && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={onChangeSplit}
                  >
                    Change the agreement
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => changeAgreementTab(AgreementTab.Terms)}
                >
                  Read the agreement →
                </button>
              </>
            }
          />
        ) : (
          <section className="panel ag-card" aria-label="Revenue rules">
            <h2>Revenue rules</h2>
            <p className="muted">No split yet. Agree on one in Agreement.</p>
          </section>
        )}
        <section className="panel ag-card ag-payments-card">
          <div className="ag-card-head">
            <h2>Recent payments</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => changeAgreementTab(AgreementTab.Payments)}
            >
              All payments →
            </button>
          </div>
          <RevenueTable agreement={selected} onOpen={setBreakdown} />
        </section>
        <section className="panel ag-card">
          <h2 className="ag-card-title">Activity</h2>
          <ul className="activity">
            {selected.value.audit
              .slice(-6)
              .reverse()
              .map((e) => (
                <li key={e.sequence}>
                  <span>{activitySentence(selected, e, user.id)}</span>
                  <time>{formatDate(e.at)}</time>
                </li>
              ))}
          </ul>
        </section>
      </div>
      <MoneyCard
        userId={user.id}
        agreement={selected}
        payouts={payouts.filter(
          (p) =>
            p.agreement.id === selected.id &&
            p.agreement.workspaceId === selected.workspaceId,
        )}
        payoutsComplete={payoutsComplete}
        payoutsUnavailable={payoutsUnavailable}
        footer={
          <div className="ag-tip">
            <p>
              <strong>Owed</strong> is each person's share.{" "}
              <strong>Paid</strong> is money that reached them.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => navigate(Section.Payouts)}
            >
              Open payouts →
            </button>
          </div>
        }
      />
    </div>
  );
}
