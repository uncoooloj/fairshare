import { AgreementTab, Section } from "./model";
import { isFullAgreementHistoryState } from "./full-agreement-history";

/** What the signed-in app shows for a path under /app. */
export enum AppView {
  Section = "SECTION",
  Agreement = "AGREEMENT",
  NewAgreement = "NEW_AGREEMENT",
  DraftSetup = "DRAFT_SETUP",
}

export interface AppRoute {
  view: AppView;
  section: Section;
  /** New agreement URLs carry this; old ID-only links remain readable if unique. */
  workspaceId?: string;
  agreementId?: string;
  tab?: AgreementTab;
}

export const APP_ROOT = "/app";

const sectionSlugs: Record<Section, string> = {
  [Section.Overview]: "",
  [Section.Agreements]: "agreements",
  [Section.Payouts]: "payouts",
  [Section.Settings]: "settings",
};

/** Tabs share a URL with the tab that shows them (Document lives on Agreement). */
const tabSlugs: Record<AgreementTab, string> = {
  [AgreementTab.Overview]: "",
  [AgreementTab.Terms]: "agreement",
  [AgreementTab.Document]: "agreement",
  [AgreementTab.People]: "people",
  [AgreementTab.Payments]: "payments",
  [AgreementTab.Allocations]: "payments",
};

const NEW_SLUG = "new";
const SETUP_SLUG = "setup";
// Agreement IDs are server UUIDs; anything else is not an agreement path.
const ID = /^[A-Za-z0-9-]{1,100}$/;

const overview: AppRoute = { view: AppView.Section, section: Section.Overview };

/** Reads a pathname. Unknown paths under /app fall back to Overview. */
function agreementRoute(
  agreementId: string,
  rest: string | undefined,
  workspaceId?: string,
): AppRoute {
  if (rest === SETUP_SLUG)
    return {
      view: AppView.DraftSetup,
      section: Section.Agreements,
      ...(workspaceId ? { workspaceId } : {}),
      agreementId,
    };
  const tab = rest
    ? [AgreementTab.Terms, AgreementTab.People, AgreementTab.Payments].find(
        (t) => tabSlugs[t] === rest,
      )
    : AgreementTab.Overview;
  if (!tab) return { view: AppView.Section, section: Section.Agreements };
  return {
    view: AppView.Agreement,
    section: Section.Agreements,
    ...(workspaceId ? { workspaceId } : {}),
    agreementId,
    tab,
  };
}

export function parseAppPath(pathname: string): AppRoute {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts[0] !== APP_ROOT.slice(1)) return overview;
  const [, first, ...agreementParts] = parts;
  if (!first) return overview;
  if (first === sectionSlugs[Section.Payouts] && !agreementParts.length)
    return { view: AppView.Section, section: Section.Payouts };
  if (first === sectionSlugs[Section.Settings] && !agreementParts.length)
    return { view: AppView.Section, section: Section.Settings };
  if (first !== sectionSlugs[Section.Agreements]) return overview;
  if (!agreementParts.length)
    return { view: AppView.Section, section: Section.Agreements };
  if (agreementParts[0] === NEW_SLUG && agreementParts.length === 1)
    return { view: AppView.NewAgreement, section: Section.Agreements };
  if (agreementParts[0] === "workspace") {
    const [, workspaceId, agreementId, rest, ...extra] = agreementParts;
    if (
      !workspaceId ||
      !agreementId ||
      extra.length ||
      !ID.test(workspaceId) ||
      !ID.test(agreementId)
    )
      return { view: AppView.Section, section: Section.Agreements };
    return agreementRoute(agreementId, rest, workspaceId);
  }
  const [agreementId, rest, ...extra] = agreementParts;
  if (!agreementId || extra.length || !ID.test(agreementId))
    return { view: AppView.Section, section: Section.Agreements };
  return agreementRoute(agreementId, rest);
}

/** The canonical path for a route. */
export function appPath(route: AppRoute): string {
  const join = (...parts: string[]) =>
    [APP_ROOT, ...parts.filter(Boolean)].join("/");
  switch (route.view) {
    case AppView.NewAgreement:
      return join(sectionSlugs[Section.Agreements], NEW_SLUG);
    case AppView.DraftSetup:
      return join(
        sectionSlugs[Section.Agreements],
        route.workspaceId ? "workspace" : "",
        route.workspaceId ?? "",
        route.agreementId ?? "",
        SETUP_SLUG,
      );
    case AppView.Agreement:
      return join(
        sectionSlugs[Section.Agreements],
        route.workspaceId ? "workspace" : "",
        route.workspaceId ?? "",
        route.agreementId ?? "",
        tabSlugs[route.tab ?? AgreementTab.Overview],
      );
    default:
      return join(sectionSlugs[route.section]);
  }
}

/** Resolves a canonical workspace URL, or a legacy ID-only URL only when unique. */
export function resolveRoutedAgreement<
  T extends { workspaceId: string; id: string },
>(agreements: readonly T[], route: AppRoute): T | undefined {
  if (!route.agreementId) return undefined;
  const matches = agreements.filter(
    (agreement) =>
      agreement.id === route.agreementId &&
      (!route.workspaceId || agreement.workspaceId === route.workspaceId),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Restores the full document when its marker survives after detail unmounts. */
export function routeForHistory<T extends { workspaceId: string; id: string }>(
  route: AppRoute,
  state: unknown,
  agreement: T | undefined,
): AppRoute {
  return agreement &&
    route.view === AppView.Agreement &&
    isFullAgreementHistoryState(state, agreement.workspaceId, agreement.id)
    ? {
        ...route,
        workspaceId: agreement.workspaceId,
        tab: AgreementTab.Document,
      }
    : route;
}

/** True for paths the signed-in app owns (not /login, /invitation, ...). */
export function isAppPath(pathname: string) {
  return pathname === APP_ROOT || pathname.startsWith(`${APP_ROOT}/`);
}

/**
 * History entry markers. The first entry of a signed-in visit is a guard: Back
 * onto it steps forward again, so Back never leaves the app for the landing
 * page or the login form.
 */
export enum AppHistoryMark {
  Guard = "fairshare-guard",
  Entry = "fairshare-entry",
}
export const HISTORY_KEY = "fairshareApp";
const HISTORY_WORKSPACE_KEY = "fairshareWorkspace";

export function historyMark(state: unknown): AppHistoryMark | undefined {
  const value =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)[HISTORY_KEY]
      : undefined;
  return value === AppHistoryMark.Guard || value === AppHistoryMark.Entry
    ? value
    : undefined;
}

/** Keeps whatever the framework stored in the entry and adds our marker. */
export function historyWorkspace(state: unknown): string | undefined {
  const value =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)[HISTORY_WORKSPACE_KEY]
      : undefined;
  return typeof value === "string" && value.length <= 100 ? value : undefined;
}

export function markedState(
  state: unknown,
  mark: AppHistoryMark,
  workspaceId?: string,
) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    [HISTORY_KEY]: mark,
    ...(workspaceId ? { [HISTORY_WORKSPACE_KEY]: workspaceId } : {}),
  };
}

/** An app path from an untrusted value (the login `next` parameter), or /app. */
export function safeAppPath(value: string | null | undefined): string {
  return value && isAppPath(value) && /^[A-Za-z0-9/_-]{1,200}$/.test(value)
    ? appPath(parseAppPath(value))
    : APP_ROOT;
}
