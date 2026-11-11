import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { PostApprovalPayout } from "../../post-approval-payout";
import { CollaboratorTerms } from "../../collaborator-review";
import { ReviewDiscussion } from "../../review-discussion";
import { RuleSteps, RuleStepsLayout } from "../../agreement-workspace";
import {
  Heading,
  PreviewForm,
  AllocationTable,
  AIReview,
  RulesEditor,
} from "../../agreement-widgets";
import { AgreementTermsFlow } from "../../agreement-terms-flow";
import { AgreementVersions } from "../../agreement-versions";
import {
  ContractReviewPanel,
  ContractSourceGuidance,
} from "../../contract-review-guidance";
import {
  AgreementTab,
  api,
  title,
  sampleAgreement,
  type Agreement,
  type User,
  type Version,
} from "../../../lib/model";
import { Button, Field } from "../../ui";
import type { Mutate, Run } from "../types";

export interface AgreementTermsTabProps {
  selected: Agreement;
  latest: Version | undefined;
  user: User;
  base: string;
  busy: boolean;
  editing: boolean;
  preview: any;
  approvedForPayout: string;
  workspaces: any[];
  workspace: string;
  source: string;
  documentId: string;
  extraction: any;
  /** Just created by the wizard with a reading result: open on Proposed rules. */
  rulesLanding?: boolean;
  draftDirty: boolean;
  rulesDirty: MutableRefObject<boolean>;
  run: Run;
  mutate: Mutate;
  mutateWithResult: (
    action: string,
    extra?: Record<string, unknown>,
  ) => Promise<boolean>;
  mayLeaveDraft: () => boolean;
  changeAgreementTab: (next: AgreementTab) => void;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setPreview: Dispatch<SetStateAction<any>>;
  setEditing: Dispatch<SetStateAction<boolean>>;
  setApprovedForPayout: Dispatch<SetStateAction<string>>;
  setDraftDirty: Dispatch<SetStateAction<boolean>>;
  setSource: Dispatch<SetStateAction<string>>;
  setDocumentId: Dispatch<SetStateAction<string>>;
  setExtraction: Dispatch<SetStateAction<any>>;
}

/** Terms: the latest proposal and its review, or the source and rules draft. */
export function AgreementTermsTab({
  selected,
  latest,
  user,
  base,
  busy,
  editing,
  preview,
  approvedForPayout,
  workspaces,
  workspace,
  source,
  documentId,
  extraction,
  rulesLanding = false,
  draftDirty,
  rulesDirty,
  run,
  mutate,
  mutateWithResult,
  mayLeaveDraft,
  changeAgreementTab,
  setBusy,
  setError,
  setNotice,
  setPreview,
  setEditing,
  setApprovedForPayout,
  setDraftDirty,
  setSource,
  setDocumentId,
  setExtraction,
}: AgreementTermsTabProps) {
  const isOrganizer =
    selected.value.members.find((m) => m.userId === user.id)?.role ===
    "ORGANIZER";
  // Collaborators see what they get and approve; drafting, sending and
  // proposing revised terms stay with the organizer.
  if (!isOrganizer)
    return (
      <div className="collab-terms">
        <CollaboratorTerms
          agreement={selected}
          version={latest}
          userId={user.id}
          base={base}
          busy={busy}
          justApproved={approvedForPayout === selected.id}
          onApprove={async () => {
            if (!latest) return;
            if (await mutateWithResult(`/versions/${latest.id}/approve`))
              setApprovedForPayout(selected.id);
          }}
          onRequestChange={async (reason) => {
            if (!latest) return;
            await mutate(`/versions/${latest.id}/request-change`, { reason });
          }}
          onOpenDocument={() => changeAgreementTab(AgreementTab.Document)}
          onPayoutDone={() => setApprovedForPayout("")}
        />
        {latest && (
          <ReviewDiscussion
            key={`${selected.id}:${latest.id}`}
            base={base}
            agreement={selected}
            version={latest}
            canWrite={
              workspaces.find((w) => w.id === workspace)?.role !== "VIEWER"
            }
            onDirtyChange={setDraftDirty}
          />
        )}
      </div>
    );
  return (
    <>
      {(editing || !latest) && (
        <Heading
          small
          title="Terms everyone can understand"
          description="AI suggests an interpretation. People agree on the rules. The engine calculates the money."
        />
      )}
      {!editing && latest ? (
        <div className="ag-terms">
          <div className="ag-terms-main">
            <div className="ag-section-head">
              <div>
                <div className="ag-title">
                  <h2 id="agreement-proposal-review" tabIndex={-1}>
                    Rules in v{latest.id}
                  </h2>
                  <span
                    className={`status-chip ${
                      latest.id === selected.value.activeVersionId ||
                      latest.status === "APPROVED"
                        ? "good"
                        : ""
                    }`}
                  >
                    {latest.id === selected.value.activeVersionId
                      ? "Active"
                      : title(latest.status)}
                  </span>
                </div>
                <p className="muted">
                  People agree on the rules; the engine calculates the money.
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setEditing(true);
                }}
              >
                Propose revised terms
              </Button>
            </div>
            <RuleSteps
              agreement={selected}
              rules={latest.rules}
              layout={RuleStepsLayout.Cards}
            />
            {latest.rules.source.excerpt && (
              <figure className="ag-source">
                <figcaption>
                  {latest.rules.source.origin === "HUMAN_PROPOSAL"
                    ? "Human proposal"
                    : "Source wording"}
                  {latest.rules.source.clause && (
                    <span className="clause-chip">
                      §{" "}
                      {latest.rules.source.clause.replace(
                        /^(clause|section)\s+/i,
                        "",
                      )}
                    </span>
                  )}
                </figcaption>
                <blockquote>{latest.rules.source.excerpt}</blockquote>
              </figure>
            )}
            <ContractReviewPanel
              key={latest.id}
              agreement={selected}
              version={latest}
              userId={user.id}
              busy={busy}
              onAction={async (action, payload) => {
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const committed = await mutateWithResult(
                    `/versions/${latest.id}/${action}`,
                    payload,
                  );
                  if (action === "approve" && committed)
                    setApprovedForPayout(selected.id);
                } finally {
                  setBusy(false);
                }
              }}
            />
            {approvedForPayout === selected.id && (
              <PostApprovalPayout
                base={base}
                onDone={() => setApprovedForPayout("")}
              />
            )}
            <ReviewDiscussion
              key={`${selected.id}:${latest.id}`}
              base={base}
              agreement={selected}
              version={latest}
              canWrite={
                workspaces.find((w) => w.id === workspace)?.role !== "VIEWER"
              }
              onDirtyChange={setDraftDirty}
            />
            <section className="section">
              <h3>Preview an incoming payment</h3>
              <p className="muted">
                Illustrative only. No payment or payout is created.
              </p>
              <PreviewForm
                busy={busy}
                onSubmit={(grossCents, feeCents) =>
                  run(async () =>
                    setPreview(
                      await api(
                        `${base}/versions/${latest.id}/preview`,
                        "POST",
                        { grossCents, feeCents },
                      ),
                    ),
                  )
                }
              />
              {preview && (
                <AllocationTable
                  allocations={preview.allocations}
                  agreement={selected}
                />
              )}
            </section>
          </div>
          <aside className="ag-terms-rail">
            <AgreementVersions agreement={selected} />
          </aside>
        </div>
      ) : (
        <>
          {editing && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (mayLeaveDraft()) setEditing(false);
              }}
            >
              Back to proposed terms
            </Button>
          )}
          <AgreementTermsFlow
            key={selected.id}
            documentId={documentId}
            openRules={rulesLanding && !!extraction}
            busy={busy}
            sourceText={source}
            source={
              <section className="panel">
                <h3>
                  {selected.value.versions.length
                    ? "Upload amended agreement"
                    : "Source agreement"}
                </h3>
                <ContractSourceGuidance
                  replacement={!!selected.value.versions.length}
                />
                <Field
                  label="Agreement text"
                  hint="Use synthetic or authorized documents only. Your document stays private."
                >
                  <textarea
                    rows={8}
                    disabled={busy}
                    value={source}
                    maxLength={40000}
                    onChange={(e) => {
                      if (
                        rulesDirty.current &&
                        !window.confirm(
                          "Changing the source resets your unsaved rules draft. Continue?",
                        )
                      )
                        return;
                      rulesDirty.current = false;
                      setDraftDirty(true);
                      setSource(e.target.value);
                      setDocumentId("");
                      setExtraction(null);
                    }}
                  />
                </Field>
                <div className="actions">
                  <label className="button secondary">
                    Choose PDF, DOCX or text file
                    <input
                      className="visually-hidden"
                      type="file"
                      disabled={busy}
                      accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(e) =>
                        run(async () => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (!f) return;
                          if (
                            draftDirty &&
                            !window.confirm(
                              "Replace your unsaved source and rules draft?",
                            )
                          )
                            return;
                          if (/\.(pdf|docx)$/i.test(f.name)) {
                            const isDocx = f.name
                              .toLowerCase()
                              .endsWith(".docx");
                            if (f.size > 5 * 1024 * 1024)
                              throw new Error(
                                "Document must be no larger than 5 MB.",
                              );
                            const data = await new Promise<string>(
                              (resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () =>
                                  resolve(String(reader.result).split(",")[1]);
                                reader.onerror = () =>
                                  reject(new Error("Unable to read file."));
                                reader.readAsDataURL(f);
                              },
                            );
                            const doc = await api(
                              `${base}/documents/${isDocx ? "docx" : "pdf"}`,
                              "POST",
                              {
                                mimeType: isDocx
                                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                  : "application/pdf",
                                base64: data,
                              },
                            );
                            const saved = await api(
                              `${base}/documents/${doc.documentId}`,
                            );
                            setSource(saved.text);
                            setDocumentId(doc.documentId);
                            setNotice(
                              "Your document is ready. Check the names and amounts against the original before sharing the terms.",
                            );
                          } else {
                            if (
                              !f.name.toLowerCase().endsWith(".txt") &&
                              f.type !== "text/plain"
                            )
                              throw new Error(
                                "Choose a PDF, DOCX or plain text file.",
                              );
                            if (f.size > 40000)
                              throw new Error(
                                "Text file is too large. Limit: 40 KB.",
                              );
                            setSource(await f.text());
                            setDocumentId("");
                          }
                          rulesDirty.current = false;
                          setExtraction(null);
                          setDraftDirty(!/\.(pdf|docx)$/i.test(f.name));
                        })
                      }
                    />
                  </label>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => {
                      if (!mayLeaveDraft()) return;
                      setDraftDirty(true);
                      setSource(sampleAgreement);
                      setDocumentId("");
                      setExtraction(null);
                    }}
                  >
                    Use sample text
                  </Button>
                  <Button
                    disabled={busy || !source.trim() || !!documentId}
                    onClick={() =>
                      run(async () => {
                        const doc = await api(`${base}/documents`, "POST", {
                          text: source,
                        });
                        setDocumentId(doc.documentId);
                        setDraftDirty(rulesDirty.current);
                        setNotice(
                          "Source saved. You can review rules manually or ask AI for suggestions.",
                        );
                      })
                    }
                  >
                    {documentId ? "Source saved" : "Save source"}
                  </Button>
                </div>
              </section>
            }
            interpretation={
              documentId ? (
                <AIReview
                  key={documentId}
                  busy={busy}
                  extraction={extraction}
                  onExtract={() =>
                    run(async () =>
                      setExtraction(
                        await api(
                          `${base}/documents/${documentId}/extract`,
                          "POST",
                          { consentToCloudflare: true },
                        ),
                      ),
                    )
                  }
                />
              ) : null
            }
            rules={
              documentId ? (
                <RulesEditor
                  onReviewPeople={() => changeAgreementTab(AgreementTab.People)}
                  extraction={extraction}
                  key={documentId}
                  agreement={selected}
                  source={source}
                  documentId={documentId}
                  busy={busy}
                  onDirty={() => {
                    rulesDirty.current = true;
                    setDraftDirty(true);
                  }}
                  onSave={(rules) =>
                    run(async () => {
                      await mutate("/versions", { rules });
                      setDraftDirty(false);
                      rulesDirty.current = false;
                      setPreview(null);
                      setEditing(false);
                      setNotice("New proposal saved. No rules were activated.");
                      requestAnimationFrame(() => {
                        const review = document.getElementById(
                          "agreement-proposal-review",
                        );
                        review?.focus({
                          preventScroll: true,
                        });
                        review?.scrollIntoView({
                          block: "start",
                          behavior: "auto",
                        });
                      });
                    })
                  }
                />
              ) : null
            }
          />
        </>
      )}
    </>
  );
}
