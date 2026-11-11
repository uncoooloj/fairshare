import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { AgreementHeader } from "../agreement-workspace";
import { AgreementTabs, visibleTab } from "../agreement-tabs";
import { AgreementDocument } from "../agreement-document";
import { AgreementVersions } from "../agreement-versions";
import { StageAction } from "../../lib/agreement-status";
import { AgreementName } from "../agreement-name";
import { AgreementSetup } from "../agreement-setup";
import { OrganizerHandoverBanner } from "../organizer-handover-banner";
import {
  AgreementTab,
  Section,
  type Agreement,
  type Revenue,
  type User,
  type Version,
} from "../../lib/model";
import { Notice } from "../ui";
import type { Mutate, Run } from "./types";
import { AgreementOverviewTab } from "./agreement-tabs/overview-tab";
import { AgreementPeopleTab } from "./agreement-tabs/people-tab";
import { AgreementTermsTab } from "./agreement-tabs/terms-tab";
import { AgreementPaymentsTab } from "./agreement-tabs/payments-tab";
import { PaymentBreakdown } from "./agreement-tabs/payment-breakdown";

export interface AgreementDetailProps {
  selected: Agreement;
  user: User;
  base: string;
  busy: boolean;
  organizer: boolean;
  latest: Version | undefined;
  active: Version | undefined;
  tab: AgreementTab;
  /** True right after the creation wizard read the document: Terms opens on Proposed rules. */
  rulesLanding: boolean;
  workspaces: any[];
  workspace: string;
  members: any[];
  payments: any[];
  payouts: any[];
  payoutsComplete: boolean;
  payoutsUnavailable: boolean;
  source: string;
  documentId: string;
  extraction: any;
  editing: boolean;
  preview: any;
  breakdown: Revenue | null;
  approvedForPayout: string;
  draftDirty: boolean;
  rulesDirty: MutableRefObject<boolean>;
  run: Run;
  mutate: Mutate;
  refresh: () => Promise<void>;
  loadWorkspace: (id: string) => Promise<void>;
  navigate: (s: Section) => boolean;
  mayLeaveDraft: () => boolean;
  changeAgreementTab: (next: AgreementTab) => void;
  setTab: Dispatch<SetStateAction<AgreementTab>>;
  setSection: Dispatch<SetStateAction<Section>>;
  setSelected: Dispatch<SetStateAction<Agreement | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setPreview: Dispatch<SetStateAction<any>>;
  setEditing: Dispatch<SetStateAction<boolean>>;
  setBreakdown: Dispatch<SetStateAction<Revenue | null>>;
  setApprovedForPayout: Dispatch<SetStateAction<string>>;
  setDraftDirty: Dispatch<SetStateAction<boolean>>;
  setSource: Dispatch<SetStateAction<string>>;
  setDocumentId: Dispatch<SetStateAction<string>>;
  setExtraction: Dispatch<SetStateAction<any>>;
}

/** The selected agreement: its header, tabs and tab panel. */
export function AgreementDetail({
  selected,
  user,
  base,
  busy,
  organizer,
  latest,
  active,
  tab,
  rulesLanding,
  workspaces,
  workspace,
  members,
  payments,
  payouts,
  payoutsComplete,
  payoutsUnavailable,
  source,
  documentId,
  extraction,
  editing,
  preview,
  breakdown,
  approvedForPayout,
  draftDirty,
  rulesDirty,
  run,
  mutate,
  refresh,
  loadWorkspace,
  navigate,
  mayLeaveDraft,
  changeAgreementTab,
  setTab,
  setSection,
  setSelected,
  setBusy,
  setError,
  setNotice,
  setPreview,
  setEditing,
  setBreakdown,
  setApprovedForPayout,
  setDraftDirty,
  setSource,
  setDocumentId,
  setExtraction,
}: AgreementDetailProps) {
  // Splits live in Payments and the document in Agreement: old links land there.
  const shown = visibleTab(tab);
  useEffect(() => {
    const target =
      tab === AgreementTab.Document
        ? "agreement-document"
        : tab === AgreementTab.Allocations
          ? "agreement-splits"
          : "";
    if (target)
      document
        .getElementById(target)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tab]);
  const onStatusAction = (action: StageAction) => {
    if (action === StageAction.GetPaid) {
      changeAgreementTab(AgreementTab.Payments);
      requestAnimationFrame(() =>
        document
          .getElementById("get-paid")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } else if (
      action === StageAction.Approve ||
      action === StageAction.SeeRequest
    )
      changeAgreementTab(AgreementTab.Terms);
  };
  return (
    <>
      <>
        <AgreementHeader
          key={JSON.stringify([selected.workspaceId, selected.id])}
          agreement={selected}
          userId={user.id}
          onStatusAction={onStatusAction}
          onBack={() => navigate(Section.Agreements)}
          onViewPayouts={() => navigate(Section.Payouts)}
          renameSuggested={!!extraction?.suggestedTitle}
          rename={
            organizer
              ? (open, close) => (
                  <AgreementName
                    key={`${selected.id}:${selected.value.name}:${extraction?.suggestedTitle || ""}`}
                    name={selected.value.name}
                    suggestion={extraction?.suggestedTitle}
                    busy={busy}
                    defaultOpen={open}
                    onClose={close}
                    onSave={(name) =>
                      run(async () => {
                        await mutate("/name", { name });
                        close();
                      })
                    }
                  />
                )
              : undefined
          }
        />
        <OrganizerHandoverBanner
          agreement={selected}
          userId={user.id}
          busy={busy}
          run={run}
          mutate={mutate}
        />
        <AgreementSetup
          agreement={selected}
          tab={tab}
          onNavigate={changeAgreementTab}
        />
        <AgreementTabs
          value={tab}
          onChange={(next) => {
            changeAgreementTab(next);
          }}
        />
        <div
          role="tabpanel"
          id="agreement-panel"
          aria-labelledby={`agreement-tab-${shown}`}
          tabIndex={0}
        >
          {selected.value.reviewHold && (
            <Notice warning>
              Payouts are paused while we check a payment. Nobody's share has
              changed, and no money is taken back.
            </Notice>
          )}
          {shown === AgreementTab.Overview && (
            <AgreementOverviewTab
              selected={selected}
              active={active}
              user={user}
              payouts={payouts}
              payoutsComplete={payoutsComplete}
              payoutsUnavailable={payoutsUnavailable}
              changeAgreementTab={changeAgreementTab}
              setBreakdown={setBreakdown}
              navigate={navigate}
            />
          )}
          {shown === AgreementTab.People && (
            <AgreementPeopleTab
              selected={selected}
              latest={latest}
              user={user}
              base={base}
              organizer={organizer}
              members={members}
              busy={busy}
              workspaces={workspaces}
              workspace={workspace}
              run={run}
              mutate={mutate}
              setNotice={setNotice}
              setSelected={setSelected}
            />
          )}
          {shown === AgreementTab.Terms && (
            <div className="ag-agreement">
              <AgreementTermsTab
                selected={selected}
                latest={latest}
                user={user}
                base={base}
                busy={busy}
                editing={editing}
                preview={preview}
                approvedForPayout={approvedForPayout}
                workspaces={workspaces}
                workspace={workspace}
                source={source}
                documentId={documentId}
                extraction={extraction}
                rulesLanding={rulesLanding}
                draftDirty={draftDirty}
                rulesDirty={rulesDirty}
                run={run}
                mutate={mutate}
                mayLeaveDraft={mayLeaveDraft}
                changeAgreementTab={changeAgreementTab}
                setBusy={setBusy}
                setError={setError}
                setNotice={setNotice}
                setPreview={setPreview}
                setEditing={setEditing}
                setApprovedForPayout={setApprovedForPayout}
                setDraftDirty={setDraftDirty}
                setSource={setSource}
                setDocumentId={setDocumentId}
                setExtraction={setExtraction}
              />
              {!editing && selected.value.versions.length > 0 && (
                <>
                  <section
                    className="ag-agreement-document"
                    id="agreement-document"
                    aria-label="The agreement document"
                  >
                    <AgreementDocument
                      key={selected.id}
                      agreement={selected}
                      base={base}
                    />
                  </section>
                  <details className="panel ag-history">
                    <summary>History</summary>
                    <AgreementVersions agreement={selected} />
                  </details>
                </>
              )}
            </div>
          )}
          {shown === AgreementTab.Payments && (
            <AgreementPaymentsTab
              selected={selected}
              active={active}
              user={user}
              base={base}
              organizer={organizer}
              busy={busy}
              payments={payments}
              payouts={payouts}
              run={run}
              refresh={refresh}
              setBreakdown={setBreakdown}
            />
          )}
          {breakdown && (
            <PaymentBreakdown
              breakdown={breakdown}
              selected={selected}
              organizer={organizer}
              busy={busy}
              base={base}
              run={run}
              refresh={refresh}
              setBreakdown={setBreakdown}
              setNotice={setNotice}
            />
          )}
        </div>
      </>
    </>
  );
}
