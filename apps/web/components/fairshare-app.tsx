"use client";
import { AgreementPeople } from "./agreement-people";
import {
  AgreementInvitation,
  AgreementInvitationPreview,
  AGREEMENT_INVITE_PREFIX,
} from "./agreement-invitation";
import { PostApprovalPayout } from "./post-approval-payout";

import { OverviewDashboard } from "./overview-dashboard";
import { PlusIcon } from "./icons";
import { AgreementAllocations } from "./agreement-allocations";
import { Avatar } from "./person";
import { toneForId } from "../lib/person";
import { allocationTrace } from "../lib/allocation-trace";
import { NotificationPanel } from "./notification-panel";
import { useEmailDelivery } from "../lib/email-capability";
import {
  useDisplayPreferences,
  NotificationsSettings,
  CurrencyDisplaySettings,
  SettingsPaneHeader,
  SettingsRow,
} from "./settings-preferences";
import { ProfileContact } from "./profile-contact";
import { PaymentAccountsSettings } from "./payment-account-settings";
import { ActivityLogSettings } from "./activity-log-settings";
import { formatDate } from "../lib/preferences";
import { ReviewDiscussion } from "./review-discussion";
import { AgreementInvoices } from "./agreement-invoices";
import { RevenueRules } from "./revenue-rules";
import {
  AgreementHeader,
  MoneyCard,
  RecoupmentCard,
  RuleSteps,
  RuleStepsLayout,
} from "./agreement-workspace";
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
import {
  ContractReviewPanel,
  ContractSourceGuidance,
} from "./contract-review-guidance";
import { AgreementName } from "./agreement-name";
import { AgreementCreationWizard } from "./agreement-creation-wizard";
import { AgreementIntake, type AgreementIntakeInput } from "./agreement-intake";
import { AccessPrompt } from "./designer-auth";
import { PaymentRecovery } from "./payment-recovery";
import { MfaSettings } from "./mfa-settings";
import { PasswordRow, ProfileForm } from "./profile-form";
import { recoverSourceDocument } from "../lib/source-recovery";
import { AgreementSetup } from "./agreement-setup";
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
  const [settingsTab, setSettingsTab] = useState("Profile");
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
  const [creationAgreementId, setCreationAgreementId] = useState("");
  const [creating, setCreating] = useState(false),
    [source, setSource] = useState(""),
    [documentId, setDocumentId] = useState(""),
    [extraction, setExtraction] = useState<any>(null),
    [editing, setEditing] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [breakdown, setBreakdown] = useState<Revenue | null>(null),
    [inviteLink, setInviteLink] = useState(""),
    [approvedForPayout, setApprovedForPayout] = useState(""),
    [flowToken, setFlowToken] = useState(""),
    [flowKind, setFlowKind] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const openRequest = useRef(0);
  const listRequest = useRef(0);
  const rulesDirty = useRef(false);
  function mayLeaveDraft() {
    if (busy) return false;
    if (
      draftDirty &&
      !window.confirm(
        "Discard unsaved agreement changes? Saved source documents and proposals will remain.",
      )
    )
      return false;
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
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
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
  const workspaceRole = workspaces.find((item) => item.id === workspace)?.role;
  const creationWorkspace =
    workspaces.find(
      (item) =>
        item.id === workspace &&
        (item.role === "OWNER" || item.role === "MEMBER"),
    ) ??
    workspaces.find((item) => item.role === "OWNER" || item.role === "MEMBER");
  const canCreateAgreement = Boolean(creationWorkspace);
  const isInvitationFlow = Boolean(flowToken && flowKind === "/invitation");
  const needsWorkspace = !workspace && section !== Section.Settings;
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
    const scoped = token.startsWith(AGREEMENT_INVITE_PREFIX);
    const result = await api(
      scoped ? "agreement-invitations/accept" : "invitations/accept",
      "POST",
      { token: scoped ? token.slice(AGREEMENT_INVITE_PREFIX.length) : token },
    );
    // Adopt the committed membership immediately. Do not make a consumed
    // one-use invitation look unsuccessful if a later workspace fetch fails.
    openRequest.current++;
    setSelected(null);
    setPayments([]);
    setPreview(null);
    setBreakdown(null);
    setEditing(false);
    setSource("");
    setDocumentId("");
    setExtraction(null);
    setDraftDirty(false);
    rulesDirty.current = false;
    setCreating(false);
    setAgreements([]);
    setMembers([]);
    setPayouts([]);
    setWorkspaces((current) => [
      ...current.filter((item) => item.id !== result.workspace.id),
      result.workspace,
    ]);
    setWorkspace(result.workspace.id);
    setSection(Section.Agreements);
    setFlowToken("");
    history.replaceState(null, "", "/app");
    if (result.agreement) {
      setAgreements([result.agreement]);
      setSelected(result.agreement);
      setTab(AgreementTab.People);
      setNotice(
        "You joined this agreement. Joining has not approved any rules or moved money.",
      );
      if (workspace === result.workspace.id) {
        try {
          await loadWorkspace(result.workspace.id);
        } catch {
          setNotice(
            "You joined this agreement. Refresh to see all your agreements.",
          );
        }
      }
    } else
      setNotice(
        "Invitation accepted. The organizer still needs to add you to an agreement before you can review its rules.",
      );
  }
  async function loadWorkspace(id: string) {
    if (!id) return;
    const request = ++listRequest.current;
    const [groups, m] = await Promise.all([
      api("workspaces"),
      api(`${workspaceBase(id)}/members`),
    ]);
    const lists = await Promise.all(
      groups.workspaces.map((group: any) =>
        api(`${workspaceBase(group.id)}/collaborations`),
      ),
    );
    const visibleAgreements: Agreement[] = lists.flatMap(
      (list) => list.collaborations,
    );
    const all = await Promise.all(
      visibleAgreements.map(async (a: Agreement) => {
        const p = await api(
          `${workspaceBase(a.workspaceId)}/collaborations/${a.id}/payouts`,
        );
        return p.payouts.map((v: any) => ({ ...v, agreement: a }));
      }),
    );
    if (request !== listRequest.current) return;
    setWorkspaces(groups.workspaces);
    setAgreements(visibleAgreements);
    setMembers(m.members);
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
    setWorkspace(fresh.workspaceId);
    setSelected(fresh);
    setCreationAgreementId(
      !fresh.value.versions.length &&
        sessionStorage.getItem(`fairshare:creation:${fresh.id}`)
        ? fresh.id
        : "",
    );
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
    const doc = await recoverSourceDocument(
      root,
      v?.rules.source.documentId,
      api,
    );
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
        ...(creationWorkspace ? { workspaceId: creationWorkspace.id } : {}),
      });
      // Adopt the committed result before any optional refresh. A lost response
      // is safe to retry with the intake component's original request ID.
      setWorkspaces((current) => [
        ...current.filter((item) => item.id !== result.workspace.id),
        {
          ...current.find((item) => item.id === result.workspace.id),
          ...result.workspace,
        },
      ]);
      setWorkspace(result.workspace.id);
      setAgreements((current) => [
        result.agreement,
        ...current.filter((item) => item.id !== result.agreement.id),
      ]);
      openRequest.current++;
      setSelected(result.agreement);
      setCreationAgreementId(result.agreement.id);
      sessionStorage.setItem(
        `fairshare:creation:${result.agreement.id}`,
        "pending",
      );
      // Member refresh must not make a committed upload appear to fail.
      api(`${workspaceBase(result.workspace.id)}/members`)
        .then((result) => setMembers(result.members))
        .catch(() => setMembers([]));
      setCreating(false);
      setSection(Section.Agreements);
      setTab(AgreementTab.Terms);
      setSource(result.document.text);
      setDocumentId(result.document.documentId);
      setExtraction(null);
      setPayments([]);
      setDraftDirty(false);
      rulesDirty.current = false;
      setNotice(
        "Agreement saved. Review the source, then request AI interpretation to suggest terms and a title.",
      );
    } finally {
      setBusy(false);
    }
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
    // Invitation and verification routes retain their fragments through sign-in.
    // Only ordinary app/auth entry points change URL with the session state.
    if (ready && ["/app", "/login"].includes(location.pathname)) {
      history.replaceState(null, "", user ? "/app" : "/login");
    }
  }, [ready, user]);
  useEffect(() => {
    if (!ready) return;
    document.title =
      flowKind === "/invitation"
        ? "Invitation · Fairshare"
        : flowKind === "/verify-email"
          ? "Verify email · Fairshare"
          : user
            ? `${section} · Fairshare`
            : "Log in · Fairshare";
  }, [ready, user, section, flowKind]);
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
    if (!mayLeaveDraft()) return false;
    openRequest.current++;
    setSection(s);
    setSelected(null);
    setCreating(false);
    setError("");
    setNotice("");
    return true;
  }
  function dismissAccessFlow() {
    setFlowToken("");
    setError("");
    history.replaceState(null, "", "/app");
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
        throw new Error(
          "Agreement changed. Latest version loaded; review before trying again.",
        );
      }
      throw cause;
    }
  }
  if (!ready)
    return (
      <main className="boot" aria-live="polite">
        <Logo />
        <p>Opening your agreements…</p>
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
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
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
          <span className="environment">
            <span className="environment-dot" aria-hidden="true" />
            {title(mode)} · no live money
          </span>
          <div className="identity">
            <Avatar name={user.name} tone={toneForId(user.id)} />
            <div>
              <strong>{user.name}</strong>
              <small title={user.email}>{user.email}</small>
            </div>
          </div>
          <button
            className="text-button sign-out"
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
          <span>Agreement</span>
          {agreements.length ? (
            <select
              aria-label="Open agreement"
              value={selected?.id ?? ""}
              disabled={busy}
              onChange={(e) => {
                const agreement = agreements.find(
                  (item) => item.id === e.target.value,
                );
                if (!agreement || !mayLeaveDraft()) return;
                void run(() => openAgreement(agreement));
              }}
            >
              <option value="" disabled>
                Choose an agreement
              </option>
              {agreements.map((agreement) => (
                <option key={agreement.id} value={agreement.id}>
                  {agreement.value.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>Your agreements</strong>
          )}
          <span className="spacer" />
          <NotificationPanel
            key={user.id}
            agreementIds={agreements.map((agreement) => agreement.id)}
            onOpenAgreement={(id) => {
              const agreement = agreements.find((item) => item.id === id);
              if (!agreement || !mayLeaveDraft()) return false;
              void run(() => openAgreement(agreement));
              return true;
            }}
            onPreferences={() => {
              if (!navigate(Section.Settings)) return false;
              setSettingsTab("Notifications");
              return true;
            }}
          />
          <button
            type="button"
            className={`icon-button${busy ? " is-spinning" : ""}`}
            disabled={busy}
            onClick={() => run(refresh)}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
            </svg>
          </button>
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
        {flowToken && flowToken.startsWith(AGREEMENT_INVITE_PREFIX) ? (
          <AgreementInvitationPreview
            email={user.email}
            token={flowToken.slice(AGREEMENT_INVITE_PREFIX.length)}
            busy={busy}
            onCancel={dismissAccessFlow}
            onAccept={() => run(() => acceptInvitation(flowToken))}
          />
        ) : (
          flowToken && (
            <AccessPrompt
              kind={
                flowKind === "/verify-email" ? "verification" : "invitation"
              }
              email={user.email}
              busy={busy}
              onCancel={isInvitationFlow ? dismissAccessFlow : undefined}
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
                  history.replaceState(null, "", "/app");
                })
              }
            />
          )
        )}
        {isInvitationFlow ? null : needsWorkspace ? (
          section === Section.Payouts ? (
            <Heading
              title="No payouts yet"
              description="Payouts appear here after a received payment is allocated and payout dispatch is recorded."
              action={
                <Button onClick={() => navigate(Section.Agreements)}>
                  Create an agreement
                </Button>
              }
            />
          ) : (
            <>
              <AgreementIntake
                first
                busy={busy}
                onCreate={createFromAgreement}
              />
              <p className="muted">
                Already invited? Open Settings to accept your invitation.
              </p>
            </>
          )
        ) : (
          <>
            {section === Section.Overview && !selected && (
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
            )}
            {section === Section.Agreements && !selected && (
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
            )}
            {selected && section === Section.Agreements && (
              <>
                {creationAgreementId === selected.id &&
                !selected.value.versions.length ? (
                  <AgreementCreationWizard
                    key={selected.id}
                    agreement={selected}
                    source={source}
                    members={members}
                    userId={user.id}
                    invitation={
                      workspaces.find((w) => w.id === workspace)?.role ===
                      "OWNER" ? (
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
                      sessionStorage.removeItem(
                        `fairshare:creation:${selected.id}`,
                      );
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
                          Payments need review. Allocations remain recorded;
                          outgoing payouts are paused. No automatic clawback is
                          assumed.
                        </Notice>
                      )}
                      {tab === AgreementTab.Overview && (
                        <>
                          <div className="detail-columns ag-overview">
                            <div className="ag-stack">
                              <section className="panel ag-card">
                                {!active && (
                                  <>
                                    <h2>Revenue rules</h2>
                                    <p className="muted">
                                      No active rules yet. Review and approve a
                                      version to begin.
                                    </p>
                                  </>
                                )}
                                {active ? (
                                  <RevenueRules
                                    key={`${selected.id}:${active.id}`}
                                  >
                                    <RuleSteps
                                      agreement={selected}
                                      rules={active.rules}
                                    />
                                  </RevenueRules>
                                ) : (
                                  <Empty
                                    title="Agree on the rules first"
                                    action={
                                      <Button
                                        onClick={() =>
                                          changeAgreementTab(AgreementTab.Terms)
                                        }
                                      >
                                        Set up terms
                                      </Button>
                                    }
                                  >
                                    Add your people, upload the agreement and
                                    review a proposed split together.
                                  </Empty>
                                )}
                              </section>
                              {active?.rules.advance && (
                                <RecoupmentCard
                                  agreement={selected}
                                  rules={active.rules}
                                >
                                  <p className="muted ag-fine">
                                    {money(
                                      selected.value.recoupedByAdvance[
                                        active.rules.advance.id
                                      ] || 0,
                                    )}{" "}
                                    allocated toward recoupment. This is not
                                    proof of a completed payout.
                                  </p>
                                </RecoupmentCard>
                              )}
                              <section className="panel ag-card ag-payments-card">
                                <div className="ag-card-head">
                                  <h2>Recent payments</h2>
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() =>
                                      changeAgreementTab(AgreementTab.Payments)
                                    }
                                  >
                                    View all payments →
                                  </button>
                                </div>
                                <RevenueTable
                                  agreement={selected}
                                  onOpen={setBreakdown}
                                />
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
                                  p.agreement.workspaceId ===
                                    selected.workspaceId,
                              )}
                              footer={
                                <div className="ag-tip">
                                  <p>
                                    An <strong>allocation</strong> records who
                                    is owed what. A <strong>payout</strong>{" "}
                                    records money sent to a recipient.
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
                      )}
                      {tab === AgreementTab.People && (
                        <>
                          <Heading
                            small
                            title="People in this agreement"
                            description="Add everyone before drafting rules. Each person approves their own account’s decision."
                          />
                          <AgreementPeople
                            key={selected.id}
                            agreement={selected}
                            version={latest}
                            userId={user.id}
                            base={base}
                          />
                          {organizer && !selected.value.versions.length && (
                            <section className="section">
                              <h3>Add someone you already work with</h3>
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
                              {workspaces.find((w) => w.id === workspace)
                                ?.role === "OWNER" && (
                                <AgreementInvitation
                                  key={selected.id}
                                  base={base}
                                  name={selected.value.name}
                                />
                              )}
                            </section>
                          )}
                          <section
                            className="section"
                            id="agreement-payout-destination"
                          >
                            <h3>Your payout destination</h3>
                            <p className="muted">
                              Only you can set your destination. This is a
                              PayPal sandbox merchant ID, not an email.
                            </p>
                            <SimpleForm
                              label="Your sandbox PayPal recipient ID"
                              button="Save destination"
                              busy={busy}
                              onSubmit={(paypalId) =>
                                run(async () => {
                                  await api(`${base}/recipient`, "PUT", {
                                    paypalId,
                                  });
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
                                      <h2
                                        id="agreement-proposal-review"
                                        tabIndex={-1}
                                      >
                                        Rules in v{latest.id}
                                      </h2>
                                      <span
                                        className={`status-chip ${
                                          latest.id ===
                                            selected.value.activeVersionId ||
                                          latest.status === "APPROVED"
                                            ? "good"
                                            : ""
                                        }`}
                                      >
                                        {latest.id ===
                                        selected.value.activeVersionId
                                          ? "Active"
                                          : title(latest.status)}
                                      </span>
                                    </div>
                                    <p className="muted">
                                      People agree on the rules; the engine
                                      calculates the money.
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
                                      {latest.rules.source.origin ===
                                      "HUMAN_PROPOSAL"
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
                                    <blockquote>
                                      {latest.rules.source.excerpt}
                                    </blockquote>
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
                                      await mutate(
                                        `/versions/${latest.id}/${action}`,
                                        payload,
                                      );
                                      if (action === "approve")
                                        setApprovedForPayout(selected.id);
                                    } finally {
                                      setBusy(false);
                                    }
                                  }}
                                />
                                {approvedForPayout === selected.id && (
                                  <PostApprovalPayout
                                    base={base}
                                    onDismiss={() => setApprovedForPayout("")}
                                    onSetup={() => {
                                      setApprovedForPayout("");
                                      changeAgreementTab(AgreementTab.People);
                                    }}
                                  />
                                )}
                                <ReviewDiscussion
                                  key={`${selected.id}:${latest.id}`}
                                  base={base}
                                  agreement={selected}
                                  version={latest}
                                  canWrite={
                                    workspaces.find((w) => w.id === workspace)
                                      ?.role !== "VIEWER"
                                  }
                                  onDirtyChange={setDraftDirty}
                                />
                                <section className="section">
                                  <h3>Preview an incoming payment</h3>
                                  <p className="muted">
                                    Illustrative only. No payment or payout is
                                    created.
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
                                      replacement={
                                        !!selected.value.versions.length
                                      }
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
                                              if (
                                                /\.(pdf|docx)$/i.test(f.name)
                                              ) {
                                                const isDocx = f.name
                                                  .toLowerCase()
                                                  .endsWith(".docx");
                                                if (f.size > 5 * 1024 * 1024)
                                                  throw new Error(
                                                    "Document must be no larger than 5 MB.",
                                                  );
                                                const data =
                                                  await new Promise<string>(
                                                    (resolve, reject) => {
                                                      const reader =
                                                        new FileReader();
                                                      reader.onload = () =>
                                                        resolve(
                                                          String(
                                                            reader.result,
                                                          ).split(",")[1],
                                                        );
                                                      reader.onerror = () =>
                                                        reject(
                                                          new Error(
                                                            "Unable to read file.",
                                                          ),
                                                        );
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
                                                  !f.name
                                                    .toLowerCase()
                                                    .endsWith(".txt") &&
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
                                              setDraftDirty(
                                                !/\.(pdf|docx)$/i.test(f.name),
                                              );
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
                                        disabled={
                                          busy || !source.trim() || !!documentId
                                        }
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
                                        {documentId
                                          ? "Source saved"
                                          : "Save source"}
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
                                      onReviewPeople={() =>
                                        changeAgreementTab(AgreementTab.People)
                                      }
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
                                          setNotice(
                                            "New proposal saved. No rules were activated.",
                                          );
                                          requestAnimationFrame(() => {
                                            const review =
                                              document.getElementById(
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
                        <>
                          <Heading
                            small
                            title="Incoming payments"
                            description="Payments appear here once PayPal confirms them. Each share follows the agreed terms."
                          />
                          <AgreementInvoices
                            key={selected.id}
                            base={base}
                            agreementName={selected.value.name}
                            userId={user.id}
                            canCreate={organizer && !!active}
                          />
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
                                      {organizer &&
                                        p.status === "AWAITING_BUYER" && (
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
                              Once everyone approves your agreement, activate it
                              and create an invoice to receive your first
                              payment.
                            </Empty>
                          )}
                          {organizer && (
                            <PaymentRecovery
                              key={base}
                              base={base}
                              payments={payments}
                              payouts={payouts}
                              held={!!selected.value.reviewHold}
                              refresh={refresh}
                            />
                          )}
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
                            {money(breakdown.feeCents)} ={" "}
                            {money(breakdown.netCents)} available.
                          </p>
                          <AllocationTable
                            allocations={breakdown.allocations}
                            agreement={selected}
                          />
                          <p className="muted">
                            Applied version {breakdown.versionId}. Recoupment is
                            included in each recipient’s total. An allocation is
                            not proof of payout.
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
                                  await api(
                                    `${base}/payouts/dispatch`,
                                    "POST",
                                    {
                                      captureId: breakdown.providerCaptureId,
                                    },
                                  );
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
                            Technical sandbox dispatch, not a vote on the
                            shares. Automatic scheduling is not enabled yet.
                          </p>
                        </section>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
            {section === Section.Payouts && !selected && (
              <>
                <PaymentGrid
                  title="Payouts"
                  description="Track money going to people, across all your agreements."
                  emptyActions={
                    <Button
                      variant="secondary"
                      onClick={() => navigate(Section.Agreements)}
                    >
                      View agreements
                    </Button>
                  }
                  loading={busy}
                  rows={payouts.map((p) => ({
                    id: JSON.stringify([
                      p.agreement.workspaceId,
                      p.agreement.id,
                      p.id,
                    ]),
                    agreementId: JSON.stringify([
                      p.agreement.workspaceId,
                      p.agreement.id,
                    ]),
                    agreementName: p.agreement.value.name,
                    recipientName:
                      p.agreement.value.members.find(
                        (m: any) => m.userId === p.user_id,
                      )?.displayName || "Recipient",
                    amountCents: p.amount,
                    currency: "USD",
                    status: payoutStatus(p.status),
                    providerReference: p.item_id || p.batch_id || undefined,
                    trace: allocationTrace(
                      p.agreement,
                      p.capture_id,
                      p.user_id,
                      p.amount,
                    ),
                  }))}
                  onOpenAgreement={(id) => {
                    const a = agreements.find(
                      (a) => JSON.stringify([a.workspaceId, a.id]) === id,
                    );
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
                            `${workspaceBase(p.agreement.workspaceId)}/collaborations/${p.agreement.id}/payouts/${p.id}/reconcile`,
                            "POST",
                            {},
                          );
                        }
                        await loadWorkspace(workspace);
                      })
                    }
                  >
                    Refresh payment statuses
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
                <div className="settings-layout">
                  <nav
                    className="settings-subnav"
                    aria-label="Settings sections"
                  >
                    {[
                      "Profile",
                      "Notifications",
                      "Payment accounts",
                      "Currency & display",
                      "Activity log",
                    ].map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        className="settings-subnav-item"
                        aria-current={settingsTab === tab ? "page" : undefined}
                        onClick={() => setSettingsTab(tab)}
                      >
                        {tab}
                      </button>
                    ))}
                  </nav>
                  <div className="settings-content">
                    {settingsTab === "Payment accounts" &&
                      (workspace ? (
                        <>
                          <p className="muted">
                            These payout details apply to{" "}
                            {agreements
                              .filter((item) => item.workspaceId === workspace)
                              .map((item) => item.value.name)
                              .join(", ") || "agreements shared with this team"}
                            . To manage another agreement, open it using the
                            agreement picker above, then return here.
                          </p>
                          <PaymentAccountsSettings
                            key={workspace}
                            workspace={workspace}
                            canEdit={
                              workspaces.find((w) => w.id === workspace)
                                ?.role !== "VIEWER"
                            }
                          />
                        </>
                      ) : (
                        <Empty title="Start an agreement first">
                          Upload your first agreement to set up a payout
                          destination.
                        </Empty>
                      ))}
                    {settingsTab === "Notifications" && (
                      <NotificationsSettings key={user.id} />
                    )}
                    {settingsTab === "Currency & display" && (
                      <CurrencyDisplaySettings key={user.id} />
                    )}
                    {settingsTab === "Activity log" && (
                      <ActivityLogSettings
                        key={`${user.id}:${workspace}`}
                        workspace={workspace}
                      />
                    )}
                    {settingsTab === "Profile" && (
                      <>
                        <section className="settings-pane">
                          <SettingsPaneHeader
                            title="Profile"
                            description="How you appear to the people on your agreements."
                          />
                          <ProfileContact
                            key={`contact:${user.id}`}
                            userId={user.id}
                            name={user.name}
                            email={user.email}
                            emailVerified={
                              "emailVerified" in user &&
                              user.emailVerified === true
                            }
                            emailAction={
                              !(
                                "emailVerified" in user &&
                                user.emailVerified === true
                              ) &&
                              emailDelivery && (
                                <Button
                                  type="button"
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
                                </Button>
                              )
                            }
                          >
                            <ProfileForm
                              key={`name:${user.id}`}
                              name={user.name}
                              busy={busy}
                              onSave={async (name) => {
                                const result = await api(
                                  "auth/profile",
                                  "POST",
                                  { name },
                                );
                                setUser(result.user);
                                setNotice(
                                  "Display name saved. Existing agreement names are unchanged.",
                                );
                              }}
                            />
                          </ProfileContact>
                          <PasswordRow
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
                          <SettingsRow
                            label="Environment"
                            hint="Live money is disabled."
                          >
                            <span className="status-chip warning">{mode}</span>
                          </SettingsRow>
                          {inviteLink && (
                            <a className="block-link" href={inviteLink}>
                              Open demo verification/invitation link
                            </a>
                          )}
                        </section>
                        <MfaSettings
                          onSignOut={() => {
                            setUser(null);
                            setWorkspace("");
                          }}
                        />
                        <section className="panel">
                          <h2>Other invitations</h2>
                          {workspaces.find((w) => w.id === workspace)?.role ===
                            "OWNER" && (
                            <PrivateInvitation
                              key={workspace}
                              workspace={workspace}
                            />
                          )}
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
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function PrivateInvitation({ workspace }: { workspace: string }) {
  const [invitation, setInvitation] = useState<{
    id: string;
    token: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const link = invitation
    ? `${location.origin}/invitation#token=${encodeURIComponent(invitation.token)}`
    : "";
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h3>Invite a collaborator</h3>
      <p className="muted">
        Anyone holding this private link can join your team once as a member
        after signing in. Share it only with your intended collaborator. No
        email is sent. The organizer must still add them to an agreement;
        joining does not approve rules or move money.
      </p>
      {!invitation ? (
        <Button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const result = await api(
                `${workspaceBase(workspace)}/invitation-links`,
                "POST",
                { role: "MEMBER" },
              );
              setInvitation(result.invitation);
            })
          }
        >
          Create private invitation link
        </Button>
      ) : (
        <>
          <label>
            Private invitation link
            <input
              readOnly
              aria-label="Private invitation link"
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <p className="muted">
            Expires {new Date(invitation.expiresAt).toLocaleString()}. Copy it
            now; it is not stored in your browser.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act(async () => {
                if (!navigator.clipboard) {
                  setMessage("Select the link above and copy it manually.");
                  return;
                }
                await navigator.clipboard.writeText(link);
                setMessage("Invitation link copied.");
              })
            }
          >
            Copy link
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await api(
                  `${workspaceBase(workspace)}/invitations/${invitation.id}`,
                  "DELETE",
                );
                setInvitation(null);
                setMessage("Invitation revoked. You can create a new one.");
              })
            }
          >
            Revoke link
          </Button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
