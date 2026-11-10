export interface WorkspaceNameDraft {
  draft: string;
  serverName: string;
  dirty: boolean;
}
export const initialWorkspaceName = (name: string): WorkspaceNameDraft => ({
  draft: name,
  serverName: name,
  dirty: false,
});
export function workspaceNameDraft(
  state: WorkspaceNameDraft,
  action: { type: "edit" | "refresh"; name: string },
): WorkspaceNameDraft {
  if (action.type === "edit")
    return {
      ...state,
      draft: action.name,
      dirty: action.name !== state.serverName,
    };
  if (!state.dirty || action.name === state.draft.trim())
    return initialWorkspaceName(action.name);
  return { ...state, serverName: action.name };
}
