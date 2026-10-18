import type { AuthSuccess } from '../services/api';

export type SavedVersion = {
  id: string;
  preview: string;
  savedAt: string;
};

export type SavedDocument = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  parentId?: string | null;
  workspaceId?: string | null;
  sortOrder?: number;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type EditorDocNode = SavedDocument & { children: EditorDocNode[] };

export type EditorWorkspaceModalState =
  | {
    type: 'transfer-workspace';
    action: 'copy' | 'move';
    docId: string;
    targetId: string;
    options: Array<{ id: string; name: string }>;
    error?: string;
  }
  | { type: 'info'; title: string; message: string };

export type RightTool = 'comments' | 'versions' | 'todo' | 'grammar' | 'ai' | 'html';

export type Session = AuthSuccess;
