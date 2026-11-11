import type { Dispatch, SetStateAction } from "react";
import { RevenueRules } from "../../revenue-rules";
import {
  MoneyCard,
  RecoupmentCard,
  RuleSteps,
} from "../../agreement-workspace";
import { RevenueTable } from "../../agreement-widgets";
import { formatDate } from "../../../lib/preferences";
import {
  AgreementTab,
  Section,
  money,
  title,
  type Agreement,
  type Revenue,
  type User,
  type Version,
} from "../../../lib/model";
import { Button, Empty } from "../../ui";

export interface AgreementOverviewTabProps {
  selected: Agreement;
  active: Version | undefined;
  user: User;
  payouts: any[];
  changeAgreementTab: (next: AgreementTab) => void;
  setBreakdown: Dispatch<SetStateAction<Revenue | null>>;
  navigate: (s: Section) => boolean;
}

/** Agreement overview: active rules, recoupment, recent payments, activity and money. */
export function AgreementOverviewTab({
  selected,
  active,
  user,
  payouts,
  changeAgreementTab,
  setBreakdown,
  navigate,
}: AgreementOverviewTabProps) {
  return (
    <>
      <div className="detail-columns ag-overview">
        <div className="ag-stack">
          <section className="panel ag-card">
            {!active && (
              <>
                <h2>Revenue rules</h2>
                <p className="muted">
                  No active rules yet. Review and approve a version to begin.
                </p>
              </>
            )}
            {active ? (
              <RevenueRules key={`${selected.id}:${active.id}`}>
                <RuleSteps agreement={selected} rules={active.rules} />
              </RevenueRules>
            ) : (
              <Empty
                title="Agree on the rules first"
                action={
                  <Button
                    onClick={() => changeAgreementTab(AgreementTab.Terms)}
                  >
                    Set up terms
                  </Button>
                }
              >
                Add your people, upload the agreement and review a proposed
                split together.
              </Empty>
            )}
          </section>
          {active?.rules.advance && (
            <RecoupmentCard agreement={selected} rules={active.rules}>
              <p className="muted ag-fine">
                {money(
                  selected.value.recoupedByAdvance[active.rules.advance.id] ||
                    0,
                )}{" "}
                allocated toward recoupment. This is not proof of a completed
                payout.
              </p>
            </RecoupmentCard>
          )}
          <section className="panel ag-card ag-payments-card">
            <div className="ag-card-head">
              <h2>Recent payments</h2>
              <button
                type="button"
                className="text-button"
                onClick={() => changeAgreementTab(AgreementTab.Payments)}
              >
                View all payments →
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
                    <span>{title(e.type)}</span>
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
          footer={
            <div className="ag-tip">
              <p>
                An <strong>allocation</strong> records who is owed what. A{" "}
                <strong>payout</strong> records money sent to a recipient.
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
    </>
  );
}
