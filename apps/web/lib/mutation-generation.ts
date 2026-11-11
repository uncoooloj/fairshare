/** A mutation may only report success while its workspace and agreement view remain current. */
export function mutationIsCurrent(
  startedWorkspaceRequest: number,
  startedOpenRequest: number,
  currentWorkspaceRequest: number,
  currentOpenRequest: number,
): boolean {
  return (
    startedWorkspaceRequest === currentWorkspaceRequest &&
    startedOpenRequest === currentOpenRequest
  );
}
