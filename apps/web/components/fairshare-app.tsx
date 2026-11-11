"use client";
import {
  AgreementInvitationPreview,
  AGREEMENT_INVITE_PREFIX,
} from "./agreement-invitation";
import { useEmailDelivery } from "../lib/email-capability";
import { useDisplayPreferences } from "./settings-preferences";
import { Button } from "./ui";
import { Logo, Heading, Auth } from "./agreement-widgets";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  AgreementTab,
  Section,
  api,
  type Agreement,
  type User,
  type Revenue,
} from "../lib/model";
import { AgreementIntake, type AgreementIntakeInput } from "./agreement-intake";
import { AccessPrompt } from "./designer-auth";
import { recoverSourceDocument } from "../lib/source-recovery";
import { workspaceBase } from "../lib/workspace-base";
import { AppShell } from "./app-shell";
import { OverviewSection } from "./sections/overview-section";
import { AgreementsSection } from "./sections/agreements-section";
import { AgreementDetail } from "./sections/agreement-detail";
import { PayoutsSection } from "./sections/payouts-section";
import { SettingsSection } from "./sections/settings-section";
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
    document.title = user ? `${section} · Fairshare` : "Log in · Fairshare";
  }, [ready, user, section]);
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
    <AppShell
      user={user}
      mode={mode}
      section={section}
      agreements={agreements}
      selected={selected}
      busy={busy}
      error={error}
      notice={notice}
      run={run}
      refresh={refresh}
      navigate={navigate}
      mayLeaveDraft={mayLeaveDraft}
      openAgreement={openAgreement}
      setSettingsTab={setSettingsTab}
      setUser={setUser}
      setWorkspace={setWorkspace}
      setSelected={setSelected}
      setAgreements={setAgreements}
    >
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
            kind={flowKind === "/verify-email" ? "verification" : "invitation"}
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
            description="Your payouts will appear here once an agreement receives a payment."
            action={
              <Button onClick={() => navigate(Section.Agreements)}>
                Create an agreement
              </Button>
            }
          />
        ) : (
          <>
            <AgreementIntake first busy={busy} onCreate={createFromAgreement} />
            <p className="muted">
              Already invited? Open Settings to accept your invitation.
            </p>
          </>
        )
      ) : (
        <>
          {section === Section.Overview && !selected && (
            <OverviewSection
              user={user}
              agreements={agreements}
              payouts={payouts}
              canCreateAgreement={canCreateAgreement}
              setSection={setSection}
              setCreating={setCreating}
              run={run}
              openAgreement={openAgreement}
            />
          )}
          {section === Section.Agreements && !selected && (
            <AgreementsSection
              creating={creating}
              canCreateAgreement={canCreateAgreement}
              busy={busy}
              agreements={agreements}
              workspaces={workspaces}
              workspace={workspace}
              setCreating={setCreating}
              createFromAgreement={createFromAgreement}
              run={run}
              openAgreement={openAgreement}
            />
          )}
          {selected && section === Section.Agreements && (
            <AgreementDetail
              selected={selected}
              user={user}
              base={base}
              busy={busy}
              organizer={organizer}
              latest={latest}
              active={active}
              tab={tab}
              creationAgreementId={creationAgreementId}
              workspaces={workspaces}
              workspace={workspace}
              members={members}
              payments={payments}
              payouts={payouts}
              source={source}
              documentId={documentId}
              extraction={extraction}
              editing={editing}
              preview={preview}
              breakdown={breakdown}
              approvedForPayout={approvedForPayout}
              draftDirty={draftDirty}
              rulesDirty={rulesDirty}
              run={run}
              mutate={mutate}
              refresh={refresh}
              loadWorkspace={loadWorkspace}
              navigate={navigate}
              mayLeaveDraft={mayLeaveDraft}
              changeAgreementTab={changeAgreementTab}
              setTab={setTab}
              setSection={setSection}
              setSelected={setSelected}
              setCreationAgreementId={setCreationAgreementId}
              setBusy={setBusy}
              setError={setError}
              setNotice={setNotice}
              setPreview={setPreview}
              setEditing={setEditing}
              setBreakdown={setBreakdown}
              setApprovedForPayout={setApprovedForPayout}
              setDraftDirty={setDraftDirty}
              setSource={setSource}
              setDocumentId={setDocumentId}
              setExtraction={setExtraction}
            />
          )}
          {section === Section.Payouts && !selected && (
            <PayoutsSection
              user={user}
              agreements={agreements}
              payouts={payouts}
              workspace={workspace}
              busy={busy}
              run={run}
              navigate={navigate}
              openAgreement={openAgreement}
              loadWorkspace={loadWorkspace}
            />
          )}
          {section === Section.Settings && !selected && (
            <SettingsSection
              user={user}
              mode={mode}
              busy={busy}
              emailDelivery={emailDelivery}
              settingsTab={settingsTab}
              setSettingsTab={setSettingsTab}
              workspace={workspace}
              workspaces={workspaces}
              agreements={agreements}
              inviteLink={inviteLink}
              run={run}
              acceptInvitation={acceptInvitation}
              setNotice={setNotice}
              setInviteLink={setInviteLink}
              setUser={setUser}
              setWorkspace={setWorkspace}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
