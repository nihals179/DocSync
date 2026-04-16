const WORKSPACE_SELECTION_STORAGE_KEY = 'docsync:selectedWorkspaceId';

export function getInitialWorkspaceSelectionId() {
  try {
    return localStorage.getItem(WORKSPACE_SELECTION_STORAGE_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

export function persistWorkspaceSelectionId(workspaceId: string) {
  try {
    localStorage.setItem(WORKSPACE_SELECTION_STORAGE_KEY, workspaceId);
  } catch {
    // Ignore storage errors (e.g. private mode)
  }
}
