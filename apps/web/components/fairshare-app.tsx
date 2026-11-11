"use client";
import {
  AgreementInvitationPreview,
  AGREEMENT_INVITE_PREFIX,
  InvitationSignInContext,
} from "./agreement-invitation";
import { useEmailDelivery } from "../lib/email-capability";
import { useDisplayPreferences } from "./settings-preferences";
import { Logo, Heading, Auth } from "./agreement-widgets";
import { useEffect, useRef, useState, type SetStateAction } from "react";
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
import { OnboardingDetails, OnboardingWelcome } from "./onboarding-details";
import {
  browserSessionStorage,
  readOnboardingStage,
  writeOnboardingStage,
  type OnboardingStage,
} from "./onboarding-storage";
import { recoverSourceDocument } from "../lib/source-recovery";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { workspaceBase } from "../lib/workspace-base";
import { mutationIsCurrent } from "../lib/mutation-generation";
import { AppShell } from "./app-shell";
import { visibleTab } from "./agreement-tabs";
import { OverviewSection } from "./sections/overview-section";
import { AgreementsSection } from "./sections/agreements-section";
import { AgreementDetail } from "./sections/agreement-detail";
import { PayoutsSection } from "./sections/payouts-section";
import { SettingsSection } from "./sections/settings-section";
import {
  AppHistoryMark,
  AppView,
  APP_ROOT,
  appPath,
  historyMark,
  historyWorkspace,
  isAppPath,
  markedState,
  parseAppPath,
  resolveRoutedAgreement,
  routeForHistory,
  safeAppPath,
  type AppRoute,
} from "../lib/app-routes";

/** Where to go after signing in: the app page that sent you to login, or Overview. */
function loginDestination() {
  return safeAppPath(new URLSearchParams(location.search).get("next"));
}

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
  const [onboardingStage, setOnboardingStage] =
    useState<OnboardingStage | null>(null);
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
  // The draft the open wizard saved, so its URL becomes /app/agreements/:id/setup.
  const [wizardDraftId, setWizardDraftId] = useState("");
  const [agreementsLoaded, setAgreementsLoaded] = useState(false);
  // The address the app opened at, applied once agreements have loaded.
  const pendingRoute = useRef<AppRoute | null>(null);
  const applied = useRef(false);
  // A history move or deep link being opened; the URL already shows it.
  const navigating = useRef("");
  // Replace instead of push for the next URL change (wizard saved, link corrected).
  const replaceNext = useRef(false);
  const [routeTick, setRouteTick] = useState(0);
  const workspaceRequest = useRef(0);
  const workspaceLoadedRequest = useRef(0);
  const onboardingFallback = useRef(new Map<string, OnboardingStage>());
  const currentWorkspace = useRef("");
  const openRequest = useRef(0);
  const wizardMayLeave = useRef<() => boolean>(() => true);
  const rulesDirty = useRef(false);
  function commitWorkspace(id: string) {
    workspaceRequest.current++;
    openRequest.current++;
    currentWorkspace.current = id;
    setWorkspace(id);
    setSelected(null);
    setCreating(false);
    setAgreements([]);
    setAgreementsLoaded(!id);
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
    setWorkspacesLoaded(false);
    workspaceLoadedRequest.current = 0;
    setSkippedFirstRun(false);
    setUser(null);
    setOnboardingStage(null);
    onboardingFallback.current.clear();
  }
  function setOnboardingForUser(stage: OnboardingStage) {
    if (!user) return;
    writeOnboardingStage(
      browserSessionStorage(),
      onboardingFallback.current,
      user.id,
      stage,
    );
    setOnboardingStage(stage);
  }
  function mayLeaveDraft() {
    if (busy) return false;
    if (!wizardMayLeave.current()) return false;
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
      workspaceLoadedRequest.current = request;
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
      setAgreementsLoaded(true);
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
  async function openAgreement(
    a: Agreement,
    initialTab: AgreementTab = AgreementTab.Overview,
  ) {
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
      setTab(initialTab);
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
    replaceNext.current = true;
    setWizardDraftId(result.agreement.id);
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
    setWizardDraftId("");
    setSection(Section.Agreements);
    // Closing replaces the wizard's entry, so Back doesn't reopen it.
    replaceNext.current = true;
    const id = currentWorkspace.current;
    if (id) void loadWorkspace(id).catch(() => {});
  }
  /** After Sent: the agreement's Overview, now waiting for approvals. */
  function finishCreation(agreement: Agreement) {
    setResume(null);
    setCreating(false);
    setWizardDraftId("");
    // Sent replaces the wizard's entry: Back goes to the list, not into the wizard.
    replaceNext.current = true;
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
    // Both are replaces: Back from the app never returns to the login form.
    if (ready && user && location.pathname === "/login")
      router.replace(loginDestination());
    else if (ready && !user && isAppPath(location.pathname))
      router.replace(
        location.pathname === APP_ROOT
          ? "/login"
          : `/login?next=${encodeURIComponent(location.pathname)}`,
      );
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
    if (!user) {
      setOnboardingStage(null);
      return;
    }
    setOnboardingStage(
      readOnboardingStage(
        browserSessionStorage(),
        onboardingFallback.current,
        user.id,
      ),
    );
  }, [user?.id]);
  useEffect(() => {
    setSkippedFirstRun(false);
    setWorkspacesLoaded(false);
    workspaceLoadedRequest.current = 0;
    if (!user) return;
    workspaceRequest.current++;
    const request = workspaceRequest.current;
    run(async () => {
      await loadWorkspaces();
      if (workspaceLoadedRequest.current === request) setWorkspacesLoaded(true);
    });
  }, [user?.id]);
  useEffect(() => {
    if (workspace && user) run(() => loadWorkspace(workspace));
  }, [workspace]);
  const firstRun =
    workspacesLoaded &&
    needsWorkspace &&
    !skippedFirstRun &&
    section !== Section.Payouts;
  const showOnboarding =
    !flowToken &&
    firstRun &&
    onboardingStage !== null &&
    onboardingStage !== "agreement" &&
    onboardingStage !== "complete";
  const showWizard =
    !flowToken &&
    ((creating && (canCreateAgreement || needsWorkspace)) ||
      (firstRun &&
        (onboardingStage === null || onboardingStage === "agreement")));
  // The address for what is on screen. The first-run chooser keeps whatever URL it opened at.
  const routePath =
    !user || flowToken
      ? ""
      : showWizard
        ? creating
          ? appPath(
              resume || wizardDraftId
                ? {
                    view: AppView.DraftSetup,
                    section: Section.Agreements,
                    workspaceId:
                      resume?.created.workspaceId ?? currentWorkspace.current,
                    agreementId: resume?.created.agreementId ?? wizardDraftId,
                  }
                : { view: AppView.NewAgreement, section: Section.Agreements },
            )
          : ""
        : selected && section === Section.Agreements
          ? appPath({
              view: AppView.Agreement,
              section,
              workspaceId: selected.workspaceId,
              agreementId: selected.id,
              tab,
            })
          : appPath({ view: AppView.Section, section });
  // Signed in at an app path: remember the deep link, and make this visit's
  // first entry a guard so Back never leaves the app for the home or login page.
  useEffect(() => {
    if (!user || flowToken || pendingRoute.current) return;
    if (!isAppPath(location.pathname)) return;
    pendingRoute.current = parseAppPath(location.pathname);
    const here = location.pathname + location.search;
    const mark = historyMark(history.state);
    if (!mark)
      history.replaceState(
        markedState(history.state, AppHistoryMark.Guard),
        "",
        here,
      );
    if (mark !== AppHistoryMark.Entry)
      history.pushState(
        markedState(null, AppHistoryMark.Entry, currentWorkspace.current),
        "",
        here,
      );
  }, [user?.id, flowToken]);
  // Open the deep link once there is something to open it in. Runs once.
  useEffect(() => {
    const route = pendingRoute.current;
    if (applied.current || !route || !user || !workspacesLoaded) return;
    const needsAgreements =
      route.view === AppView.Agreement || route.view === AppView.DraftSetup;
    if (needsAgreements && workspace && !agreementsLoaded) return;
    applied.current = true;
    // Plain /app keeps what is already open (an accepted invitation opens its agreement).
    if (appPath(route) !== APP_ROOT) applyRoute(route);
    replaceNext.current = true;
    setRouteTick((n) => n + 1);
  }, [user?.id, flowToken, workspacesLoaded, agreementsLoaded, workspace]);
  // Back and Forward inside the app. The listener is attached once and reads the
  // latest render: Next's own popstate handler re-renders synchronously, and a
  // listener swapped mid-dispatch would miss the event.
  const onPopState = useRef<(event: PopStateEvent) => void>(() => {});
  onPopState.current = (event: PopStateEvent) => {
    if (!user || !isAppPath(location.pathname)) return;
    if (historyMark(event.state) === AppHistoryMark.Guard) {
      // Back past the first app page: stay where you were.
      history.forward();
      return;
    }
    if (!applied.current) return;
    // A rejected history move invalidates only a pending route open. Mutations
    // share openRequest's freshness fence and must retain their committed reply.
    if (navigating.current) {
      openRequest.current++;
      navigating.current = "";
    }
    if (!mayLeaveDraft()) {
      // Put the address back to what is still on screen.
      if (routePath)
        history.pushState(
          markedState(
            null,
            AppHistoryMark.Entry,
            selected?.workspaceId ?? currentWorkspace.current,
          ),
          "",
          routePath,
        );
      return;
    }
    replaceNext.current = true;
    applyRoute(
      parseAppPath(location.pathname),
      historyWorkspace(event.state),
      event.state,
    );
    setRouteTick((n) => n + 1);
  };
  useEffect(() => {
    const listener = (event: PopStateEvent) => onPopState.current(event);
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  // Keep the address in step with the screen: push for moves, replace for corrections.
  useEffect(() => {
    if (!routePath || !applied.current || navigating.current) return;
    if (!isAppPath(location.pathname)) return;
    const replace = replaceNext.current;
    replaceNext.current = false;
    if (location.pathname === routePath) return;
    const state = markedState(
      null,
      AppHistoryMark.Entry,
      selected?.workspaceId ?? currentWorkspace.current,
    );
    if (replace) history.replaceState(state, "", routePath);
    else history.pushState(state, "", routePath);
  }, [routePath, routeTick]);
  function showSection(s: Section) {
    openRequest.current++;
    setSection(s);
    setSelected(null);
    setCreating(false);
    setResume(null);
    setWizardDraftId("");
    setError("");
    setNotice("");
  }
  function navigate(s: Section) {
    if (!mayLeaveDraft()) return false;
    showSection(s);
    return true;
  }
  function freshWizard() {
    openRequest.current++;
    setSelected(null);
    setResume(null);
    setWizardDraftId("");
    setSection(Section.Agreements);
    setCreating(true);
  }
  /** Every "New agreement" button: always a fresh wizard, never a stale draft or an agreement page. */
  function startNewAgreement() {
    if (mayLeaveDraft()) freshWizard();
  }
  /** Section props take a setter; `true` starts a fresh wizard. */
  function setCreatingFromSection(value: SetStateAction<boolean>) {
    const next = typeof value === "function" ? value(creating) : value;
    if (next) startNewAgreement();
    else setCreating(false);
  }
  /** Opens what a URL names (leaving unsaved work was already confirmed). */
  function applyRoute(route: AppRoute, workspaceId?: string, state?: unknown) {
    if (route.view === AppView.NewAgreement) return freshWizard();
    if (route.view === AppView.Section) return showSection(route.section);
    let routed = route;
    if (!routed.workspaceId && workspaceId) routed = { ...route, workspaceId };
    const a = resolveRoutedAgreement(agreements, routed);
    if (!a) {
      showSection(Section.Agreements);
      replaceNext.current = true;
      setNotice("We couldn’t find that agreement.");
      return;
    }
    const historyRoute = routeForHistory(routed, state, a);
    const requestedTab = historyRoute.tab;
    if (
      route.view === AppView.Agreement &&
      selected?.id === a.id &&
      selected.workspaceId === a.workspaceId &&
      !creating
    ) {
      setSection(Section.Agreements);
      if (requestedTab && visibleTab(requestedTab) !== visibleTab(tab)) {
        setTab(requestedTab);
        setBreakdown(null);
      }
      return;
    }
    const target = appPath(historyRoute);
    openRequest.current++;
    setCreating(false);
    setResume(null);
    setWizardDraftId("");
    navigating.current = target;
    void run(async () => {
      try {
        await openAgreement(a, requestedTab);
      } finally {
        // Opening can land elsewhere (a draft opens its setup) or fail:
        // correct the address to what is on screen.
        if (navigating.current === target) {
          navigating.current = "";
          replaceNext.current = true;
          setRouteTick((n) => n + 1);
        }
      }
    });
  }
  function dismissAccessFlow() {
    setFlowToken("");
    setError("");
    router.replace("/app");
  }
  async function mutateWithResult(
    action: string,
    extra: Record<string, unknown> = {},
    method: "POST" | "DELETE" = "POST",
  ): Promise<boolean> {
    const workspaceRequestId = workspaceRequest.current;
    const openRequestId = openRequest.current;
    if (selected?.workspaceId !== currentWorkspace.current) return false;
    try {
      const a = await api<Agreement>(
        method === "DELETE"
          ? `${base + action}?expectedRevision=${selected!.revision}`
          : base + action,
        method,
        method === "DELETE"
          ? undefined
          : { expectedRevision: selected!.revision, ...extra },
      );
      if (
        workspaceRequestId !== workspaceRequest.current ||
        openRequestId !== openRequest.current
      )
        return false;
      setSelected(a);
      try {
        await loadWorkspace(currentWorkspace.current);
      } catch {
        setNotice("Updated. Refresh to see the latest.");
      }
      if (
        !mutationIsCurrent(
          workspaceRequestId,
          openRequestId,
          workspaceRequest.current,
          openRequest.current,
        )
      )
        return false;
      return true;
    } catch (cause) {
      if (
        workspaceRequestId !== workspaceRequest.current ||
        openRequestId !== openRequest.current
      )
        return false;
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") {
        const current = await api<Agreement>(base);
        if (
          workspaceRequestId !== workspaceRequest.current ||
          openRequestId !== openRequest.current
        )
          return false;
        setSelected(current);
        throw new Error(
          "Someone else just changed this. Here’s the latest; try again.",
        );
      }
      throw cause;
    }
  }
  async function mutate(
    action: string,
    extra: Record<string, unknown> = {},
    method: "POST" | "DELETE" = "POST",
  ) {
    await mutateWithResult(action, extra, method);
  }
  function onAgreementChange(next: Agreement) {
    setSelected((current) => {
      if (
        !current ||
        current.workspaceId !== next.workspaceId ||
        current.id !== next.id ||
        next.revision < current.revision
      )
        return current;
      return next;
    });
    setAgreements((current) =>
      current.map((agreement) =>
        agreement.workspaceId === next.workspaceId &&
        agreement.id === next.id &&
        next.revision >= agreement.revision
          ? next
          : agreement,
      ),
    );
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
                if (type === "register") {
                  writeOnboardingStage(
                    browserSessionStorage(),
                    onboardingFallback.current,
                    r.user.id,
                    "welcome",
                  );
                  setOnboardingStage("welcome");
                }
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
  if (flowToken && flowKind === "/verify-email")
    return (
      <AccessPrompt
        standalone
        kind="verification"
        email={user.email}
        busy={busy}
        error={error}
        onCancel={dismissAccessFlow}
        onContinue={() =>
          run(async () => {
            const r = await api("auth/verification/confirm", "POST", {
              token: flowToken,
            });
            setUser(r.user);
            setNotice(
              r.verificationMode === "DEMO_SIMULATION"
                ? "Test account email marked verified."
                : "Email verified.",
            );
            setFlowToken("");
            router.replace("/app");
          })
        }
      />
    );
  if (showOnboarding && onboardingStage === "welcome")
    return (
      <OnboardingWelcome onStart={() => setOnboardingForUser("details")} />
    );
  if (showOnboarding && onboardingStage === "details")
    return (
      <OnboardingDetails
        name={user.name}
        onSave={async (name) => {
          const result = await api<{ user: User }>("auth/profile", "POST", {
            name,
          });
          setUser(result.user);
          setOnboardingForUser("agreement");
        }}
      />
    );
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
        onSkip={() => {
          setSkippedFirstRun(true);
          setOnboardingForUser("complete");
        }}
        onBusyChange={setBusy}
        onLeaveAttempt={(attempt) => {
          wizardMayLeave.current = attempt;
        }}
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
                await acceptInvitation(flowToken);
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
            action={<Button onClick={startNewAgreement}>New agreement</Button>}
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
              setCreating={setCreatingFromSection}
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
              setCreating={setCreatingFromSection}
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
              mutateWithResult={mutateWithResult}
              onAgreementChange={onAgreementChange}
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
