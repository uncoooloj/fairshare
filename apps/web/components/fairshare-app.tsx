"use client";
import {
  AgreementInvitationPreview,
  AGREEMENT_INVITE_PREFIX,
  InvitationSignInContext,
} from "./agreement-invitation";
import { useEmailDelivery } from "../lib/email-capability";
import { useDisplayPreferences } from "./settings-preferences";
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
import {
  AgreementIntake,
  type AgreementIntakeInput,
  type CreatedAgreement,
  type WizardResume,
} from "./agreement-intake";
import { isDraftAgreement } from "./sections/agreements-section";
import { AccessPrompt } from "./designer-auth";
import { recoverSourceDocument } from "../lib/source-recovery";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { workspaceBase } from "../lib/workspace-base";
import { AppShell } from "./app-shell";
import { OverviewSection } from "./sections/overview-section";
import { AgreementsSection } from "./sections/agreements-section";
import { AgreementDetail } from "./sections/agreement-detail";
import { PayoutsSection } from "./sections/payouts-section";
import { SettingsSection } from "./sections/settings-section";
export default function FairshareApp() {
  const router = useRouter();
  const emailDelivery = useEmailDelivery();
  const [codePrompt, setCodePrompt] = useState("");
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
    [payoutsComplete, setPayoutsComplete] = useState(false),
    [payoutsUnavailable, setPayoutsUnavailable] = useState(false),
    [mode, setMode] = useState("Unavailable");
  const [skippedFirstRun, setSkippedFirstRun] = useState(false);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [creating, setCreating] = useState(false),
    // A saved draft the wizard reopens at Check.
    [resume, setResume] = useState<WizardResume | null>(null),
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
  const workspaceRequest = useRef(0);
  const currentWorkspace = useRef("");
  const openRequest = useRef(0);
  const rulesDirty = useRef(false);
  function commitWorkspace(id: string) {
    workspaceRequest.current++;
    openRequest.current++;
    currentWorkspace.current = id;
    setWorkspace(id);
    setSelected(null);
    setCreating(false);
    setAgreements([]);
    setMembers([]);
    setPayments([]);
    setPayouts([]);
    setPayoutsComplete(false);
    setPayoutsUnavailable(false);
    setSource("");
    setDocumentId("");
    setExtraction(null);
    setPreview(null);
    setBreakdown(null);
    setEditing(false);
    setInviteLink("");
    setDraftDirty(false);
    rulesDirty.current = false;
  }
  function clearSession() {
    commitWorkspace("");
    setWorkspaces([]);
    setUser(null);
  }
  function mayLeaveDraft() {
    if (busy) return false;
    if (draftDirty && !window.confirm("Discard your unsaved changes?"))
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
    const request = workspaceRequest.current;
    try {
      const r = await api("workspaces");
      if (request !== workspaceRequest.current) return "";
      const id =
        currentWorkspace.current &&
        r.workspaces.some((w: any) => w.id === currentWorkspace.current)
          ? currentWorkspace.current
          : r.workspaces[0]?.id || "";
      setWorkspaces(r.workspaces);
      if (id !== currentWorkspace.current) commitWorkspace(id);
      return id;
    } catch (error) {
      if (request !== workspaceRequest.current) return "";
      throw error;
    }
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
    commitWorkspace(result.workspace.id);
    setSection(Section.Agreements);
    setFlowToken("");
    // Swap the address without a route change: /invitation and /app are
    // separate pages, so router.replace would remount the app and drop the
    // agreement opened below.
    window.history.replaceState(null, "", "/app");
    if (result.agreement) {
      setAgreements([result.agreement]);
      setSelected(result.agreement);
      // Collaborators land on what they get and approve.
      setTab(AgreementTab.Terms);
      setNotice("You’re in. Have a look at the split.");
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
      setNotice("You’re in. The organizer will add you to their agreement.");
  }
  async function loadWorkspace(id: string) {
    if (!id || id !== currentWorkspace.current) return;
    const request = workspaceRequest.current;
    const isCurrent = () =>
      request === workspaceRequest.current && currentWorkspace.current === id;
    setPayoutsComplete(false);
    setPayoutsUnavailable(false);
    try {
      const [groups, m] = await Promise.all([
        api("workspaces"),
        api(`${workspaceBase(id)}/members`),
      ]);
      if (!isCurrent()) return;
      const lists = await Promise.all(
        groups.workspaces.map((group: any) =>
          api(`${workspaceBase(group.id)}/collaborations`),
        ),
      );
      if (!isCurrent()) return;
      const visibleAgreements: Agreement[] = lists.flatMap(
        (list) => list.collaborations,
      );
      setWorkspaces(groups.workspaces);
      setAgreements(visibleAgreements);
      setMembers(m.members);
      setPayouts([]);
      setPayoutsComplete(false);
      const all = await Promise.all(
        visibleAgreements.map(async (a: Agreement) => {
          const p = await api(
            `${workspaceBase(a.workspaceId)}/collaborations/${a.id}/payouts`,
          );
          return p.payouts.map((v: any) => ({ ...v, agreement: a }));
        }),
      );
      if (!isCurrent()) return;
      setPayouts(all.flat());
      setPayoutsComplete(true);
      setPayoutsUnavailable(false);
    } catch (error) {
      if (!isCurrent()) return;
      setPayouts([]);
      setPayoutsComplete(false);
      setPayoutsUnavailable(true);
      throw error;
    }
  }
  async function openAgreement(a: Agreement) {
    if (user && isDraftAgreement(a, user.id)) return resumeDraft(a);
    if (a.workspaceId !== currentWorkspace.current)
      commitWorkspace(a.workspaceId);
    const request = ++openRequest.current;
    const root = `${workspaceBase(a.workspaceId)}/collaborations/${a.id}`;
    try {
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
    } catch (error) {
      if (request !== openRequest.current) return;
      throw error;
    }
  }
  /** Reopens a never-sent agreement in the wizard at Check, from its stored document. */
  async function resumeDraft(a: Agreement) {
    if (a.workspaceId !== currentWorkspace.current)
      commitWorkspace(a.workspaceId);
    const request = ++openRequest.current;
    const root = `${workspaceBase(a.workspaceId)}/collaborations/${a.id}`;
    const fresh = await api<Agreement>(root);
    const doc = await recoverSourceDocument(root, undefined, api);
    if (request !== openRequest.current) return;
    if (!doc) throw new Error("We couldn’t find this draft’s document.");
    setSelected(null);
    setResume({
      created: {
        workspaceId: a.workspaceId,
        agreementId: a.id,
        documentId: doc.documentId,
        documentText: doc.text,
        agreement: fresh,
        lowConfidence: doc.provenance?.lowConfidence === true,
      },
      extraction: doc.extraction ?? null,
    });
    setCreating(true);
  }
  /** The wizard's private draft: intake saves the workspace, agreement and document together. */
  async function createFromAgreement(
    input: AgreementIntakeInput,
  ): Promise<CreatedAgreement> {
    setError("");
    setNotice("");
    const result = await api("agreements/intake", "POST", {
      ...input,
      ...(creationWorkspace ? { workspaceId: creationWorkspace.id } : {}),
    });
    // Adopt the committed result before any optional refresh. A lost response
    // is safe to retry with the wizard's original request ID.
    setWorkspaces((current) => [
      ...current.filter((item) => item.id !== result.workspace.id),
      {
        ...current.find((item) => item.id === result.workspace.id),
        ...result.workspace,
      },
    ]);
    if (currentWorkspace.current !== result.workspace.id)
      commitWorkspace(result.workspace.id);
    // The wizard stays open through Check, People and Send.
    setCreating(true);
    setSection(Section.Agreements);
    // The draft shows in Agreements ("Finish setting up") if the wizard is closed.
    setAgreements((current) => [
      result.agreement,
      ...current.filter(
        (item) =>
          item.workspaceId !== result.agreement.workspaceId ||
          item.id !== result.agreement.id,
      ),
    ]);
    const intakeWorkspaceId = result.workspace.id;
    void loadWorkspace(intakeWorkspaceId).catch(() => {
      // The intake is committed; a failed optional refresh must not make it look unsuccessful.
    });
    return {
      workspaceId: result.workspace.id,
      agreementId: result.agreement.id,
      documentId: result.document.documentId,
      documentText: result.document.text,
      agreement: result.agreement,
      lowConfidence: result.document.provenance?.lowConfidence === true,
    };
  }
  function leaveWizard() {
    setCreating(false);
    setResume(null);
    setSection(Section.Agreements);
    const id = currentWorkspace.current;
    if (id) void loadWorkspace(id).catch(() => {});
  }
  /** After Sent: the agreement's Overview, now waiting for approvals. */
  function finishCreation(agreement: Agreement) {
    setResume(null);
    setCreating(false);
    run(() => openAgreement(agreement));
    void loadWorkspace(agreement.workspaceId).catch(() => {});
  }
  async function refresh() {
    // An operation started in an older render may finish after navigation.
    if (workspace !== currentWorkspace.current) return;
    const workspaceRequestId = workspaceRequest.current;
    const openRequestId = openRequest.current;
    const id = currentWorkspace.current;
    try {
      await loadWorkspace(id);
      if (
        workspaceRequestId !== workspaceRequest.current ||
        openRequestId !== openRequest.current
      )
        return;
      if (selected) {
        const a = await api<Agreement>(base);
        if (
          workspaceRequestId !== workspaceRequest.current ||
          openRequestId !== openRequest.current
        )
          return;
        setSelected(a);
        const p = await api(`${base}/payments`);
        if (
          workspaceRequestId !== workspaceRequest.current ||
          openRequestId !== openRequest.current
        )
          return;
        setPayments(p.payments);
      }
    } catch (error) {
      if (
        workspaceRequestId !== workspaceRequest.current ||
        openRequestId !== openRequest.current
      )
        return;
      throw error;
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
    // Only ordinary app/auth entry points redirect with the session state so
    // Next can render the destination route's metadata as well as its page.
    if (ready && user && location.pathname === "/login") router.replace("/app");
    else if (ready && !user && location.pathname === "/app")
      router.replace("/login");
  }, [ready, user, router]);
  useEffect(() => {
    if (!ready) return;
    document.title =
      flowToken && flowKind === "/invitation"
        ? "Invitation · Fairshare"
        : flowToken && flowKind === "/verify-email"
          ? "Verify email · Fairshare"
          : user
            ? `${section} · Fairshare`
            : "Log in · Fairshare";
  }, [ready, user, section, flowKind, flowToken]);
  useEffect(() => {
    if (user)
      run(async () => {
        await loadWorkspaces();
        setWorkspacesLoaded(true);
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
    router.replace("/app");
  }
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    const workspaceRequestId = workspaceRequest.current;
    const openRequestId = openRequest.current;
    if (selected?.workspaceId !== currentWorkspace.current) return;
    try {
      const a = await api<Agreement>(base + action, "POST", {
        expectedRevision: selected!.revision,
        ...extra,
      });
      if (
        workspaceRequestId !== workspaceRequest.current ||
        openRequestId !== openRequest.current
      )
        return;
      setSelected(a);
      try {
        await loadWorkspace(currentWorkspace.current);
      } catch {
        setNotice("Updated. Refresh to see the latest.");
      }
    } catch (cause) {
      if (
        workspaceRequestId !== workspaceRequest.current ||
        openRequestId !== openRequest.current
      )
        return;
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") {
        const current = await api<Agreement>(base);
        if (
          workspaceRequestId !== workspaceRequest.current ||
          openRequestId !== openRequest.current
        )
          return;
        setSelected(current);
        throw new Error(
          "Someone else just changed this. Here’s the latest; try again.",
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
      <>
        {flowToken.startsWith(AGREEMENT_INVITE_PREFIX) && (
          <InvitationSignInContext />
        )}
        <Auth
          busy={busy}
          error={error}
          codePrompt={codePrompt}
          onCancelCode={() => {
            setCodePrompt("");
            setError("");
          }}
          onSubmit={(type, data) =>
            run(async () => {
              try {
                const r = await api(`auth/${type}`, "POST", data);
                setCodePrompt("");
                setUser(r.user);
              } catch (cause) {
                // The password was accepted; this account also needs its authenticator.
                if (
                  type === "login" &&
                  !data.mfaCode &&
                  cause instanceof ApiError &&
                  cause.code === "MFA_REQUIRED"
                ) {
                  setCodePrompt(cause.message);
                  return;
                }
                throw cause;
              }
            })
          }
        />
      </>
    );
  const showWizard =
    !flowToken &&
    ((creating && (canCreateAgreement || needsWorkspace)) ||
      (workspacesLoaded &&
        needsWorkspace &&
        !skippedFirstRun &&
        section !== Section.Payouts));
  if (showWizard)
    return (
      <AgreementIntake
        first={needsWorkspace && !creating}
        key={resume ? resume.created.agreementId : "new"}
        owner={{ id: user.id, name: user.name, email: user.email }}
        resume={resume ?? undefined}
        onCreate={createFromAgreement}
        onFinish={finishCreation}
        onKeepDraft={leaveWizard}
        onClose={leaveWizard}
        onSkip={() => setSkippedFirstRun(true)}
        onBusyChange={setBusy}
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
      workspace={workspace}
      navigate={navigate}
      mayLeaveDraft={mayLeaveDraft}
      openAgreement={openAgreement}
      setSettingsTab={setSettingsTab}
      clearSession={clearSession}
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
                      ? "Test account email marked verified."
                      : "Email verified.",
                  );
                } else {
                  await acceptInvitation(flowToken);
                }
                setFlowToken("");
                router.replace("/app");
              })
            }
          />
        )
      )}
      {isInvitationFlow ? null : needsWorkspace ? (
        section === Section.Payouts ? (
          <Heading
            title="No payouts yet"
            description="When people get paid, it shows up here."
            action={
              <Button onClick={() => navigate(Section.Agreements)}>
                Create an agreement
              </Button>
            }
          />
        ) : (
          <Heading
            title="No agreements yet"
            description="Upload a signed agreement or try the sample. Nothing moves money. Already invited? Open your invite link, or accept it in Settings."
            action={
              <Button onClick={() => setCreating(true)}>New agreement</Button>
            }
          />
        )
      ) : (
        <>
          {section === Section.Overview && !selected && (
            <OverviewSection
              user={user}
              agreements={agreements}
              payouts={payouts}
              payoutsComplete={payoutsComplete}
              payoutsUnavailable={payoutsUnavailable}
              canCreateAgreement={canCreateAgreement}
              setSection={setSection}
              setCreating={setCreating}
              run={run}
              openAgreement={openAgreement}
            />
          )}
          {section === Section.Agreements && !selected && (
            <AgreementsSection
              userId={user.id}
              canCreateAgreement={canCreateAgreement}
              agreements={agreements}
              workspaces={workspaces}
              workspace={workspace}
              setCreating={setCreating}
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
              rulesLanding={false}
              workspaces={workspaces}
              workspace={workspace}
              members={members}
              payments={payments}
              payouts={payouts}
              payoutsComplete={payoutsComplete}
              payoutsUnavailable={payoutsUnavailable}
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
              clearSession={clearSession}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
