"use client";
import {useEmailDelivery} from '../lib/email-capability';
import { WorkspaceNameForm } from "./workspace-name-form";
import {useDisplayPreferences, NotificationsSettings, CurrencyDisplaySettings} from "./settings-preferences";
import {ProfileContact} from "./profile-contact";
import {PaymentAccountsSettings} from "./payment-account-settings";
import {ActivityLogSettings} from "./activity-log-settings";
import {formatDate} from "../lib/preferences";
import {LocalOcrChoice} from "./local-ocr-choice";
import { SandboxCheckoutForm } from "./sandbox-checkout-form";
import { ReviewDiscussion, ReviewReminder } from "./review-discussion";
import { RevenueRules } from "./revenue-rules";
import {
  Logo,
  Heading,
  Metric,
  SimpleForm,
  Auth,
  AgreementList,
  SplitTable,
  RevenueTable,
  AllocationTable,
  PreviewForm,
  PasswordForm,
  AIReview,
  RulesEditor,
  safePayPalUrl,
  payoutStatus,
} from "./agreement-widgets";
import { useEffect, useRef, useState } from "react";
import { AgreementTermsFlow } from "./agreement-terms-flow";
import { AgreementTabs } from "./agreement-tabs";
import {
  ApiError,
  AgreementTab,
  Section,
  api,
  money,
  parseCents,
  parseShare,
  title,
  sampleAgreement,
  type Agreement,
  type User,
  type Rules,
  type Revenue,
} from "../lib/model";
import { AgreementVersions } from "./agreement-versions";
import { AgreementDocument } from "./agreement-document";
import { ContractReviewPanel, ContractSourceGuidance } from "./contract-review-guidance";
import { AgreementName } from "./agreement-name";
import { AgreementIntake, type AgreementIntakeInput } from "./agreement-intake";
import { AgreementSetup } from "./agreement-setup";
import { AccessPrompt } from "./designer-auth";
import { PaymentRecovery } from "./payment-recovery";
import { MfaSettings } from "./mfa-settings";
import { ProfileForm } from "./profile-form";
import { recoverSourceDocument } from "../lib/source-recovery";
import dynamic from "next/dynamic";
const PaymentGrid = dynamic(
  () => import("../src/components/PaymentGrid").then((m) => m.PaymentGrid),
  { ssr: false, loading: () => <p>Loading payout history…</p> },
);
import { PaymentGridStatus } from "../src/components/paymentGridModel";
import { Badge, Button, Empty, Field, Icon, Notice } from "./ui";
const workspaceBase = (id: string) => `workspaces/${id}`;
export default function FairshareApp() {
  const emailDelivery = useEmailDelivery();
  const [settingsTab,setSettingsTab] = useState("Profile");
  const [useLocalOcr,setUseLocalOcr] = useState(false);
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useDisplayPreferences(user?.id);
  const [workspaces, setWorkspaces] = useState<any[]>([]),
    [workspace, setWorkspace] = useState(""),
    [agreements, setAgreements] = useState<Agreement[]>([]),
    [selected, setSelected] = useState<Agreement | null>(null),
    [section, setSection] = useState(Section.Overview),
    [tab, setTab] = useState(AgreementTab.Overview),
    [members, setMembers] = useState<any[]>([]),
    [payments, setPayments] = useState<any[]>([]),
    [payouts, setPayouts] = useState<any[]>([]),
    [mode, setMode] = useState("Unavailable");
  const [creating, setCreating] = useState(false),
    [source, setSource] = useState(""),
    [documentId, setDocumentId] = useState(""),
    [extraction, setExtraction] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [breakdown, setBreakdown] = useState<Revenue | null>(null),
    [inviteLink, setInviteLink] = useState(""),
    [flowToken, setFlowToken] = useState(""),
    [flowKind, setFlowKind] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const openRequest = useRef(0);
  const rulesDirty = useRef(false);
  function mayLeaveDraft() {
    if (busy) return false;
    if (draftDirty && !window.confirm("Discard unsaved agreement changes? Saved source documents and proposals will remain.")) return false;
    setDraftDirty(false);
    rulesDirty.current = false;
    return true;
  }
  function changeAgreementTab(next: AgreementTab) {
    if (next === tab || !mayLeaveDraft()) return;
    setTab(next);
    setBreakdown(null);
  }
  useEffect(() => {
    if (!draftDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftDirty]);
  const base = selected
    ? `${workspaceBase(selected.workspaceId)}/collaborations/${selected.id}`
    : "";
  const latest = selected?.value.versions.at(-1),
    active = selected?.value.versions.find(
      (v) => v.id === selected.value.activeVersionId,
    );
  const organizer =
    selected?.value.members.find((m) => m.userId === user?.id)?.role ===
    "ORGANIZER";
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function loadWorkspaces() {
    const r = await api("workspaces");
    setWorkspaces(r.workspaces);
    const id =
      workspace && r.workspaces.some((w: any) => w.id === workspace)
        ? workspace
        : r.workspaces[0]?.id || "";
    setWorkspace(id);
    return id;
  }
  async function acceptInvitation(token: string) {
    const result = await api("invitations/accept", "POST", { token });
    // Adopt the committed membership immediately. Do not make a consumed
    // one-use invitation look unsuccessful if a later workspace fetch fails.
    openRequest.current++;
    setSelected(null);
    setCreating(false);
    setAgreements([]);
    setMembers([]);
    setPayouts([]);
    setWorkspaces(current => [...current.filter(item => item.id !== result.workspace.id), result.workspace]);
    setWorkspace(result.workspace.id);
    setSection(Section.Agreements);
    setFlowToken("");
    history.replaceState(null, "", "/");
    setNotice("Workspace joined. The organizer must add you to the agreement before you can review and approve its rules.");
  }
  async function loadWorkspace(id: string) {
    if (!id) return;
    const [r, m] = await Promise.all([
      api(`${workspaceBase(id)}/collaborations`),
      api(`${workspaceBase(id)}/members`),
    ]);
    setAgreements(r.collaborations);
    setMembers(m.members);
    const all = await Promise.all(
      r.collaborations.map(async (a: Agreement) => {
        const p = await api(
          `${workspaceBase(id)}/collaborations/${a.id}/payouts`,
        );
        return p.payouts.map((v: any) => ({ ...v, agreement: a }));
      }),
    );
    setPayouts(all.flat());
  }
  async function openAgreement(a: Agreement) {
    const request = ++openRequest.current;
    const root = `${workspaceBase(a.workspaceId)}/collaborations/${a.id}`;
    const [fresh, p] = await Promise.all([
      api<Agreement>(root),
      api(`${root}/payments`),
    ]);
    if (request !== openRequest.current) return;
    setDraftDirty(false);
    rulesDirty.current = false;
    setTab(AgreementTab.Overview);
    setSelected(fresh);
    setPayments(p.payments);
    setSection(Section.Agreements);
    setCreating(false);
    setPreview(null);
    setBreakdown(null);
    setEditing(false);
    setSource("");
    setDocumentId("");
    setExtraction(null);
    const v = fresh.value.versions.at(-1);
    const doc = await recoverSourceDocument(root, v?.rules.source.documentId, api);
    if (request !== openRequest.current) return;
    if (doc) {
      setDocumentId(doc.documentId);
      setSource(doc.text);
      setExtraction(doc.extraction);
    }
  }
  async function createFromAgreement(input: AgreementIntakeInput) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("agreements/intake", "POST", {
        ...input,
        ...(workspace ? { workspaceId: workspace } : {}),
      });
      // Adopt the committed result before any optional refresh. A lost response
      // is safe to retry with the intake component's original request ID.
      setWorkspaces(current => [...current.filter(item => item.id !== result.workspace.id), {...current.find(item => item.id === result.workspace.id), ...result.workspace}]);
      setWorkspace(result.workspace.id);
      setAgreements(current => [result.agreement, ...current.filter(item => item.id !== result.agreement.id)]);
      openRequest.current++;
      setSelected(result.agreement);
      setCreating(false);
      setSection(Section.Agreements);
      setTab(AgreementTab.Terms);
      setSource(result.document.text);
      setDocumentId(result.document.documentId);
      setExtraction(null);
      setPayments([]);
      setDraftDirty(false);
      rulesDirty.current = false;
      setNotice("Agreement saved. Review the source, then request AI interpretation to suggest terms and a title.");
    } finally { setBusy(false); }
  }
  async function refresh() {
    await loadWorkspace(workspace);
    if (selected) {
      const a = await api<Agreement>(base);
      setSelected(a);
      const p = await api(`${base}/payments`);
      setPayments(p.payments);
    }
  }
  useEffect(() => {
    const token = location.hash.slice(1).replace(/^token=/, "");
    if (token && ["/verify-email", "/invitation"].includes(location.pathname)) {
      setFlowKind(location.pathname);
      setFlowToken(decodeURIComponent(token));
      // Keep the fragment until acceptance succeeds so refresh during sign-in
      // does not lose this one-use link. Fragments are not sent to the server.
    }
    Promise.all([
      api("auth/me")
        .then((r) => setUser(r.user))
        .catch(() => {}),
      api("health")
        .then((r) => setMode(r.mode))
        .catch(() => {}),
    ]).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (user)
      run(async () => {
        await loadWorkspaces();
      });
  }, [user?.id]);
  useEffect(() => {
    if (workspace && user) run(() => loadWorkspace(workspace));
  }, [workspace]);
  function navigate(s: Section) {
    if (!mayLeaveDraft()) return;
    openRequest.current++;
    setSection(s);
    setSelected(null);
    setCreating(false);
    setError("");
    setNotice("");
  }
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    try {
      const a = await api<Agreement>(base + action, "POST", {
        expectedRevision: selected!.revision,
        ...extra,
      });
      setSelected(a);
      await loadWorkspace(workspace);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") {
        const current = await api<Agreement>(base);
        setSelected(current);
        throw new Error("Agreement changed. Latest version loaded; review before trying again.");
      }
      throw cause;
    }
  }
  if (!ready)
    return (
      <main className="boot" aria-live="polite">
        <Logo />
        <p>Opening your workspace…</p>
      </main>
    );
  if (!user)
    return (
      <Auth
        busy={busy}
        error={error}
        onSubmit={(type, data) =>
          run(async () => {
            const r = await api(`auth/${type}`, "POST", data);
            setUser(r.user);
          })
        }
      />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Main navigation">
          {Object.values(Section).map((s) => (
            <button
              key={s}
              aria-current={section === s ? "page" : undefined}
              className={section === s ? "nav-item selected" : "nav-item"}
              onClick={() => navigate(s)}
            >
              <Icon name={s} />
              {s}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="environment">{mode} · no live money</span>
          <div className="identity">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small title={user.email}>{user.email}</small>
            </div>
          </div>
          <button
            className="text-button"
            onClick={() => {
              if (!mayLeaveDraft()) return;
              return run(async () => {
                await api("auth/logout", "POST", {});
                setUser(null);
                setWorkspace("");
                setSelected(null);
                setAgreements([]);
              });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <div className="workspace-bar">
          <span>Workspace</span>
          {workspaces.length > 1 ? <select
            aria-label="Workspace"
            value={workspace}
            onChange={(e) => {
              if (!mayLeaveDraft()) return;
              openRequest.current++;
              setSelected(null);
              setWorkspace(e.target.value);
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select> : <strong>{workspaces[0]?.name || "No workspace yet"}</strong>}
          <span className="spacer" />
          <Button variant="quiet" disabled={busy} onClick={() => run(refresh)}>
            ↻ Refresh
          </Button>
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
            {error.includes("Reload") && (
              <Button variant="quiet" onClick={() => run(refresh)}>
                Reload latest
              </Button>
            )}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <div className="progress" role="status">
            Working…
          </div>
        )}
        {flowToken && (
          <AccessPrompt kind={flowKind === "/verify-email" ? "verification" : "invitation"} email={user.email} busy={busy}
              onContinue={() =>
                run(async () => {
                  if (flowKind === "/verify-email") {
                    const r = await api("auth/verification/confirm", "POST", {
                      token: flowToken,
                    });
                    setUser(r.user);
                    setNotice(
                      r.verificationMode === "DEMO_SIMULATION"
                        ? "Demo verification completed. This does not prove email ownership."
                        : "Email verified.",
                    );
                  } else {
                    await acceptInvitation(flowToken);
                  }
                  setFlowToken("");
                  history.replaceState(null, "", "/");
                })
              }
          />
        )}
        {!workspace && section !== Section.Settings ? (
          <>
            {section === Section.Payouts && <Heading title="No payouts yet" description="Start with an agreement. Payouts appear after approved rules and recorded payments." />}
            <AgreementIntake first busy={busy} onCreate={createFromAgreement} />
            <p className="muted">Already invited? Open Settings to accept your workspace invitation.</p>
          </>
        ) : (
          <>
            {section === Section.Overview && !selected && (
              <>
                <Heading
                  title={`Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${user.name.split(" ")[0]}`}
                  description="Your agreements, and what needs your attention."
                  action={
                    <Button
                      onClick={() => {
                        setSection(Section.Agreements);
                        setCreating(true);
                      }}
                    >
                      + New agreement
                    </Button>
                  }
                />
                <div className="metrics">
                  <Metric
                    label="Agreements"
                    value={String(agreements.length)}
                  />
                  <Metric
                    label="Awaiting approvals"
                    value={String(
                      agreements.filter(
                        (a) =>
                          a.value.versions.at(-1)?.status ===
                          "AWAITING_APPROVAL",
                      ).length,
                    )}
                  />
                  <Metric
                    label="Payment holds"
                    value={String(
                      agreements.filter((a) => a.value.reviewHold).length,
                    )}
                  />
                </div>
                <AgreementList
                  agreements={agreements}
                  onOpen={(a) => run(() => openAgreement(a))}
                />
              </>
            )}
            {section === Section.Agreements && !selected && (
              <>
                <Heading
                  title={creating ? "Create an agreement" : "Agreements"}
                  description={
                    creating
                      ? "Bring the people, terms and money into one place."
                      : "Every agreement has a clear money trail."
                  }
                  action={
                    !creating && (
                      <Button onClick={() => setCreating(true)}>
                        + New agreement
                      </Button>
                    )
                  }
                />
                {creating ? (
                  <AgreementIntake busy={busy} onCancel={() => setCreating(false)} onCreate={createFromAgreement} />
                ) : (
                  <AgreementList agreements={agreements} onOpen={(a) => run(() => openAgreement(a))} />
                )}
              </>
            )}
            {selected && section === Section.Agreements && (
              <>
                <button
                  className="breadcrumb text-button"
                  onClick={() => navigate(Section.Agreements)}
                >
                  Agreements <span>/</span> {selected.value.name}
                </button>
                <Heading
                  title={selected.value.name}
                  badge={
                    <Badge
                      value={
                        selected.value.reviewHold
                          ? "REVIEW_REQUIRED"
                          : active
                            ? "ACTIVE"
                            : latest?.status || "DRAFT"
                      }
                    />
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => navigate(Section.Payouts)}
                    >
                      View payouts
                    </Button>
                  }
                />
                {organizer && <AgreementName key={`${selected.id}:${selected.value.name}:${extraction?.suggestedTitle || ""}`} name={selected.value.name} suggestion={extraction?.suggestedTitle} busy={busy} onSave={name => run(() => mutate("/name", {name}))} />}
                <AgreementSetup agreement={selected} tab={tab} onNavigate={changeAgreementTab} />
                <AgreementTabs value={tab} onChange={(next) => {
                  changeAgreementTab(next);
                }} />
                <div role="tabpanel" id="agreement-panel" aria-labelledby={`agreement-tab-${tab}`} tabIndex={0}>
                {selected.value.reviewHold && (
                  <Notice warning>
                    Payments need review. Allocations remain recorded; outgoing
                    payouts are paused. No automatic clawback is assumed.
                  </Notice>
                )}
                {tab === AgreementTab.Overview && (
                  <>
                    <div className="detail-columns">
                      <section className="panel">
                        {!active && <><h2>Revenue rules</h2><p className="muted">No active rules yet. Review and approve a version to begin.</p></>}
                        {active ? (
                          <RevenueRules key={`${selected.id}:${active.id}`}>
                            <SplitTable agreement={selected} rules={active.rules} />
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
                            Add your people, upload the agreement and review a
                            proposed split together.
                          </Empty>
                        )}
                        {active?.rules.advance && (
                          <section className="section">
                            <h2>Recoupment</h2>
                            <p>
                              {money(active.rules.advance.amountCents)} advance
                              to{" "}
                              {
                                selected.value.members.find(
                                  (m) =>
                                    m.userId ===
                                    active.rules.advance!.recipientId,
                                )?.displayName
                              }
                              .
                            </p>
                            <progress
                              max={active.rules.advance.amountCents || 1}
                              value={
                                selected.value.recoupedByAdvance[
                                  active.rules.advance.id
                                ] || 0
                              }
                            />
                            <p className="muted">
                              {money(
                                selected.value.recoupedByAdvance[
                                  active.rules.advance.id
                                ] || 0,
                              )}{" "}
                              allocated toward recoupment. This is not proof of
                              a completed payout.
                            </p>
                          </section>
                        )}
                      </section>
                      <aside className="panel">
                        <h2>Payout status</h2>
                        <p className="muted">
                          An allocation records who is owed what. A payout
                          records money sent to a recipient.
                        </p>
                        <p>
                          {
                            payouts.filter(
                              (p) => p.agreement.id === selected.id,
                            ).length
                          }{" "}
                          payout items recorded
                        </p>
                        <Button
                          variant="secondary"
                          onClick={() => navigate(Section.Payouts)}
                        >
                          Open payouts
                        </Button>
                      </aside>
                    </div>
                    <section className="section">
                      <h2>Incoming payments</h2>
                      <RevenueTable
                        agreement={selected}
                        onOpen={setBreakdown}
                      />
                    </section>
                    <section className="section">
                      <h2>Activity</h2>
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
                  </>
                )}
                {tab === AgreementTab.People && (
                  <>
                    <Heading
                      small
                      title="People in this agreement"
                      description="Add everyone before drafting rules. Each person approves their own account’s decision."
                    />
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Latest approval</th>
                          <th>Review reminder</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.value.members.map((m) => (
                          <tr key={m.userId}>
                            <td>
                              <span className="avatar small">
                                {m.displayName[0]}
                              </span>
                              {m.displayName}
                              {m.userId === user.id ? " (you)" : ""}
                            </td>
                            <td>{title(m.role)}</td>
                            <td>
                              <Badge
                                value={
                                  latest?.approvals[m.userId]
                                    ? "APPROVED"
                                    : "PENDING"
                                }
                              />
                            </td>
                            <td>{latest && <ReviewReminder key={`${selected.id}:${latest.id}:${m.userId}`} base={base} agreement={selected} version={latest} userId={user.id} recipientId={m.userId} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {organizer && !selected.value.versions.length && (
                      <section className="section">
                        <h3>Add an existing workspace member</h3>
                        {members
                          .filter(
                            (m) =>
                              !selected.value.members.some(
                                (s) => s.userId === m.id,
                              ),
                          )
                          .map((m) => (
                            <div className="row" key={m.id}>
                              <span>
                                {m.name} <small>{m.email}</small>
                              </span>
                              <Button
                                disabled={busy}
                                variant="secondary"
                                onClick={() =>
                                  run(() =>
                                    mutate("/members", { userId: m.id }),
                                  )
                                }
                              >
                                Add to agreement
                              </Button>
                            </div>
                          ))}
                        {workspaces.find(w => w.id === workspace)?.role === "OWNER" && <PrivateInvitation key={workspace} workspace={workspace} />}
                      </section>
                    )}
                    <section className="section">
                      <h3>Your payout destination</h3>
                      <p className="muted">
                        Only you can set your destination. This is a PayPal
                        sandbox merchant ID, not an email.
                      </p>
                      <SimpleForm
                        label="Your sandbox PayPal recipient ID"
                        button="Save destination"
                        busy={busy}
                        onSubmit={(paypalId) =>
                          run(async () => {
                            await api(`${base}/recipient`, "PUT", { paypalId });
                            setNotice(
                              "Your sandbox payout destination was saved.",
                            );
                          })
                        }
                      />
                    </section>
                  </>
                )}
                {tab === AgreementTab.Terms && (
                  <>
                    <Heading
                      small
                      title="Terms everyone can understand"
                      description="AI suggests an interpretation. People agree on the rules. The engine calculates the money."
                    />
                    {!editing && latest ? (
                      <>
                        <div className="row">
                          <h3 id="agreement-proposal-review" tabIndex={-1}>Version {latest.id}</h3>
                          <Badge value={latest.status} />
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => { setPreview(null); setEditing(true); }}
                          >
                            Propose revised terms
                          </Button>
                        </div>
                        <SplitTable agreement={selected} rules={latest.rules} />
                        <Notice>
                          Fee policy:{" "}
                          {latest.rules.feePolicy === "BEFORE_SPLIT"
                            ? "Fees deducted before the split"
                            : "Organizer covers fees from their share"}
                          .{" "}
                          {latest.rules.source.origin === "HUMAN_PROPOSAL"
                            ? "These terms include a human proposal."
                            : "These terms cite a source clause."}
                        </Notice>
                        <blockquote>
                          {latest.rules.source.excerpt}
                          <footer>{latest.rules.source.clause}</footer>
                        </blockquote>
                        <ContractReviewPanel key={latest.id} agreement={selected} version={latest} userId={user.id} busy={busy} onAction={async (action, payload) => {
                          setBusy(true); setError(""); setNotice("");
                          try { await mutate(`/versions/${latest.id}/${action}`, payload); }
                          finally { setBusy(false); }
                        }} />
                        <ReviewDiscussion key={`${selected.id}:${latest.id}`} base={base} agreement={selected} version={latest} canWrite={workspaces.find(w=>w.id===workspace)?.role !== "VIEWER"} onDirtyChange={setDraftDirty} />
                        <AgreementVersions agreement={selected} />
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
                      </>
                    ) : (
                      <>
                        {editing && <Button variant="secondary" disabled={busy} onClick={() => { if (mayLeaveDraft()) setEditing(false); }}>Back to proposed terms</Button>}
                        <AgreementTermsFlow key={selected.id} documentId={documentId} busy={busy} sourceText={source}
                          source={<section className="panel">
                          <h3>{selected.value.versions.length ? "Upload amended agreement" : "Source agreement"}</h3>
                          <ContractSourceGuidance replacement={!!selected.value.versions.length} />
                          <Field
                            label="Agreement text"
                            hint="Use synthetic or authorized documents only. Text is stored privately in this workspace."
                          >
                            <textarea
                              rows={8}
                              disabled={busy}
                              value={source}
                              maxLength={40000}
                              onChange={(e) => {
                                if (rulesDirty.current && !window.confirm("Changing the source resets your unsaved rules draft. Continue?")) return;
                                rulesDirty.current = false;
                                setDraftDirty(true);
                                setSource(e.target.value);
                                setDocumentId("");
                                setExtraction(null);
                              }}
                            />
                          </Field>
                          <LocalOcrChoice base={base} value={useLocalOcr} onChange={setUseLocalOcr} disabled={busy} />
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
                                    if (draftDirty && !window.confirm("Replace your unsaved source and rules draft?")) return;
                                    if (/\.(pdf|docx)$/i.test(f.name)) {
                                      const isDocx = f.name.toLowerCase().endsWith(".docx");
                                      if (f.size > 5 * 1024 * 1024)
                                        throw new Error(
                                          "Document must be no larger than 5 MB.",
                                        );
                                      const data = await new Promise<string>(
                                        (resolve, reject) => {
                                          const reader = new FileReader();
                                          reader.onload = () =>
                                            resolve(
                                              String(reader.result).split(
                                                ",",
                                              )[1],
                                            );
                                          reader.onerror = () =>
                                            reject(
                                              new Error("Unable to read file."),
                                            );
                                          reader.readAsDataURL(f);
                                        },
                                      );
                                      const doc = await api(
                                        `${base}/documents/${isDocx ? "docx" : "pdf"}`,
                                        "POST",
                                        {
                                          mimeType: isDocx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
                                          base64: data,
                                          ...(!isDocx && useLocalOcr ? {useLocalOcr:true} : {}),
                                        },
                                      );
                                      const saved = await api(
                                        `${base}/documents/${doc.documentId}`,
                                      );
                                      setSource(saved.text);
                                      setDocumentId(doc.documentId);
                                      setNotice(
                                        "Document text extracted locally. Review every amount and name against the saved original before AI processing; OCR can misread characters.",
                                      );
                                    } else {
                                      if (!f.name.toLowerCase().endsWith(".txt") && f.type !== "text/plain") throw new Error("Choose a PDF, DOCX or plain text file.");
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
                                  const doc = await api(
                                    `${base}/documents`,
                                    "POST",
                                    { text: source },
                                  );
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
                        </section>}
                          interpretation={documentId ? <AIReview key={documentId}
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
                            /> : null}
                          rules={documentId ? <RulesEditor
                              onReviewPeople={() => changeAgreementTab(AgreementTab.People)}
                              extraction={extraction}
                              key={documentId}
                              agreement={selected}
                              source={source}
                              documentId={documentId}
                              busy={busy}
                              onDirty={() => { rulesDirty.current = true; setDraftDirty(true); }}
                              onSave={(rules) =>
                                run(async () => {
                                  await mutate("/versions", { rules });
                                  setDraftDirty(false);
                                  rulesDirty.current = false;
                                  setPreview(null);
                                  setEditing(false);
                                  setNotice(
                                    "New proposal saved. No rules were activated.",
                                  );
                                  requestAnimationFrame(() => {
                                    const review = document.getElementById("agreement-proposal-review");
                                    review?.focus({ preventScroll: true });
                                    review?.scrollIntoView({ block: "start", behavior: "auto" });
                                  });
                                })
                              }
                            /> : null}
                        />
                      </>
                    )}
                  </>
                )}
                {tab === AgreementTab.Document && <AgreementDocument key={selected.id} agreement={selected} base={base} />}
                {tab === AgreementTab.Payments && (
                  <>
                    <Heading
                      small
                      title="Incoming payments"
                      description="Confirmed provider data is used to calculate each allocation. Browser returns are not proof of payment."
                    />
                    {organizer && active && (
                      <SandboxCheckoutForm key={selected.id}
                        busy={busy}
                        onSubmit={(amount, source) =>
                          run(async () => {
                            const amountCents = parseCents(amount);
                            const storageKey = `fairshare-checkout:${user.id}:${selected.id}:${amountCents}`;
                            const requestKey =
                              sessionStorage.getItem(storageKey) ||
                              crypto.randomUUID();
                            sessionStorage.setItem(storageKey, requestKey);
                            const r = await api(`${base}/payments`, "POST", {
                              requestKey,
                              amountCents,
                              source,
                            });
                            // Preserve uncertain requests across refreshes; never blindly issue a new provider write.
                            if (r.approval_url)
                              sessionStorage.removeItem(storageKey);
                            await refresh();
                            setNotice(
                              r.approval_url
                                ? "Sandbox checkout created. Use the approval link below."
                                : "Payment request recorded. Check its status before trying again.",
                            );
                          })
                        }
                      />
                    )}
                    <table>
                      <thead>
                        <tr>
                          <th>Payment</th>
                          <th>Source label</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <code>{p.id.slice(0, 8)}</code>
                            </td>
                            <td>{p.source_name || "PayPal"}</td>
                            <td>{money(p.amount)}</td>
                            <td>
                              <Badge value={p.status} />
                            </td>
                            <td>
                              <div className="actions">
                                {p.approval_url &&
                                  safePayPalUrl(p.approval_url) && (
                                    <a
                                      href={p.approval_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Open PayPal sandbox ↗
                                    </a>
                                  )}
                                {organizer && p.status === "AWAITING_BUYER" && (
                                  <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `${base}/payments/${p.id}/capture`,
                                          "POST",
                                          {},
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    Confirm approved payment
                                  </Button>
                                )}
                                {organizer && (
                                  <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await api(
                                          `${base}/payments/${p.id}/reconcile`,
                                          "POST",
                                          {},
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    Check status
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!payments.length && (
                      <Empty title="No incoming payments yet">
                        An active, unanimously approved version and a configured
                        sandbox provider are required.
                      </Empty>
                    )}
                    {organizer && <PaymentRecovery key={base} base={base} payments={payments} payouts={payouts} held={!!selected.value.reviewHold} refresh={refresh} />}
                    <section className="section">
                      <h3>Verified allocations</h3>
                      <RevenueTable
                        agreement={selected}
                        onOpen={setBreakdown}
                      />
                    </section>
                  </>
                )}
                {breakdown && (
                  <section className="panel breakdown">
                    <div className="row">
                      <h2>How this payment was allocated</h2>
                      <Button
                        variant="quiet"
                        onClick={() => setBreakdown(null)}
                      >
                        Close
                      </Button>
                    </div>
                    <p>
                      Gross {money(breakdown.grossCents)} − fees{" "}
                      {money(breakdown.feeCents)} = {money(breakdown.netCents)}{" "}
                      available.
                    </p>
                    <AllocationTable
                      allocations={breakdown.allocations}
                      agreement={selected}
                    />
                    <p className="muted">
                      Applied version {breakdown.versionId}. Recoupment is
                      included in each recipient’s total. An allocation is not
                      proof of payout.
                    </p>
                    <blockquote>
                      {
                        selected.value.versions.find(
                          (v) => v.id === breakdown.versionId,
                        )?.rules.source.excerpt
                      }
                    </blockquote>
                    {organizer && (
                      <Button
                        disabled={busy || selected.value.reviewHold}
                        onClick={() =>
                          run(async () => {
                            await api(`${base}/payouts/dispatch`, "POST", {
                              captureId: breakdown.providerCaptureId,
                            });
                            await refresh();
                            setNotice(
                              "Sandbox payout dispatch recorded. Check each item’s status; submission does not mean completion.",
                            );
                          })
                        }
                      >
                        Send fixed allocations in sandbox
                      </Button>
                    )}
                    <p className="muted">
                      Technical sandbox dispatch, not a vote on the shares.
                      Automatic scheduling is not enabled yet.
                    </p>
                  </section>
                )}
                </div>
              </>
            )}
            {section === Section.Payouts && !selected && (
              <>
                <PaymentGrid
                  title="Payouts"
                  description="Track money going to people, across all your agreements."
                  emptyActions={<Button variant="secondary" onClick={() => navigate(Section.Agreements)}>View agreements</Button>}
                  loading={busy}
                  rows={payouts.map((p) => ({
                    id: p.id,
                    agreementId: p.agreement.id,
                    agreementName: p.agreement.value.name,
                    recipientName:
                      p.agreement.value.members.find(
                        (m: any) => m.userId === p.user_id,
                      )?.displayName || "Recipient",
                    amountCents: p.amount,
                    currency: "USD",
                    status: payoutStatus(p.status),
                    providerReference: p.item_id || p.batch_id || undefined,
                  }))}
                  onOpenAgreement={(id) => {
                    const a = agreements.find((a) => a.id === id);
                    if (a) run(() => openAgreement(a));
                  }}
                />
                {payouts.length > 0 && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        for (const p of payouts.filter(
                          (p) =>
                            p.agreement.value.members.find(
                              (m: any) => m.userId === user.id,
                            )?.role === "ORGANIZER" && p.batch_id,
                        )) {
                          await api(
                            `${workspaceBase(workspace)}/collaborations/${p.agreement.id}/payouts/${p.id}/reconcile`,
                            "POST",
                            {},
                          );
                        }
                        await loadWorkspace(workspace);
                      })
                    }
                  >
                    Refresh provider statuses
                  </Button>
                )}
              </>
            )}
            {section === Section.Settings && !selected && (
              <>
                <Heading
                  title="Settings"
                  description="Your account and test environment."
                />
                <nav className="settings-tabs" aria-label="Settings sections">
                  {["Profile", "Payment accounts", "Notifications", "Currency & display", "Activity log"].map(tab => <Button key={tab} variant={settingsTab===tab?"primary":"secondary"} aria-pressed={settingsTab===tab} onClick={()=>setSettingsTab(tab)}>{tab}</Button>)}
                </nav>
                {settingsTab === "Payment accounts" && (workspace ? <PaymentAccountsSettings key={workspace} workspace={workspace} canEdit={workspaces.find(w=>w.id===workspace)?.role!=="VIEWER"} /> : <Empty title="Start an agreement first">Payment accounts are scoped to a workspace. Create your first agreement to set up a payout destination.</Empty>)}
                {settingsTab === "Notifications" && <NotificationsSettings key={user.id} />}
                {settingsTab === "Currency & display" && <CurrencyDisplaySettings key={user.id} />}
                {settingsTab === "Activity log" && <ActivityLogSettings key={`${user.id}:${workspace}`} workspace={workspace} />}
                {settingsTab === "Profile" && <div className="settings-grid">
                  <section className="panel settings-profile">
                    <span className="eyebrow">PROFILE</span>
                    <ProfileContact key={user.id} name={user.name} email={user.email}/>
                    <ProfileForm key={user.id} name={user.name} busy={busy} onSave={async name => {
                      const result = await api("auth/profile", "POST", {name});
                      setUser(result.user);
                      setNotice("Display name saved. Existing agreement names are unchanged.");
                    }} />
                    <p className="muted">
                      Current environment: {mode}. Live money is disabled.
                    </p>
                    {emailDelivery && <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await api(
                            "auth/verification/request",
                            "POST",
                            {},
                          );
                          setNotice(
                            r.notice ||
                              "Verification email requested. Check your inbox.",
                          );
                          if (r.demoVerificationLink)
                            setInviteLink(r.demoVerificationLink);
                        })
                      }
                    >
                      Verify email
                    </Button>}
                    {inviteLink && (
                      <a className="block-link" href={inviteLink}>
                        Open demo verification/invitation link
                      </a>
                    )}
                  </section>
                  <section className="panel"><h2>Security</h2><p className="muted">Changing your password signs you out so you can reconnect securely.</p>
                  <PasswordForm
                    busy={busy}
                    onSubmit={(currentPassword, newPassword) =>
                      run(async () => {
                        await api("auth/password", "POST", {
                          currentPassword,
                          newPassword,
                        });
                        setUser(null);
                        setWorkspace("");
                      })
                    }
                  />
                  </section>
                  {workspaces.find(w => w.id === workspace)?.role === "OWNER" && <section className="panel"><h2>Workspace</h2><p className="muted">Rename your workspace without changing its agreements or access.</p><WorkspaceNameForm key={workspace} name={workspaces.find(w => w.id === workspace)?.name ?? ""} busy={busy} onSave={name => run(async () => {
                    const result = await api(`${workspaceBase(workspace)}/name`, "POST", { name });
                    setWorkspaces(current => current.map(item => item.id === workspace ? {...item, name: result.workspace.name} : item));
                    setNotice("Workspace name updated.");
                  })} /></section>}
                  <MfaSettings onSignOut={() => {setUser(null);setWorkspace("");}} />
                  <section className="panel"><h2>Workspace invitations</h2>{workspaces.find(w => w.id === workspace)?.role === "OWNER" && <PrivateInvitation key={workspace} workspace={workspace} />}<p className="muted">Join a workspace using a private invitation shared with your account.</p>
                  <SimpleForm
                    label="Invitation token (if shared manually)"
                    button="Accept invitation"
                    busy={busy}
                    onSubmit={(token) =>
                      run(async () => {
                        await acceptInvitation(token);
                      })
                    }
                  />
                  </section>
                </div>}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}


function PrivateInvitation({workspace}: {workspace:string}) {
  const [invitation, setInvitation] = useState<{id:string;token:string;expiresAt:number}|null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const link = invitation ? `${location.origin}/invitation#token=${encodeURIComponent(invitation.token)}` : "";
  async function act(action:()=>Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setMessage("");
    try {await action();} catch(error) {setMessage(error instanceof Error ? error.message : "Please try again.");}
    finally {pending.current = false;setBusy(false);}
  }
  return <section className="section">
    <h3>Invite a collaborator</h3>
    <p className="muted">Anyone holding this private link can join this workspace once as a member after signing in. Share it only with your intended collaborator. No email is sent, and joining does not approve an agreement or move money.</p>
    {!invitation ? <Button disabled={busy} onClick={()=>act(async()=>{
      const result=await api(`${workspaceBase(workspace)}/invitation-links`, "POST", {role:"MEMBER"});
      setInvitation(result.invitation);
    })}>Create private invitation link</Button> : <>
      <label>Private invitation link<input readOnly aria-label="Private invitation link" value={link} onFocus={event=>event.target.select()} /></label>
      <p className="muted">Expires {new Date(invitation.expiresAt).toLocaleString()}. Copy it now; it is not stored in your browser.</p>
      <Button disabled={busy} onClick={()=>act(async()=>{
        if (!navigator.clipboard) {setMessage("Select the link above and copy it manually.");return;}
        await navigator.clipboard.writeText(link);setMessage("Invitation link copied.");
      })}>Copy link</Button>
      <Button variant="secondary" disabled={busy} onClick={()=>act(async()=>{
        await api(`${workspaceBase(workspace)}/invitations/${invitation.id}`, "DELETE");
        setInvitation(null);setMessage("Invitation revoked. You can create a new one.");
      })}>Revoke link</Button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
