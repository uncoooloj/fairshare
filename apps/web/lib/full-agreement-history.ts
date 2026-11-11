/** State attached only to a collaborator's full-agreement history entry. */
const FULL_AGREEMENT_VIEW = "full-agreement";
const HISTORY_KEY = "fairshareAgreementView";

type HistoryState = Record<string, unknown>;

function record(value: unknown): HistoryState {
  return value !== null && typeof value === "object"
    ? (value as HistoryState)
    : {};
}

/** Preserve router state while marking one workspace/agreement's full view. */
export function fullAgreementHistoryState(
  state: unknown,
  workspaceId: string,
  agreementId: string,
): HistoryState {
  return {
    ...record(state),
    [HISTORY_KEY]: { view: FULL_AGREEMENT_VIEW, workspaceId, agreementId },
  };
}

/** History entries belong only to the agreement that created them. */
export function isFullAgreementHistoryState(
  state: unknown,
  workspaceId: string,
  agreementId: string,
) {
  const marker = record(state)[HISTORY_KEY];
  if (marker === null || typeof marker !== "object") return false;
  const value = marker as Record<string, unknown>;
  return (
    value.view === FULL_AGREEMENT_VIEW &&
    value.workspaceId === workspaceId &&
    value.agreementId === agreementId
  );
}
