import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { AgreementInvitation } from "../agreement-invitation";
import { AgreementAllocations } from "../agreement-allocations";
import { AgreementHeader } from "../agreement-workspace";
import { AgreementTabs } from "../agreement-tabs";
import { AgreementDocument } from "../agreement-document";
import { AgreementName } from "../agreement-name";
import { AgreementCreationWizard } from "../agreement-creation-wizard";
import { AgreementSetup } from "../agreement-setup";
import {
  AgreementTab,
  Section,
  type Agreement,
  type Revenue,
  type User,
  type Version,
} from "../../lib/model";
import { Notice } from "../ui";
import { agreementIdentityKey } from "../../lib/agreement-identity";
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
  creationAgreementId: string;
  creationMarker: (agreement: Pick<Agreement, "workspaceId" | "id">) => string;
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
  setCreationAgreementId: Dispatch<SetStateAction<string>>;
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

/** The selected agreement: creation wizard, or its header, tabs and tab panel. */
export function AgreementDetail({
  selected,
  user,
  base,
  busy,
  organizer,
  latest,
  active,
  tab,
  creationAgreementId,
  creationMarker,
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
  setCreationAgreementId,
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
  return (
    <>
      {creationAgreementId === agreementIdentityKey(selected) &&
      !selected.value.versions.length ? (
        <AgreementCreationWizard
          key={selected.id}
          agreement={selected}
          source={source}
          members={members}
          userId={user.id}
          invitation={
            workspaces.find((w) => w.id === workspace)?.role === "OWNER" ? (
              <AgreementInvitation
                key={selected.id}
                base={base}
                name={selected.value.name}
              />
            ) : undefined
          }
          onSaveName={(name) => mutate("/name", { name })}
          onAddMember={(userId) => mutate("/members", { userId })}
          onRefresh={() => loadWorkspace(workspace)}
          onDirtyChange={setDraftDirty}
          onBusyChange={setBusy}
          onClose={() => {
            setDraftDirty(false);
            setCreationAgreementId("");
            setSelected(null);
            setSection(Section.Agreements);
          }}
          onComplete={() => {
            sessionStorage.removeItem(creationMarker(selected));
            setCreationAgreementId("");
            setTab(AgreementTab.Terms);
            setNotice(
              "Draft ready. Review the saved source and choose whether AI may interpret it before proposing rules.",
            );
          }}
        />
      ) : (
        <>
          <AgreementHeader
            key={JSON.stringify([selected.workspaceId, selected.id])}
            agreement={selected}
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
            aria-labelledby={`agreement-tab-${tab}`}
            tabIndex={0}
          >
            {selected.value.reviewHold && (
              <Notice warning>
                Payments need review. Allocations remain recorded; outgoing
                payouts are paused. No automatic clawback is assumed.
              </Notice>
            )}
            {tab === AgreementTab.Overview && (
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
            {tab === AgreementTab.People && (
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
              />
            )}
            {tab === AgreementTab.Terms && (
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
            )}
            {tab === AgreementTab.Allocations && (
              <AgreementAllocations agreement={selected} />
            )}
            {tab === AgreementTab.Document && (
              <AgreementDocument
                key={selected.id}
                agreement={selected}
                base={base}
              />
            )}
            {tab === AgreementTab.Payments && (
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
      )}
    </>
  );
}
