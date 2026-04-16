import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import {
  AiTool,
  AuthPage,
  Comments,
  GrammarChecker,
  Header,
  LandingPage,
  OrganizationAdminPage,
  ResetPasswordPage,
  RichEditor,
  SavedDocuments,
  SecuritySettingsPage,
  TodoList,
  Toolbar,
  VerifyEmailPage,
  WorkspaceHomePage,
} from './components';
import type { CursorFormat, RichEditorHandle } from './components/editor';
import { authApi, docsApi, versionsApi, workspaceApi } from './lib/api';
import { canvasTextToHtml, htmlToCanvasText } from './lib/contentAdapter';
import { buildDocumentTree } from './lib/documentTree';
import { getInitialWorkspaceSelectionId, persistWorkspaceSelectionId } from './lib/workspaceSelection';
import type { AuthSuccess, AuthUser } from './lib/api';

type SavedVersion = {
  id: string;
  preview: string;
  savedAt: string;
};

type SavedDocument = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  createdAt: string;
  parentId?: string | null;
  workspaceId?: string | null;
  sortOrder?: number;
};

type WorkspaceSummary = {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

type EditorDocNode = SavedDocument & { children: EditorDocNode[] };

type EditorWorkspaceModalState =
  | {
    type: 'transfer-workspace';
    action: 'copy' | 'move';
    docId: string;
    targetId: string;
    options: Array<{ id: string; name: string }>;
    error?: string;
  }
  | { type: 'info'; title: string; message: string };

type RightTool = 'comments' | 'versions' | 'todo' | 'grammar' | 'ai';

const RIGHT_TOOLS: { id: RightTool; icon: string; label: string }[] = [
  { id: 'comments', icon: 'comment', label: 'Comments' },
  { id: 'versions', icon: 'description', label: 'Saved Documents' },
  { id: 'todo', icon: 'checklist', label: 'To-Do List' },
  { id: 'grammar', icon: 'spellcheck', label: 'Grammar Checker' },
  { id: 'ai', icon: 'smart_toy', label: 'AI Assistant' },
];

type Session = AuthSuccess;

// ─── Editor view (all hooks live here, never behind a conditional) ────────────
function EditorView({ token, docId, userName }: { token: string; docId: string; userName: string }) {

  const navigate = useNavigate();

  const editorRef = useRef<RichEditorHandle | null>(null);
  const savePopupRef = useRef<HTMLDivElement | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [, setSavedVersions] = useState<SavedVersion[]>([]);
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => getInitialWorkspaceSelectionId());
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ docId: string; x: number; y: number } | null>(null);
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ targetId: string | null; mode: 'before' | 'after' | 'inside' | 'root' } | null>(null);
  const [workspaceModal, setWorkspaceModal] = useState<EditorWorkspaceModalState | null>(null);
  const [title, setTitle] = useState<string>('');
  const [showSavePopup, setShowSavePopup] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isWorkspacePanelCollapsed, setIsWorkspacePanelCollapsed] = useState(false);
  const [isFullscreenEditor, setIsFullscreenEditor] = useState(false);
  const [pageSize, setPageSize] = useState<'responsive' | 'A3' | 'A4' | 'A5'>('responsive');
  const [cursorFormat, setCursorFormat] = useState<CursorFormat>({
    bold: false,
    italic: false,
    underline: false,
    fontSize: 16,
    lineSpacing: 1.5,
    fontFamily: 'Raleway',
    color: '#1e293b',
    highlightColor: null,
    bullet: false,
    numberList: false,
    hasSpaceBeforeLine: false,
    hasSpaceAfterLine: false,
    imageSelected: false,
    imagePanelOpen: false,
    imageAlign: 'center',
    imageWidthPct: 100,
  });
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  function handleOpenDocClick(docIdValue: string) {
    navigate(`/editor/${docIdValue}`);
  }

  // Load versions from backend on mount
  useEffect(() => {
    if (!docId) return;
    docsApi
      .get(token, docId)
      .then(({ doc }) => {
        const canvasText = htmlToCanvasText(doc.content ?? '');
        setTitle(doc.title ?? '');
        setCurrentText(canvasText);
        editorRef.current?.setContent?.(canvasText);
      })
      .catch(() => {});
  }, [token, docId]);

  useEffect(() => {
    if (!docId) return;
    versionsApi
      .list(token, docId)
      .then(({ versions }) => setSavedVersions(versions))
      .catch(() => {});
  }, [token, docId]);

  useEffect(() => {
    docsApi
      .list(token)
      .then(({ docs }) => setSavedDocuments(docs))
      .catch(() => {});
  }, [token]);

  const saveVersion = useCallback(
    async (previewText?: string) => {
      if (!docId) return;
      const plainText = currentText.trim();
      const preview = (previewText ?? plainText).slice(0, 90);
      if (!preview) return;
      try {
        const { version } = await versionsApi.save(token, docId, canvasTextToHtml(currentText), preview);
        setSavedVersions((prev) => [version, ...prev].slice(0, 20));
      } catch {
        // silent
      }
    },
    [token, docId, currentText],
  );

  const handleEditorChange = useCallback((text: string) => {
    setCurrentText(text);
  }, []);

  const personalWorkspaceName = `${userName}'s Workspace`.toLowerCase();

  useEffect(() => {
    persistWorkspaceSelectionId(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    workspaceApi
      .list(token)
      .then(({ workspaces: available }) => {
        const visible = available.filter((w) => w.name.trim().toLowerCase() !== personalWorkspaceName);
        setWorkspaces(visible);
        if (selectedWorkspaceId !== 'all' && !visible.some((w) => w.id === selectedWorkspaceId)) {
          setSelectedWorkspaceId('all');
        }
      })
      .catch(() => {});
  }, [token, personalWorkspaceName, selectedWorkspaceId]);

  const filteredLeftDocs = useMemo(() => {
    let result = savedDocuments;
    if (selectedWorkspaceId === 'all') result = result.filter((d) => !d.workspaceId);
    else result = result.filter((d) => d.workspaceId === selectedWorkspaceId);

    const q = navSearchQuery.trim().toLowerCase();
    if (q) result = result.filter((d) => `${d.title} ${d.preview}`.toLowerCase().includes(q));
    return result;
  }, [savedDocuments, selectedWorkspaceId, navSearchQuery]);

  const leftDocTree = useMemo(() => buildDocumentTree(filteredLeftDocs) as EditorDocNode[], [filteredLeftDocs]);

  const activeWorkspaceName = useMemo(() => {
    if (selectedWorkspaceId === 'all') return 'My Workspace';
    return workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? 'My Workspace';
  }, [selectedWorkspaceId, workspaces]);

  const workspaceOptions = useMemo(
    () => [{ id: 'all', name: 'My Workspace' }, ...workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))],
    [workspaces],
  );

  function getDescendantIds(docIdValue: string): Set<string> {
    const descendants = new Set<string>();
    const queue = [docIdValue];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const children = savedDocuments.filter((d) => d.parentId === current).map((d) => d.id);
      for (const childId of children) {
        if (descendants.has(childId)) continue;
        descendants.add(childId);
        queue.push(childId);
      }
    }

    return descendants;
  }

  async function moveDocToWorkspace(docIdValue: string, targetWorkspaceId: string | null) {
    const doc = savedDocuments.find((d) => d.id === docIdValue);
    if (!doc) return;

    const siblings = savedDocuments.filter((d) => (d.workspaceId ?? null) === targetWorkspaceId && (d.parentId ?? null) === null);
    const targetSortOrder = siblings.reduce((max, d) => Math.max(max, d.sortOrder ?? 0), 0) + 1;

    try {
      await docsApi.update(token, docIdValue, {
        workspaceId: targetWorkspaceId,
        parentId: null,
        sortOrder: targetSortOrder,
      });
      const { docs: list } = await docsApi.list(token);
      setSavedDocuments(list);
      setWorkspaceModal(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to move document';
      setWorkspaceModal((prev) =>
        prev && prev.type === 'transfer-workspace' ? { ...prev, error: message } : prev,
      );
    }
  }

  async function copyDocToWorkspace(docIdValue: string, targetWorkspaceId: string | null) {
    const doc = savedDocuments.find((d) => d.id === docIdValue);
    if (!doc) return;

    try {
      const { doc: source } = await docsApi.get(token, docIdValue);
      await docsApi.create(token, source.title || 'Untitled', source.content || '', null, targetWorkspaceId);
      const { docs: list } = await docsApi.list(token);
      setSavedDocuments(list);
      setWorkspaceModal(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to copy document';
      setWorkspaceModal((prev) =>
        prev && prev.type === 'transfer-workspace' ? { ...prev, error: message } : prev,
      );
    }
  }

  function openWorkspaceTransferModal(docIdValue: string, action: 'copy' | 'move') {
    const doc = savedDocuments.find((d) => d.id === docIdValue);
    if (!doc) return;

    const options = workspaceOptions.filter((w) => (w.id === 'all' ? null : w.id) !== (doc.workspaceId ?? null));
    if (options.length === 0) {
      setWorkspaceModal({
        type: 'info',
        title: 'No Other Workspace',
        message: 'There is no other workspace available for this action.',
      });
      return;
    }

    setWorkspaceModal({
      type: 'transfer-workspace',
      action,
      docId: docIdValue,
      targetId: options[0].id,
      options,
    });
  }

  function openDocContextMenu(event: React.MouseEvent<HTMLDivElement>, docIdValue: string) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 90;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ docId: docIdValue, x: Math.max(8, x), y: Math.max(8, y) });
  }

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (contextMenuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  async function moveDocWithDrag(docIdValue: string, targetId: string | null, mode: 'before' | 'after' | 'inside' | 'root') {
    const moved = savedDocuments.find((d) => d.id === docIdValue);
    if (!moved) return;

    const descendants = getDescendantIds(docIdValue);
    let destinationParentId: string | null = null;
    let destinationWorkspaceId: string | null = moved.workspaceId ?? null;
    let destinationSiblings: SavedDocument[] = [];
    let insertIndex = 0;

    if (mode === 'root') {
      destinationWorkspaceId = selectedWorkspaceId === 'all' ? null : selectedWorkspaceId;
      destinationParentId = null;
      destinationSiblings = savedDocuments
        .filter(
          (d) =>
            d.id !== docIdValue &&
            (d.workspaceId ?? null) === destinationWorkspaceId &&
            (d.parentId ?? null) === null,
        )
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      insertIndex = destinationSiblings.length;
    } else {
      const target = savedDocuments.find((d) => d.id === targetId);
      if (!target || target.id === docIdValue) return;
      destinationWorkspaceId = target.workspaceId ?? null;
      destinationParentId = mode === 'inside' ? target.id : (target.parentId ?? null);

      if (descendants.has(target.id) || (destinationParentId && descendants.has(destinationParentId))) {
        return;
      }

      destinationSiblings = savedDocuments
        .filter(
          (d) =>
            d.id !== docIdValue &&
            (d.workspaceId ?? null) === destinationWorkspaceId &&
            (d.parentId ?? null) === destinationParentId,
        )
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      if (mode === 'inside') {
        insertIndex = destinationSiblings.length;
      } else {
        const targetIdx = destinationSiblings.findIndex((d) => d.id === target.id);
        if (targetIdx < 0) return;
        insertIndex = mode === 'before' ? targetIdx : targetIdx + 1;
      }
    }

    const sameGroup =
      (moved.workspaceId ?? null) === destinationWorkspaceId &&
      (moved.parentId ?? null) === destinationParentId;

    const newDestination = [...destinationSiblings];
    newDestination.splice(insertIndex, 0, moved);

    try {
      const updates: Array<Promise<unknown>> = [];

      if (!sameGroup) {
        const oldSiblings = savedDocuments
          .filter(
            (d) =>
              d.id !== docIdValue &&
              (d.workspaceId ?? null) === (moved.workspaceId ?? null) &&
              (d.parentId ?? null) === (moved.parentId ?? null),
          )
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        oldSiblings.forEach((doc, idx) => {
          const nextOrder = idx + 1;
          if ((doc.sortOrder ?? 0) !== nextOrder) {
            updates.push(docsApi.update(token, doc.id, { sortOrder: nextOrder }));
          }
        });
      }

      newDestination.forEach((doc, idx) => {
        const nextOrder = idx + 1;
        if (doc.id === moved.id) {
          updates.push(
            docsApi.update(token, doc.id, {
              workspaceId: destinationWorkspaceId,
              parentId: destinationParentId,
              sortOrder: nextOrder,
            }),
          );
          return;
        }
        if ((doc.sortOrder ?? 0) !== nextOrder) {
          updates.push(docsApi.update(token, doc.id, { sortOrder: nextOrder }));
        }
      });

      await Promise.all(updates);
      const { docs: list } = await docsApi.list(token);
      setSavedDocuments(list);
      if (destinationParentId) {
        setExpandedNodes((prev) => new Set([...prev, destinationParentId]));
      }
    } catch {
      // silent for now
    }
  }

  function handleDragStart(event: React.DragEvent<HTMLDivElement>, docIdValue: string) {
    setDragDocId(docIdValue);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', docIdValue);
  }

  function handleDragEnd() {
    setDragDocId(null);
    setDropHint(null);
  }

  function handleDragOverRow(event: React.DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    if (!dragDocId || dragDocId === targetId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const zone = rect.height * 0.25;
    const mode: 'before' | 'after' | 'inside' = y < zone ? 'before' : y > rect.height - zone ? 'after' : 'inside';
    setDropHint({ targetId, mode });
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDropOnRow(event: React.DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    if (!dragDocId || dragDocId === targetId || !dropHint || dropHint.targetId !== targetId) {
      setDropHint(null);
      return;
    }
    void moveDocWithDrag(dragDocId, targetId, dropHint.mode);
    setDropHint(null);
  }

  function handleDragOverRoot(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!dragDocId) return;
    setDropHint({ targetId: null, mode: 'root' });
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDropOnRoot(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!dragDocId) return;
    void moveDocWithDrag(dragDocId, null, 'root');
    setDropHint(null);
  }

  function toggleExpanded(id: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderLeftDocNode(node: EditorDocNode, numberStr: string, depth: number): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    return (
      <div key={node.id}>
        <div
          draggable
          onDragStart={(event) => handleDragStart(event, node.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(event) => handleDragOverRow(event, node.id)}
          onDrop={(event) => handleDropOnRow(event, node.id)}
          onContextMenu={(event) => openDocContextMenu(event, node.id)}
          className={`group flex items-center gap-1 rounded-lg py-1.5 pr-1 transition-colors hover:bg-cyan-50 ${dragDocId === node.id ? 'opacity-50' : ''} ${dropHint?.targetId === node.id && dropHint.mode === 'inside' ? 'bg-cyan-50 ring-1 ring-cyan-200' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-cyan-600 ${!hasChildren ? 'invisible' : ''}`}
          >
            <span className="material-icons" style={{ fontSize: '0.85rem' }}>
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
          </button>
          <div className="flex h-5 shrink-0 items-center justify-center rounded bg-cyan-100 px-1.5 text-[10px] font-bold text-cyan-700" style={{ minWidth: '20px' }}>
            {numberStr}
          </div>
          <button
            type="button"
            onClick={() => handleOpenDocClick(node.id)}
            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-700 hover:text-cyan-700"
          >
            {node.title || 'Untitled'}
          </button>
        </div>
        {dropHint?.targetId === node.id && dropHint.mode === 'before' && (
          <div className="ml-2 h-0.5 rounded bg-cyan-500" />
        )}
        {isExpanded && node.children.map((child, i) => renderLeftDocNode(child, `${numberStr}.${i + 1}`, depth + 1))}
        {dropHint?.targetId === node.id && dropHint.mode === 'after' && (
          <div className="ml-2 h-0.5 rounded bg-cyan-500" />
        )}
      </div>
    );
  }

  useEffect(() => {
    if (!showSavePopup) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!savePopupRef.current?.contains(target)) setShowSavePopup(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [showSavePopup]);

  const handleTitleChange = useCallback((t: string) => setTitle(t), []);
  const [activeTool, setActiveTool] = useState<RightTool | null>(null);

  useEffect(() => {
    const openComments = () => setActiveTool('comments');
    const openSpelling = () => setActiveTool('grammar');

    window.addEventListener('docsync:open-comments', openComments);
    window.addEventListener('docsync:open-spelling', openSpelling);

    return () => {
      window.removeEventListener('docsync:open-comments', openComments);
      window.removeEventListener('docsync:open-spelling', openSpelling);
    };
  }, []);

  const handleSaveDocument = useCallback(async () => {
    const trimmed = saveMessage.trim();
    if (docId) {
      try {
        await docsApi.update(token, docId, { title, content: canvasTextToHtml(currentText) });
        const { docs } = await docsApi.list(token);
        setSavedDocuments(docs);
      } catch {
        // silent
      }
    }
    await saveVersion(trimmed.length > 0 ? trimmed : undefined);
    setShowSavePopup(false);
    setSaveMessage('');
  }, [saveMessage, saveVersion, token, docId, title, currentText]);

  const handlePublishDocument = useCallback(async () => {
    if (docId) {
      try {
        await docsApi.update(token, docId, { title, content: canvasTextToHtml(currentText) });
        const { docs } = await docsApi.list(token);
        setSavedDocuments(docs);
      } catch {
        // silent
      }
    }
    await saveVersion();
    window.alert('Document published successfully.');
  }, [saveVersion, token, docId, title, currentText]);

  const docText = currentText;

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-linear-to-br from-slate-100 via-white to-cyan-50">
      <aside
        className={`hidden border-r border-slate-200 bg-white transition-all duration-300 lg:flex lg:flex-col ${
          isWorkspacePanelCollapsed ? 'lg:w-14 lg:shrink-0' : 'lg:w-80 lg:shrink-0'
        }`}
      >
        {isWorkspacePanelCollapsed ? (
          <div className="flex h-full flex-col items-center px-2 py-2">
            <button
              type="button"
              onClick={() => setIsWorkspacePanelCollapsed(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100"
              title="Show workspace panel"
              aria-label="Show workspace panel"
            >
              <span className="material-icons" style={{ fontSize: '1rem' }}>keyboard_double_arrow_right</span>
            </button>
            <div className="flex min-h-0 flex-1 items-center justify-center py-2">
              <p
                className="max-h-full overflow-hidden text-sm font-semibold text-slate-700"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', whiteSpace: 'nowrap', transform: 'rotate(180deg)', transformOrigin: 'center' }}
                title={`${activeWorkspaceName} | ${title.trim() || 'Untitled'}`}
              >
                <span className="text-cyan-700">{activeWorkspaceName}</span>
                <span className="text-slate-400"> | </span>
                <span className="text-slate-700">{title.trim() || 'Untitled'}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden p-5">
            <div className="mb-4 shrink-0 border-b border-slate-200/60 pb-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-100">
                    <span className="material-icons text-cyan-700" style={{ fontSize: '1rem' }}>menu_book</span>
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Book</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsWorkspacePanelCollapsed(true)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100"
                  title="Hide workspace panel"
                  aria-label="Hide workspace panel"
                >
                  <span className="material-icons" style={{ fontSize: '0.9rem' }}>keyboard_double_arrow_left</span>
                </button>
              </div>
              <p className="truncate text-base font-black text-slate-800">{activeWorkspaceName}</p>
              <p className="mt-1 text-[10px] text-slate-400">Table of Contents</p>
            </div>

            <div className="mb-3 shrink-0 space-y-2">
              <div className="relative">
                <span className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: '0.9rem' }}>search</span>
                <input
                  value={navSearchQuery}
                  onChange={(e) => setNavSearchQuery(e.target.value)}
                  placeholder="Find chapter..."
                  className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none focus:bg-white focus:ring-1 focus:ring-cyan-400"
                />
              </div>
              <div className="relative">
                <select
                  value={selectedWorkspaceId}
                  onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                  className="w-full cursor-pointer appearance-none rounded-lg bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-cyan-400"
                >
                  <option value="all">My Workspace</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                  ))}
                </select>
                <span className="material-icons pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: '0.9rem' }}>expand_more</span>
              </div>
            </div>

            <p className="mb-1 shrink-0 px-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Chapters ({filteredLeftDocs.length})
            </p>

            <div
              onDragOver={handleDragOverRoot}
              onDrop={handleDropOnRoot}
              className={`mb-2 shrink-0 rounded-md border border-dashed px-2 py-1 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
                dropHint?.mode === 'root' ? 'border-cyan-300 bg-cyan-50 text-cyan-700' : 'border-slate-200 text-slate-400'
              }`}
            >
              Drop Here To Move To Root
            </div>

            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
              {leftDocTree.length === 0 ? (
                <div className="p-4 text-center">
                  <span className="material-icons mx-auto mb-2 block text-2xl text-slate-300">article</span>
                  <p className="text-xs text-slate-500">No chapters yet</p>
                </div>
              ) : (
                leftDocTree.map((node, i) => renderLeftDocNode(node, `${i + 1}`, 0))
              )}
            </div>

            <div className="mt-3 shrink-0 border-t border-slate-200/60 pt-3 text-[10px] text-slate-400">
              {filteredLeftDocs.length} chapter{filteredLeftDocs.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </aside>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!isFullscreenEditor && <Header />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <main className="flex min-h-0 flex-1 overflow-hidden px-4 py-1 sm:px-6 lg:px-8 lg:py-3">
            <div className="flex min-h-0 w-full flex-col">
              {!isFullscreenEditor && (
                <div className="mb-1 flex items-center gap-2 border-b border-slate-200 px-1 pb-1">
                  <input
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Untitled document"
                    className="w-full bg-transparent px-2 py-1 text-sm font-semibold text-slate-800 outline-none"
                  />
                  <div className="relative" ref={savePopupRef}>
                    <button
                      type="button"
                      onClick={() => setShowSavePopup((prev) => !prev)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      Save
                    </button>
                    {showSavePopup && (
                      <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                          Save message
                        </label>
                        <textarea
                          value={saveMessage}
                          onChange={(e) => setSaveMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleSaveDocument();
                            }
                            if (e.key === 'Escape') setShowSavePopup(false);
                          }}
                          placeholder="What changed?"
                          className="mb-2 h-20 w-full resize-none rounded border border-slate-300 px-2 py-2 text-xs leading-4 text-slate-700 outline-none placeholder:align-top focus:border-cyan-500"
                          autoFocus
                        />
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setShowSavePopup(false)}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveDocument()}
                            className="rounded bg-cyan-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-cyan-700"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePublishDocument()}
                    className="rounded-md bg-cyan-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-cyan-700"
                  >
                    Publish
                  </button>
                </div>
              )}
              <Toolbar
                editorRef={editorRef}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                isFullscreen={isFullscreenEditor}
                onToggleFullscreen={() => setIsFullscreenEditor((p) => !p)}
                cursorFormat={cursorFormat}
              />
              <RichEditor
                ref={editorRef}
                onContentChange={handleEditorChange}
                onCursorFormatChange={setCursorFormat}
                pageSize={pageSize}
              />
            </div>
          </main>
          <div className="flex shrink-0 items-stretch">
            <div
              className={`flex flex-col border-l border-slate-200/70 bg-white/90 backdrop-blur-sm shadow-xl transition-all duration-300 overflow-hidden ${activeTool ? 'w-80' : 'w-0'}`}
            >
              <div className="h-full w-80 overflow-auto p-4">
                {activeTool === 'comments' && (
                  <Comments
                    docId={docId}
                    token={token}
                    onCommentAdded={() => {
                      void saveVersion();
                    }}
                  />
                )}
                {activeTool === 'versions' && (
                  <SavedDocuments
                    documents={savedDocuments}
                    onOpen={(id) => {
                      navigate(`/editor/${id}`);
                    }}
                  />
                )}
                {activeTool === 'todo' && <TodoList docId={docId} token={token} />}
                {activeTool === 'grammar' && <GrammarChecker token={token} docText={docText} />}
                {activeTool === 'ai' && <AiTool token={token} />}
              </div>
            </div>

            {/* Icon strip - always visible */}
            <div className="flex w-12 flex-col items-center gap-1 border-l border-slate-200/70 bg-white/75 backdrop-blur-sm pt-3">
              {RIGHT_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool((prev) => (prev === tool.id ? null : tool.id))}
                  title={tool.label}
                  className={`flex h-10 w-10 flex-col items-center justify-center rounded-lg transition-colors ${
                    activeTool === tool.id
                      ? 'bg-cyan-100 text-cyan-600'
                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  }`}
                >
                  <span className="material-icons" style={{ fontSize: '1.2rem' }}>
                    {tool.icon}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="fixed z-[80] min-w-[170px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Document actions"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-cyan-50 hover:text-cyan-700"
            onClick={() => {
              openWorkspaceTransferModal(contextMenu.docId, 'copy');
              setContextMenu(null);
            }}
          >
            <span className="material-icons" style={{ fontSize: '0.9rem' }}>content_copy</span>
            Copy to
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-cyan-50 hover:text-cyan-700"
            onClick={() => {
              openWorkspaceTransferModal(contextMenu.docId, 'move');
              setContextMenu(null);
            }}
          >
            <span className="material-icons" style={{ fontSize: '0.9rem' }}>drive_file_move</span>
            Move to
          </button>
        </div>
      )}

      {workspaceModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            {workspaceModal.type === 'transfer-workspace' && (
              <>
                <h3 className="text-base font-bold text-slate-800">
                  {workspaceModal.action === 'copy' ? 'Copy To Workspace' : 'Move To Workspace'}
                </h3>
                <p className="mt-1 text-xs text-slate-500">Choose a target workspace.</p>
                <select
                  value={workspaceModal.targetId}
                  onChange={(event) =>
                    setWorkspaceModal((prev) =>
                      prev && prev.type === 'transfer-workspace'
                        ? { ...prev, targetId: event.target.value, error: undefined }
                        : prev,
                    )
                  }
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-cyan-400"
                >
                  {workspaceModal.options.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
                {workspaceModal.error && <p className="mt-2 text-xs text-red-600">{workspaceModal.error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWorkspaceModal(null)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const targetWorkspaceId = workspaceModal.targetId === 'all' ? null : workspaceModal.targetId;
                      if (workspaceModal.action === 'copy') {
                        void copyDocToWorkspace(workspaceModal.docId, targetWorkspaceId);
                      } else {
                        void moveDocToWorkspace(workspaceModal.docId, targetWorkspaceId);
                      }
                    }}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}

            {workspaceModal.type === 'info' && (
              <>
                <h3 className="text-base font-bold text-slate-800">{workspaceModal.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{workspaceModal.message}</p>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setWorkspaceModal(null)}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
                  >
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyDocumentView({ token, docId, userName }: { token: string; docId: string; userName: string }) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => getInitialWorkspaceSelectionId());
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [currentDoc, setCurrentDoc] = useState<{ id: string; title: string; content: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const personalWorkspaceName = `${userName}'s Workspace`.toLowerCase();

  const viewerPlainText = useMemo(() => {
    return htmlToCanvasText(currentDoc?.content ?? '');
  }, [currentDoc?.content]);

  const filteredLeftDocs = useMemo(() => {
    let result = savedDocuments;
    if (selectedWorkspaceId === 'all') result = result.filter((d) => !d.workspaceId);
    else result = result.filter((d) => d.workspaceId === selectedWorkspaceId);

    const query = navSearchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((d) => `${d.title} ${d.preview}`.toLowerCase().includes(query));
    }

    return result;
  }, [savedDocuments, selectedWorkspaceId, navSearchQuery]);

  const leftDocTree = useMemo(() => buildDocumentTree(filteredLeftDocs) as EditorDocNode[], [filteredLeftDocs]);

  const currentDocSummary = useMemo(
    () => savedDocuments.find((doc) => doc.id === docId) ?? null,
    [savedDocuments, docId],
  );

  const modifiedAtLabel = useMemo(() => {
    if (!currentDocSummary?.updatedAt) return 'Unknown time';
    const date = new Date(currentDocSummary.updatedAt);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [currentDocSummary?.updatedAt]);

  const activeWorkspaceName = useMemo(() => {
    if (selectedWorkspaceId === 'all') return 'My Workspace';
    return workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? 'My Workspace';
  }, [selectedWorkspaceId, workspaces]);

  function toggleExpanded(id: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderReadOnlyNode(node: EditorDocNode, numberStr: string, depth: number): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 rounded-lg py-1.5 pr-1 transition-colors hover:bg-cyan-50 ${
            node.id === docId ? 'bg-cyan-50/70' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-cyan-600 ${!hasChildren ? 'invisible' : ''}`}
          >
            <span className="material-icons" style={{ fontSize: '0.85rem' }}>
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
          </button>
          <div
            className="flex h-5 shrink-0 items-center justify-center rounded bg-cyan-100 px-1.5 text-[10px] font-bold text-cyan-700"
            style={{ minWidth: '20px' }}
          >
            {numberStr}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/viewer/${node.id}`)}
            className={`min-w-0 flex-1 truncate text-left text-xs font-medium transition-colors ${
              node.id === docId ? 'text-cyan-700' : 'text-slate-700 hover:text-cyan-700'
            }`}
          >
            {node.title || 'Untitled'}
          </button>
        </div>
        {isExpanded && node.children.map((child, i) => renderReadOnlyNode(child, `${numberStr}.${i + 1}`, depth + 1))}
      </div>
    );
  }

  useEffect(() => {
    persistWorkspaceSelectionId(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    let ignore = false;

    async function loadViewerData() {
      setIsLoading(true);
      setError('');

      try {
        const [{ docs }, { doc }, { workspaces: available }] = await Promise.all([
          docsApi.list(token),
          docsApi.get(token, docId),
          workspaceApi.list(token),
        ]);
        if (ignore) return;
        setSavedDocuments(docs);
        setCurrentDoc(doc);
        const visible = available.filter((workspace) => workspace.name.trim().toLowerCase() !== personalWorkspaceName);
        setWorkspaces(visible);
        if (selectedWorkspaceId !== 'all' && !visible.some((workspace) => workspace.id === selectedWorkspaceId)) {
          setSelectedWorkspaceId('all');
        }
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : 'Failed to load document');
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    void loadViewerData();
    return () => {
      ignore = true;
    };
  }, [token, docId, selectedWorkspaceId, personalWorkspaceName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading || error || !currentDoc) return;

    const drawCanvas = () => {
      const hostWidth = canvas.parentElement?.clientWidth ?? 0;
      if (hostWidth <= 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpi = window.devicePixelRatio || 1;
      const padX = 20;
      const padTop = 18;
      const padBottom = 24;
      const maxTextWidth = Math.max(hostWidth - padX * 2, 60);
      const bodyText = viewerPlainText || 'No content available.';

      const wrapText = (text: string, font: string) => {
        ctx.font = font;
        const lines: string[] = [];
        const paragraphs = text.split('\n');
        for (const paragraph of paragraphs) {
          const trimmed = paragraph.trim();
          if (!trimmed) {
            lines.push('');
            continue;
          }
          const words = trimmed.split(/\s+/);
          let line = words[0] ?? '';
          for (let i = 1; i < words.length; i += 1) {
            const candidate = `${line} ${words[i]}`;
            if (ctx.measureText(candidate).width <= maxTextWidth) {
              line = candidate;
            } else {
              lines.push(line);
              line = words[i] ?? '';
            }
          }
          lines.push(line);
        }
        return lines;
      };

      const title = (currentDoc.title || 'Untitled').trim();
      const metadataLine = `Modified ${modifiedAtLabel} by ${userName}`;
      const titleLines = wrapText(title, '700 30px Raleway, sans-serif');
      const metaLines = wrapText(metadataLine, '500 13px Raleway, sans-serif');
      const bodyLines = wrapText(bodyText, '400 17px Raleway, sans-serif');

      const titleLineHeight = 38;
      const metaLineHeight = 20;
      const bodyLineHeight = 30;
      const titleHeight = Math.max(titleLines.length, 1) * titleLineHeight;
      const metaHeight = Math.max(metaLines.length, 1) * metaLineHeight;
      const bodyHeight = Math.max(bodyLines.length, 1) * bodyLineHeight;
      const separatorGapTop = 8;
      const metaGapToBody = 10;
      const cssHeight = padTop + titleHeight + separatorGapTop + metaHeight + metaGapToBody + bodyHeight + padBottom;

      canvas.style.width = `${hostWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.max(1, Math.floor(hostWidth * dpi));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpi));

      ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
      ctx.clearRect(0, 0, hostWidth, cssHeight);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, hostWidth, cssHeight);

      ctx.fillStyle = '#0f172a';
      ctx.font = '700 30px Raleway, sans-serif';
      titleLines.forEach((line, index) => {
        ctx.fillText(line, padX, padTop + (index + 1) * titleLineHeight - 8);
      });

      const dividerY = padTop + titleHeight + 2;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, dividerY);
      ctx.lineTo(hostWidth - padX, dividerY);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '500 13px Raleway, sans-serif';
      const metaStartY = dividerY + separatorGapTop;
      metaLines.forEach((line, index) => {
        ctx.fillText(line, padX, metaStartY + (index + 1) * metaLineHeight - 8);
      });

      ctx.fillStyle = '#334155';
      ctx.font = '400 17px Raleway, sans-serif';
      const bodyStartY = metaStartY + metaHeight + metaGapToBody;
      bodyLines.forEach((line, index) => {
        ctx.fillText(line, padX, bodyStartY + (index + 1) * bodyLineHeight - 8);
      });
    };

    drawCanvas();
    window.addEventListener('resize', drawCanvas);
    return () => {
      window.removeEventListener('resize', drawCanvas);
    };
  }, [currentDoc, viewerPlainText, isLoading, error, modifiedAtLabel, userName]);

  return (
    <div className="flex h-screen overflow-hidden bg-linear-to-br from-slate-100 via-white to-cyan-50">
      <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col overflow-hidden p-5">
          <div className="mb-4 shrink-0 border-b border-slate-200/60 pb-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-100">
                <span className="material-icons text-cyan-700" style={{ fontSize: '1rem' }}>menu_book</span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Book</p>
            </div>
            <p className="truncate text-base font-black text-slate-800">{activeWorkspaceName}</p>
            <p className="mt-1 text-[10px] text-slate-400">Table of Contents</p>
          </div>

          <div className="mb-3 shrink-0 space-y-2">
            <div className="relative">
              <span className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: '0.9rem' }}>search</span>
              <input
                value={navSearchQuery}
                onChange={(e) => setNavSearchQuery(e.target.value)}
                placeholder="Find chapter..."
                className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none focus:bg-white focus:ring-1 focus:ring-cyan-400"
              />
            </div>
            <div className="relative">
              <select
                value={selectedWorkspaceId}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-lg bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-cyan-400"
              >
                <option value="all">My Workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
              <span className="material-icons pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: '0.9rem' }}>expand_more</span>
            </div>
          </div>

          <p className="mb-1 shrink-0 px-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Chapters ({filteredLeftDocs.length})
          </p>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            {leftDocTree.length === 0 ? (
              <div className="p-4 text-center">
                <span className="material-icons mx-auto mb-2 block text-2xl text-slate-300">article</span>
                <p className="text-xs text-slate-500">No chapters yet</p>
              </div>
            ) : (
              leftDocTree.map((node, i) => renderReadOnlyNode(node, `${i + 1}`, 0))
            )}
          </div>

          <div className="mt-3 shrink-0 border-t border-slate-200/60 pt-3 text-[10px] text-slate-400">
            {filteredLeftDocs.length} chapter{filteredLeftDocs.length !== 1 ? 's' : ''}
          </div>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto bg-white">
        <div className="w-full">
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:px-5">
            <h1 className="text-sm font-bold tracking-wide text-slate-700">Document Viewer</h1>
            <button
              type="button"
              onClick={() => navigate('/workspace')}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Back To Workspace
            </button>
          </div>

          {isLoading && (
            <div className="px-4 py-6 text-center text-sm font-medium text-slate-500 sm:px-5">
              Loading document...
            </div>
          )}

          {!isLoading && error && (
            <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 sm:mx-5">
              {error}
            </div>
          )}

          {!isLoading && !error && currentDoc && (
            <article className="bg-white">
              <canvas ref={canvasRef} className="block w-full" aria-label="Document canvas" />
            </article>
          )}
        </div>
      </main>
    </div>
  );
}


// ─── App shell ────────────────────────────────────────────────────────────────
function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    authApi
      .refresh()
      .then((auth) => {
        if (cancelled) return;
        setSession(auth);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSession = useCallback(async () => {
    const auth = await authApi.refresh();
    setSession(auth);
    return auth;
  }, []);

  useEffect(() => {
    if (!session) return;
    const refreshAt = new Date(session.accessTokenExpiresAt).getTime() - Date.now() - 60_000;
    const timeout = window.setTimeout(() => {
      void refreshSession().catch(() => {
        setSession(null);
        navigate('/auth', { replace: true });
      });
    }, Math.max(refreshAt, 5_000));

    return () => window.clearTimeout(timeout);
  }, [navigate, refreshSession, session]);

  const handleAuthSuccess = useCallback(
    async (auth: AuthSuccess) => {
      setSession(auth);
      navigate('/workspace', { replace: true });
    },
    [navigate],
  );

  const handleUserUpdate = useCallback((user: AuthUser) => {
    setSession((current) => (current ? { ...current, user } : current));
  }, []);

  const handleOpenDocument = useCallback((docId: string) => {
    navigate(`/editor/${docId}`);
  }, [navigate]);

  const handleOpenReadOnlyDocument = useCallback((docId: string) => {
    navigate(`/viewer/${docId}`);
  }, [navigate]);

  const handleCreateDocument = useCallback(
    async (title: string, content: string, workspaceId?: string | null) => {
      if (!session) return;
      const { doc } = await docsApi.create(session.accessToken, title, content, null, workspaceId ?? null);
      navigate(`/editor/${doc.id}`);
    },
    [navigate, session],
  );

  const handleLogout = useCallback(async () => {
    try {
      if (session) await authApi.logout(session.accessToken);
    } catch {
      // Logout still clears local auth state.
    } finally {
      setSession(null);
      navigate('/auth', { replace: true });
    }
  }, [navigate, session]);

  const handleOpenSecuritySettings = useCallback(() => {
    navigate('/security');
  }, [navigate]);

  const handleOpenOrganizationAdmin = useCallback(() => {
    navigate('/organization-admin');
  }, [navigate]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-600">
        Restoring your secure session...
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          session ? (
            <Navigate to="/workspace" replace />
          ) : (
            <LandingPage
              onGetStarted={() => navigate('/auth')}
              onSignIn={() => navigate('/auth')}
            />
          )
        }
      />
      <Route
        path="/auth"
        element={session ? <Navigate to="/workspace" replace /> : <AuthPage onAuthSuccess={handleAuthSuccess} />}
      />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/security"
        element={
          session ? (
            <SecuritySettingsPage
              token={session.accessToken}
              user={session.user}
              onUserUpdate={handleUserUpdate}
              onLoggedOut={() => {
                setSession(null);
                navigate('/auth', { replace: true });
              }}
            />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/workspace"
        element={
          session ? (
            <WorkspaceHomePage
              token={session.accessToken}
              userName={session.user.name}
              onOpenDocument={handleOpenDocument}
              onOpenReadOnlyDocument={handleOpenReadOnlyDocument}
              onCreateDocument={handleCreateDocument}
              onOpenSecuritySettings={handleOpenSecuritySettings}
              onOpenOrganizationAdmin={handleOpenOrganizationAdmin}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/organization-admin"
        element={
          session ? (
            <OrganizationAdminPage token={session.accessToken} userName={session.user.name} />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/editor/:docId"
        element={
          session ? <EditorRoute token={session.accessToken} userName={session.user.name} /> : <Navigate to="/auth" replace />
        }
      />
      <Route
        path="/viewer/:docId"
        element={
          session ? <ReadOnlyDocumentRoute token={session.accessToken} userName={session.user.name} /> : <Navigate to="/auth" replace />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function EditorRoute({ token, userName }: { token: string; userName: string }) {
  const { docId = '' } = useParams();
  if (!docId) return <Navigate to="/workspace" replace />;
  return <EditorView token={token} docId={docId} userName={userName} />;
}

function ReadOnlyDocumentRoute({ token, userName }: { token: string; userName: string }) {
  const { docId = '' } = useParams();
  if (!docId) return <Navigate to="/workspace" replace />;
  return <ReadOnlyDocumentView token={token} docId={docId} userName={userName} />;
}

export default App;
