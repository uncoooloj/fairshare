import type { Dispatch, SetStateAction } from "react";
import { MoneyCard } from "../../agreement-workspace";
import { RevenueTable } from "../../agreement-widgets";
import { SplitBar } from "../../person";
import { formatDate } from "../../../lib/preferences";
import { toneInRoster } from "../../../lib/person";
import {
  activitySentence,
  splitSentences,
} from "../../../lib/overview-summary";
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
  // Before the split is switched on, describe the one waiting for approval.
  const shown = active ?? selected.value.versions.at(-1);
  const roster = selected.value.members;
  const name = (id: string) =>
    roster.find((m) => m.userId === id)?.displayName || "Former member";
  return (
    <div className="detail-columns ag-overview">
      <div className="ag-stack">
        <section className="panel ag-card ag-summary" aria-label="The split">
          <div className="ag-card-head">
            <h2>The split</h2>
            {shown && (
              <span className="ag-card-actions">
                {onChangeSplit && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={onChangeSplit}
                  >
                    Change the split
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => changeAgreementTab(AgreementTab.Terms)}
                >
                  Read the agreement →
                </button>
              </span>
            )}
          </div>
          {shown ? (
            <>
              <SplitBar
                segments={shown.rules.shares.map((s) => ({
                  userId: s.userId,
                  name: name(s.userId),
                  basisPoints: s.basisPoints,
                  tone: toneInRoster(s.userId, roster),
                }))}
              />
              <ul className="ag-summary-lines">
                {splitSentences(selected, shown.rules, user.id).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {!active && (
                <p className="muted ag-fine">
                  Nothing is paid until everyone approves.
                </p>
              )}
            </>
          ) : (
            <p className="muted">No split yet. Agree on one in Agreement.</p>
          )}
        </section>
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
