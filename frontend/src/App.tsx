import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

import Header from './components/features/layout/Header';
import RichEditor from './components/editor/RichEditor';
import Toolbar from './components/toolbar/Toolbar';
import ThemeListbox from './components/common/ThemeListbox';
import type { CursorFormat, RichEditorHandle, Run } from './components/editor';
import { isPageSize, type PageSize } from './components/editor/pageConfig';
import { authApi, clearPersistedCsrfToken, docsApi, persistCsrfToken, setUnauthorizedHandler, versionsApi, workspaceApi } from './lib/api';
import { canvasRunsToHtml, canvasTextToHtml, htmlToRuns } from './lib/contentAdapter';
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

type RightTool = 'comments' | 'versions' | 'todo' | 'grammar' | 'ai' | 'html';

const RIGHT_TOOLS: { id: RightTool; icon: string; label: string }[] = [
  { id: 'comments', icon: 'comment', label: 'Comments' },
  { id: 'versions', icon: 'description', label: 'Saved Versions' },
  { id: 'todo', icon: 'checklist', label: 'To-Do List' },
  { id: 'grammar', icon: 'spellcheck', label: 'Grammar Checker' },
  { id: 'ai', icon: 'smart_toy', label: 'AI Assistant' },
  { id: 'html', icon: 'code', label: 'HTML Renderer' },
];

type Session = AuthSuccess;

const WORKSPACE_PANEL_COLLAPSED_KEY = 'docsync.workspacePanelCollapsed';
const VIEWER_WORKSPACE_PANEL_COLLAPSED_KEY = 'docsync.viewerWorkspacePanelCollapsed';
const SESSION_STORAGE_KEY = 'docsync.session';
const ADMIN_SESSION_KEY = 'docsync.adminSession';
const PAGE_SIZE_STORAGE_KEY = 'docsync.pageSize';

const AiTool = lazy(() => import('./components/features/panels/AiTool'));
const Comments = lazy(() => import('./components/features/panels/Comments'));
const GrammarChecker = lazy(() => import('./components/features/panels/GrammarChecker'));
const SavedDocuments = lazy(() => import('./components/features/panels/SavedDocuments'));
const TodoList = lazy(() => import('./components/features/panels/TodoList'));

const AuthPage = lazy(() => import('./components/pages/AuthPage'));
const LandingPage = lazy(() => import('./components/pages/LandingPage'));
const AdminLoginPage = lazy(() => import('./components/pages/AdminLoginPage'));
const OrganizationAdminPage = lazy(() => import('./components/pages/OrganizationAdminPage'));
const ResetPasswordPage = lazy(() => import('./components/pages/ResetPasswordPage'));
const SecuritySettingsPage = lazy(() => import('./components/pages/SecuritySettingsPage'));
const SettingsDashboardPage = lazy(() => import('./components/pages/SettingsDashboardPage'));
const VerifyEmailPage = lazy(() => import('./components/pages/VerifyEmailPage'));
const WorkspaceHomePage = lazy(() => import('./components/pages/WorkspaceHomePage'));

// ── HTML syntax highlighting helpers ─────────────────────────────────────────
const VOID_TAGS = new Set(['br','hr','img','input','meta','link','area','base','col','embed','param','source','track','wbr']);

function prettyPrintHtml(html: string): string {
  const parts: string[] = [];
  let depth = 0;
  const ind = () => '  '.repeat(depth);
  const re = /<(!--[\s\S]*?--|[^>]+)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[2] !== undefined) {
      const text = m[2];
      // Drop only formatting-only whitespace; preserve intentional spaces.
      if (text.trim().length === 0 && /[\n\r\t]/.test(text)) continue;
      // Indent text lines only when doing so is safe (no intentional edge spaces).
      if (text) {
        const hasEdgeSpaces = /^\s|\s$/.test(text);
        parts.push(hasEdgeSpaces ? text : ind() + text);
      }
    } else {
      const inner = m[1];
      if (inner.startsWith('/')) {
        depth = Math.max(0, depth - 1);
        parts.push(ind() + `<${inner}>`);
      } else if (inner.startsWith('!--')) {
        parts.push(ind() + `<${inner}>`);
      } else {
        const tagName = inner.match(/^([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase() ?? '';
        const isSelfClose = inner.endsWith('/') || VOID_TAGS.has(tagName);
        parts.push(ind() + `<${inner}>`);
        if (!isSelfClose) depth++;
      }
    }
  }
  return parts.join('\n');
}

function colorizeHtml(html: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let result = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      const next = html.indexOf('<', i);
      const slice = next === -1 ? html.slice(i) : html.slice(i, next);
      const trimmed = slice.trim();
      result += trimmed
        ? `<span style="color:#e2e8f0">${esc(slice)}</span>`
        : esc(slice);
      i = next === -1 ? html.length : next;
      continue;
    }
    const close = html.indexOf('>', i);
    if (close === -1) { result += esc(html.slice(i)); break; }
    const inner = html.slice(i + 1, close);
    const isClosing = inner.startsWith('/');
    const tagContent = isClosing ? inner.slice(1) : inner;
    const nm = tagContent.match(/^([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)/);
    if (!nm) {
      result += `<span style="color:#94a3b8">&lt;${esc(inner)}&gt;</span>`;
      i = close + 1;
      continue;
    }
    const tagName = nm[1];
    const rest = nm[2];
    const coloredAttrs = rest.replace(
      /(\s+)([a-zA-Z][a-zA-Z0-9\-:_]*)(?:="([^"]*)")?(\s*\/)?/g,
      (_full, space, name, val) => {
        if (val !== undefined)
          return `${space}<span style="color:#7dd3fc">${esc(name)}</span>=<span style="color:#fbbf24">"${esc(val)}"</span>`;
        return `${space}<span style="color:#7dd3fc">${esc(name)}</span>`;
      },
    );
    const lt = `<span style="color:#475569">&lt;</span>`;
    const gt = `<span style="color:#475569">&gt;</span>`;
    const tagColor = isClosing ? '#fb7185' : '#34d399';
    result += `${lt}<span style="color:${tagColor}">${isClosing ? '/' : ''}${esc(tagName)}</span>${coloredAttrs}${gt}`;
    i = close + 1;
  }
  return result;
}

// ─── Editor view (all hooks live here, never behind a conditional) ────────────
function EditorView({ token, docId }: { token: string; docId: string }) {

  const navigate = useNavigate();

  const editorRef = useRef<RichEditorHandle | null>(null);
  const savePopupRef = useRef<HTMLDivElement | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [currentRuns, setCurrentRuns] = useState<Run[]>([]);
  const [savedVersions, setSavedVersions] = useState<SavedVersion[]>([]);
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => getInitialWorkspaceSelectionId());
  const selectedWorkspaceIdRef = useRef<string>(selectedWorkspaceId);
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ docId: string; x: number; y: number } | null>(null);
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ targetId: string | null; mode: 'before' | 'after' | 'inside' | 'root' } | null>(null);
  const [workspaceModal, setWorkspaceModal] = useState<EditorWorkspaceModalState | null>(null);
  const [title, setTitle] = useState<string>('');
  const [showSavePopup, setShowSavePopup] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isWorkspacePanelCollapsed, setIsWorkspacePanelCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(WORKSPACE_PANEL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [isFullscreenEditor, setIsFullscreenEditor] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(() => {
    try {
      const saved = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      if (saved && isPageSize(saved)) {
        return saved;
      }
    } catch {
      // Ignore storage access issues and fallback to default.
    }
    return 'responsive';
  });
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
    tableSelected: false,
    tablePanelOpen: false,
    tablePartialTextSelection: false,
    tableRoundedBorders: false,
    tableBorderRadiusPx: 0,
  });
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const lastSavedVersionHtmlRef = useRef<string>('');
  const lastAutoSavedHtmlRef = useRef<string>('');
  const lastAutoSavedTitleRef = useRef<string>('');
  const isAutoSavingRef = useRef(false);
  const isDocLoadedRef = useRef(false);

  function normalizeVersionHtml(html: string) {
    return String(html || '').trim();
  }

  function buildVersionPreview(html: string, previewText?: string) {
    const manualPreview = String(previewText || '').trim();
    if (manualPreview) return manualPreview.slice(0, 90);

    const plain = String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) return plain.slice(0, 90);
    return 'Updated document';
  }

  function handleOpenDocClick(docIdValue: string) {
    navigate(`/editor/${docIdValue}`);
  }

  // Load versions from backend on mount
  useEffect(() => {
    if (!docId) return;
    isDocLoadedRef.current = false;
    docsApi
      .get(token, docId)
      .then(({ doc }) => {
        setTitle(doc.title ?? '');
        const normalizedHtml = normalizeVersionHtml(doc.content ?? '');
        const normalizedTitle = String(doc.title || '').trim();
        lastSavedVersionHtmlRef.current = normalizedHtml;
        lastAutoSavedHtmlRef.current = normalizedHtml;
        lastAutoSavedTitleRef.current = normalizedTitle;
        isDocLoadedRef.current = true;
        const runs = htmlToRuns(doc.content ?? '');
        editorRef.current?.setRuns(runs);
      })
      .catch((error: unknown) => {
        console.error('Failed to load document.', error);
      });
  }, [token, docId]);

  useEffect(() => {
    if (!docId || !isDocLoadedRef.current) return;

    const timeoutId = window.setTimeout(async () => {
      if (isAutoSavingRef.current) return;

      const html = currentRuns.length > 0 ? canvasRunsToHtml(currentRuns) : canvasTextToHtml(currentText);
      const normalizedHtml = normalizeVersionHtml(html);
      const normalizedTitle = String(title || '').trim();

      const unchanged = normalizedHtml === lastAutoSavedHtmlRef.current
        && normalizedTitle === lastAutoSavedTitleRef.current;
      if (unchanged) return;

      isAutoSavingRef.current = true;
      setAutoSaveStatus('saving');
      try {
        await docsApi.update(token, docId, { title, content: html });
        lastAutoSavedHtmlRef.current = normalizedHtml;
        lastAutoSavedTitleRef.current = normalizedTitle;
        setAutoSaveStatus('saved');

        setSavedDocuments((prev) => prev.map((doc) => {
          if (doc.id !== docId) return doc;
          const preview = String(html || '').replace(/<[^>]+>/g, '').slice(0, 100);
          return {
            ...doc,
            title,
            preview,
            updatedAt: new Date().toISOString(),
          };
        }));
      } catch (error: unknown) {
        console.error('Autosave failed.', error);
        setAutoSaveStatus('error');
      } finally {
        isAutoSavingRef.current = false;
      }
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [token, docId, title, currentText, currentRuns]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, pageSize);
    } catch {
      // Ignore storage access issues.
    }
  }, [pageSize]);

  useEffect(() => {
    if (!docId) return;
    setSavedVersions([]);
    versionsApi
      .list(token, docId)
      .then(({ versions }) => setSavedVersions(versions))
      .catch((error: unknown) => {
        console.error('Failed to load versions.', error);
      });
  }, [token, docId]);

  useEffect(() => {
    docsApi
      .list(token)
      .then(({ docs }) => setSavedDocuments(docs))
      .catch((error: unknown) => {
        console.error('Failed to load documents.', error);
      });
  }, [token]);

  const saveVersion = useCallback(
    async (previewText?: string) => {
      if (!docId) return;
      try {
        const html = currentRuns.length > 0 ? canvasRunsToHtml(currentRuns) : canvasTextToHtml(currentText);
        const normalizedHtml = normalizeVersionHtml(html);
        if (normalizedHtml === lastSavedVersionHtmlRef.current) {
          return;
        }

        const preview = buildVersionPreview(html, previewText);
        const { version } = await versionsApi.save(token, docId, html, preview);
        lastSavedVersionHtmlRef.current = normalizedHtml;
        setSavedVersions((prev) => [version, ...prev].slice(0, 20));
      } catch (error: unknown) {
        console.error('Failed to save version.', error);
      }
    },
    [token, docId, currentText, currentRuns],
  );

  const handleEditorChange = useCallback((text: string) => {
    setCurrentText(text);
  }, []);

  const handleRunsChange = useCallback((runs: Run[]) => {
    setCurrentRuns(runs);
  }, []);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    persistWorkspaceSelectionId(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_PANEL_COLLAPSED_KEY,
        isWorkspacePanelCollapsed ? '1' : '0',
      );
    } catch {
      // no-op
    }
  }, [isWorkspacePanelCollapsed]);

  useEffect(() => {
    workspaceApi
      .list(token)
      .then(({ workspaces: available }) => {
        setWorkspaces(available);
        const currentWorkspaceId = selectedWorkspaceIdRef.current;
        const fallbackWorkspaceId = available[0]?.id ?? '';
        if (!available.some((w) => w.id === currentWorkspaceId)) {
          setSelectedWorkspaceId(fallbackWorkspaceId);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load workspaces.', error);
      });
  }, [token]);

  const filteredLeftDocs = useMemo(() => {
    let result = savedDocuments;
    if (selectedWorkspaceId) {
      result = result.filter((d) => d.workspaceId === selectedWorkspaceId);
    }

    const q = navSearchQuery.trim().toLowerCase();
    if (q) result = result.filter((d) => `${d.title} ${d.preview}`.toLowerCase().includes(q));
    return result;
  }, [savedDocuments, selectedWorkspaceId, navSearchQuery]);

  const leftDocTree = useMemo(() => buildDocumentTree(filteredLeftDocs) as EditorDocNode[], [filteredLeftDocs]);

  const activeWorkspaceName = useMemo(() => {
    return workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? workspaces[0]?.name ?? 'Workspace';
  }, [selectedWorkspaceId, workspaces]);

  const workspaceOptions = useMemo(
    () => workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
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

    const options = workspaceOptions.filter((workspace) => workspace.id !== (doc.workspaceId ?? null));
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
      destinationWorkspaceId = selectedWorkspaceId || null;
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
  const [htmlDock, setHtmlDock] = useState<'right' | 'bottom'>('right');
  const [htmlPanelSize, setHtmlPanelSize] = useState<number>(500); // px — width (right) or height (bottom)
  const [htmlEditMode, setHtmlEditMode] = useState(false);
  const [htmlSourceText, setHtmlSourceText] = useState('');
  const [htmlSourceSnapshot, setHtmlSourceSnapshot] = useState('');
  const htmlHistoryRef = useRef<string[]>([]);
  const htmlHistoryIndexRef = useRef(-1);
  const [htmlCanUndo, setHtmlCanUndo] = useState(false);
  const [htmlCanRedo, setHtmlCanRedo] = useState(false);
  const htmlResizingRef = useRef(false);
  const htmlResizeStartRef = useRef(0);
  const htmlResizeStartSizeRef = useRef(0);

  const syncHtmlHistoryFlags = useCallback(() => {
    setHtmlCanUndo(htmlHistoryIndexRef.current > 0);
    setHtmlCanRedo(
      htmlHistoryIndexRef.current >= 0 &&
      htmlHistoryIndexRef.current < htmlHistoryRef.current.length - 1,
    );
  }, []);

  const seedHtmlHistory = useCallback((value: string) => {
    htmlHistoryRef.current = [value];
    htmlHistoryIndexRef.current = 0;
    syncHtmlHistoryFlags();
  }, [syncHtmlHistoryFlags]);

  const pushHtmlHistory = useCallback((value: string) => {
    const base = htmlHistoryRef.current.slice(0, htmlHistoryIndexRef.current + 1);
    const last = base[base.length - 1];
    if (last === value) return;
    const next = [...base, value].slice(-200);
    htmlHistoryRef.current = next;
    htmlHistoryIndexRef.current = next.length - 1;
    syncHtmlHistoryFlags();
  }, [syncHtmlHistoryFlags]);

  const undoHtmlHistory = useCallback(() => {
    if (htmlHistoryIndexRef.current <= 0) return;
    htmlHistoryIndexRef.current -= 1;
    const value = htmlHistoryRef.current[htmlHistoryIndexRef.current] ?? '';
    setHtmlSourceText(value);
    syncHtmlHistoryFlags();
  }, [syncHtmlHistoryFlags]);

  const redoHtmlHistory = useCallback(() => {
    if (htmlHistoryIndexRef.current >= htmlHistoryRef.current.length - 1) return;
    htmlHistoryIndexRef.current += 1;
    const value = htmlHistoryRef.current[htmlHistoryIndexRef.current] ?? '';
    setHtmlSourceText(value);
    syncHtmlHistoryFlags();
  }, [syncHtmlHistoryFlags]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const startHtmlResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    htmlResizingRef.current = true;
    htmlResizeStartRef.current = htmlDock === 'right' ? e.clientX : e.clientY;
    htmlResizeStartSizeRef.current = htmlPanelSize;

    const onMove = (ev: MouseEvent) => {
      if (!htmlResizingRef.current) return;
      if (htmlDock === 'right') {
        const delta = htmlResizeStartRef.current - ev.clientX;
        setHtmlPanelSize(() => Math.max(280, Math.min(900, htmlResizeStartSizeRef.current + delta)));
      } else {
        const delta = htmlResizeStartRef.current - ev.clientY;
        setHtmlPanelSize(() => Math.max(150, Math.min(600, htmlResizeStartSizeRef.current + delta)));
      }
    };
    const onUp = () => {
      htmlResizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [htmlDock, htmlPanelSize]);

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
        const html = currentRuns.length > 0 ? canvasRunsToHtml(currentRuns) : canvasTextToHtml(currentText);
        await docsApi.update(token, docId, { title, content: html });
        lastAutoSavedHtmlRef.current = normalizeVersionHtml(html);
        lastAutoSavedTitleRef.current = String(title || '').trim();
        const { docs } = await docsApi.list(token);
        setSavedDocuments(docs);
      } catch {
        // silent
      }
    }
    await saveVersion(trimmed.length > 0 ? trimmed : undefined);
    setShowSavePopup(false);
    setSaveMessage('');
  }, [saveMessage, saveVersion, token, docId, title, currentText, currentRuns]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = event.metaKey || event.ctrlKey;
      if (!modifierPressed || event.altKey) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void handleSaveDocument();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveDocument]);

  const handlePublishDocument = useCallback(async () => {
    if (docId) {
      try {
        const html = currentRuns.length > 0 ? canvasRunsToHtml(currentRuns) : canvasTextToHtml(currentText);
        await docsApi.update(token, docId, { title, content: html });
        lastAutoSavedHtmlRef.current = normalizeVersionHtml(html);
        lastAutoSavedTitleRef.current = String(title || '').trim();
        const { docs } = await docsApi.list(token);
        setSavedDocuments(docs);
      } catch {
        // silent
      }
    }
    await saveVersion();
    window.alert('Document published successfully.');
  }, [saveVersion, token, docId, title, currentText, currentRuns]);

  const docText = currentText;
  const renderedHtml = useMemo(
    () => (currentRuns.length > 0 ? canvasRunsToHtml(currentRuns) : canvasTextToHtml(currentText)),
    [currentRuns, currentText],
  );
  const prettyRenderedHtml = useMemo(
    () => prettyPrintHtml(renderedHtml || '<p></p>'),
    [renderedHtml],
  );
  const refreshHtmlPanel = useCallback(() => {
    if (htmlEditMode) {
      const restored = htmlSourceSnapshot || prettyRenderedHtml;
      setHtmlSourceText(restored);
      seedHtmlHistory(restored);
      return;
    }
    setHtmlSourceSnapshot(prettyRenderedHtml);
    setHtmlSourceText(prettyRenderedHtml);
  }, [htmlEditMode, htmlSourceSnapshot, prettyRenderedHtml, seedHtmlHistory]);
  const showFullscreenEditor = isFullscreenEditor || (activeTool === 'html' && htmlDock === 'bottom');

  useEffect(() => {
    const shell = editorShellRef.current;
    if (!shell) return;

    if (isFullscreenEditor) {
      if (document.fullscreenElement !== shell && shell.requestFullscreen) {
        shell.requestFullscreen().catch(() => {
          // Keep CSS fullscreen fallback even when native fullscreen is denied.
        });
      }
    } else if (document.fullscreenElement === shell && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        // Ignore exit failures and keep layout fallback.
      });
    }
  }, [isFullscreenEditor]);

  useEffect(() => {
    const shell = editorShellRef.current;
    if (!shell) return;

    const onFullscreenChange = () => {
      if (document.fullscreenElement !== shell) {
        setIsFullscreenEditor(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  return (
    <div
      ref={editorShellRef}
      className={`relative flex h-screen overflow-hidden font-sans ${
        showFullscreenEditor
          ? 'bg-white'
          : 'bg-linear-to-br from-slate-100 via-white to-cyan-50'
      }`}
    >
      {!showFullscreenEditor && (
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
              <ThemeListbox
                value={selectedWorkspaceId}
                options={workspaceOptions}
                onChange={(nextValue) => setSelectedWorkspaceId(nextValue)}
                  placeholder="Select workspace"
              />
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
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!showFullscreenEditor && <Header />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <main
            className={`flex min-h-0 flex-1 overflow-hidden ${
              showFullscreenEditor ? 'px-0 py-0' : 'px-4 py-1 sm:px-6 lg:px-8 lg:py-3'
            }`}
          >
            <div className="flex min-h-0 w-full flex-col">
              {!showFullscreenEditor && (
                <div className="mb-1 flex items-center gap-2 border-b border-slate-200 px-1 pb-1">
                  <input
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="Untitled document"
                    className="w-full bg-transparent px-2 py-1 text-sm font-semibold text-slate-800 outline-none"
                  />
                  <span
                    className="inline-flex items-center text-[11px] font-medium whitespace-nowrap text-emerald-700"
                    title={
                      autoSaveStatus === 'saved'
                        ? 'Saved'
                        : autoSaveStatus === 'saving'
                          ? 'Saving...'
                          : autoSaveStatus === 'error'
                            ? 'Save failed'
                            : 'Auto-save'
                    }
                    aria-label={
                      autoSaveStatus === 'saved'
                        ? 'Saved'
                        : autoSaveStatus === 'saving'
                          ? 'Saving...'
                          : autoSaveStatus === 'error'
                            ? 'Save failed'
                            : 'Auto-save'
                    }
                  >
                    <span
                      className={`material-icons ${autoSaveStatus === 'saving' ? 'animate-spin' : ''}`}
                      style={{ fontSize: '1.2rem' }}
                    >
                      {autoSaveStatus === 'saved'
                        ? 'cloud_done'
                        : autoSaveStatus === 'saving'
                          ? 'cloud_upload'
                          : autoSaveStatus === 'error'
                            ? 'cloud_off'
                            : 'cloud'}
                    </span>
                  </span>
                  <div className="relative" ref={savePopupRef}>
                    <button
                      type="button"
                      onClick={() => setShowSavePopup((prev) => !prev)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      Commit
                    </button>
                    {showSavePopup && (
                      <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                          Commit message
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
                            Commit
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
                isFullscreen={showFullscreenEditor}
                onToggleFullscreen={() => setIsFullscreenEditor((p) => !p)}
                cursorFormat={cursorFormat}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                <RichEditor
                  ref={editorRef}
                  onContentChange={handleEditorChange}
                  onRunsChange={handleRunsChange}
                  onCursorFormatChange={setCursorFormat}
                  pageSize={pageSize}
                />
              </div>
            </div>
          </main>
          {!showFullscreenEditor && (
          <div className="flex shrink-0 items-stretch">
            <div
              className={`flex flex-col border-l border-slate-200/70 bg-white/90 backdrop-blur-sm shadow-xl transition-all duration-300 overflow-hidden ${activeTool && activeTool !== 'html' ? 'w-80' : 'w-0'}`}
            >
              <div className="h-full w-80 overflow-auto p-4">
                <Suspense fallback={<div className="text-xs text-slate-500">Loading panel...</div>}>
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
                      versions={savedVersions}
                    />
                  )}
                  {activeTool === 'todo' && <TodoList docId={docId} token={token} />}
                  {activeTool === 'grammar' && <GrammarChecker token={token} docText={docText} />}
                  {activeTool === 'ai' && <AiTool token={token} />}
                </Suspense>
              </div>
            </div>

            {/* Icon strip - always visible */}
            <div className="flex w-12 flex-col items-center gap-1 border-l border-slate-200/70 bg-white/75 backdrop-blur-sm pt-3">
              {RIGHT_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    setActiveTool((prev) => {
                      const next = prev === tool.id ? null : tool.id;
                      if (next !== 'html') setHtmlEditMode(false);
                      return next;
                    });
                  }}
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
          )}

          {/* HTML panel — floats over canvas, dockable right or bottom */}
          {activeTool === 'html' && (
            <div
              className={`pointer-events-none absolute z-50 ${
                htmlDock === 'right'
                  ? 'inset-y-0 right-0 flex items-stretch justify-end'
                  : 'inset-x-0 bottom-0 flex items-end justify-stretch'
              }`}
            >
              <div className={`relative flex ${htmlDock === 'bottom' ? 'w-full' : ''}`}>
              <div
                className={`pointer-events-auto flex flex-col shadow-2xl ${
                  htmlDock === 'right'
                    ? 'h-full'
                    : 'w-full'
                }`}
                style={{
                  width: htmlDock === 'right' ? `${htmlPanelSize}px` : undefined,
                  height: htmlDock === 'bottom' ? `${htmlPanelSize}px` : undefined,
                  background: 'rgba(10, 14, 26, 0.82)',
                  backdropFilter: 'blur(18px) saturate(1.4)',
                  borderLeft: htmlDock === 'right' ? '1px solid rgba(99,120,180,0.18)' : 'none',
                  borderTop: htmlDock === 'bottom' ? '1px solid rgba(99,120,180,0.18)' : 'none',
                }}
              >
                {/* Resize handle */}
                {htmlDock === 'right' && (
                  <div
                    onMouseDown={startHtmlResize}
                    className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-cyan-500/30 transition-colors"
                    style={{ zIndex: 1 }}
                  />
                )}
                {htmlDock === 'bottom' && (
                  <div
                    onMouseDown={startHtmlResize}
                    className="absolute top-0 left-0 w-full h-1.5 cursor-row-resize hover:bg-cyan-500/30 transition-colors"
                    style={{ zIndex: 1 }}
                  />
                )}
                {/* Header */}
                <div
                  className="flex shrink-0 items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: '1px solid rgba(99,120,180,0.15)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-icons text-cyan-400" style={{ fontSize: '1rem' }}>code</span>
                    <div>
                      <h3 className="text-[13px] font-semibold tracking-wide text-slate-100">HTML Source</h3>
                      <p className="text-[10px] text-slate-500">{htmlEditMode ? 'Editing · apply to sync canvas' : 'Live · updates as you type'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Edit / View toggle */}
                    <button
                      type="button"
                      title={htmlEditMode ? 'Switch to view mode' : 'Edit HTML source'}
                      onClick={() => {
                        if (!htmlEditMode) {
                          setHtmlSourceSnapshot(prettyRenderedHtml);
                          setHtmlSourceText(prettyRenderedHtml);
                          seedHtmlHistory(prettyRenderedHtml);
                        }
                        setHtmlEditMode((v) => !v);
                      }}
                      className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
                        htmlEditMode
                          ? 'bg-cyan-500/20 text-cyan-300'
                          : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
                      }`}
                    >
                      <span className="material-icons" style={{ fontSize: '0.8rem' }}>{htmlEditMode ? 'visibility' : 'edit'}</span>
                      {htmlEditMode ? 'View' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      title="Undo"
                      onClick={undoHtmlHistory}
                      disabled={!htmlEditMode || !htmlCanUndo}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="material-icons" style={{ fontSize: '0.95rem' }}>undo</span>
                    </button>
                    <button
                      type="button"
                      title="Redo"
                      onClick={redoHtmlHistory}
                      disabled={!htmlEditMode || !htmlCanRedo}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="material-icons" style={{ fontSize: '0.95rem' }}>redo</span>
                    </button>
                    {/* Dock: right */}
                    <button
                      type="button"
                      title="Dock right"
                      onClick={() => {
                        setHtmlDock('right');
                        setHtmlPanelSize(500);
                      }}
                      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                        htmlDock === 'right'
                          ? 'text-cyan-400'
                          : 'text-slate-600 hover:text-slate-300'
                      }`}
                    >
                      <span className="material-icons" style={{ fontSize: '1rem' }}>border_right</span>
                    </button>
                    {/* Dock: bottom */}
                    <button
                      type="button"
                      title="Dock bottom"
                      onClick={() => {
                        setHtmlDock('bottom');
                        setHtmlPanelSize(200);
                      }}
                      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                        htmlDock === 'bottom'
                          ? 'text-cyan-400'
                          : 'text-slate-600 hover:text-slate-300'
                      }`}
                    >
                      <span className="material-icons" style={{ fontSize: '1rem' }}>border_bottom</span>
                    </button>
                    {/* Divider */}
                    <span className="mx-1 h-4 w-px bg-slate-700" />
                    {/* Copy */}
                    <button
                      type="button"
                      title="Copy HTML"
                      onClick={() => {
                        void navigator.clipboard.writeText(prettyRenderedHtml);
                      }}
                      className="flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
                    >
                      <span className="material-icons" style={{ fontSize: '0.8rem' }}>content_copy</span>
                      Copy
                    </button>
                    {/* Refresh */}
                    <button
                      type="button"
                      title="Refresh HTML from document"
                      onClick={refreshHtmlPanel}
                      className="flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
                    >
                      <span className="material-icons" style={{ fontSize: '0.8rem' }}>refresh</span>
                      Refresh
                    </button>
                    {/* Close */}
                    <button
                      type="button"
                      title="Close"
                      onClick={() => {
                        setActiveTool(null);
                        setHtmlEditMode(false);
                      }}
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded text-slate-600 transition-colors hover:bg-white/10 hover:text-slate-200"
                    >
                      <span className="material-icons" style={{ fontSize: '0.95rem' }}>close</span>
                    </button>
                  </div>
                </div>

                {/* Line-number gutter + code */}
                <div className="flex min-h-0 flex-1 overflow-auto">
                  {htmlEditMode ? (
                    /* ── Edit mode: raw textarea ── */
                    <div className="flex min-h-0 flex-1 flex-col">
                      <textarea
                        className="flex-1 resize-none bg-transparent font-mono text-[12.5px] leading-6 text-slate-100 outline-none px-4 py-3 placeholder-slate-600"
                        style={{ tabSize: 2 }}
                        wrap="off"
                        value={htmlSourceText}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setHtmlSourceText(nextValue);
                          pushHtmlHistory(nextValue);
                        }}
                        onKeyDown={(event) => {
                          const modifier = event.metaKey || event.ctrlKey;
                          if (!modifier || event.altKey) return;
                          if (event.key.toLowerCase() !== 'z') return;
                          event.preventDefault();
                          if (event.shiftKey) {
                            redoHtmlHistory();
                          } else {
                            undoHtmlHistory();
                          }
                        }}
                        spellCheck={false}
                        placeholder="<p>Paste or type HTML here…</p>"
                      />
                      <div
                        className="flex shrink-0 items-center justify-end gap-2 px-4 py-2"
                        style={{ borderTop: '1px solid rgba(99,120,180,0.15)' }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const restored = htmlSourceSnapshot || prettyRenderedHtml;
                            setHtmlSourceText(restored);
                            seedHtmlHistory(restored);
                            setHtmlEditMode(false);
                          }}
                          className="rounded px-3 py-1 text-[12px] font-medium text-slate-400 hover:bg-white/10 hover:text-slate-200"
                        >Cancel</button>
                        <button
                          type="button"
                          onClick={() => {
                            if (htmlSourceText === htmlSourceSnapshot) {
                              setHtmlEditMode(false);
                              return;
                            }

                            const runs = htmlToRuns(htmlSourceText);
                            const normalizedHtml = canvasRunsToHtml(runs);
                            const nextPretty = prettyPrintHtml(normalizedHtml || '<p></p>');
                            if (normalizedHtml !== renderedHtml) {
                              editorRef.current?.setRuns(runs);
                            }
                            setHtmlSourceSnapshot(nextPretty);
                            setHtmlSourceText(nextPretty);
                            seedHtmlHistory(nextPretty);
                            setHtmlEditMode(false);
                          }}
                          className="rounded bg-cyan-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-cyan-400"
                        >Apply to Canvas</button>
                      </div>
                    </div>
                  ) : (
                    /* ── View mode: syntax-highlighted ── */
                    <>
                  <div
                    className="shrink-0 select-none px-3 py-3 text-right font-mono text-[12px] leading-6 text-cyan-700"
                    style={{ borderRight: '1px solid rgba(99,120,180,0.1)', minWidth: '2.8rem' }}
                    aria-hidden="true"
                  >
                    {prettyRenderedHtml.split('\n').map((line, i) => (
                      <div key={`${i + 1}-${line.length}`}>{i + 1}</div>
                    ))}
                  </div>
                  <div className="min-w-0 flex-1 overflow-auto px-4 py-3">
                    <pre className="w-full font-mono text-[12.5px] leading-6" style={{ tabSize: 2 }}>
                      <code
                        dangerouslySetInnerHTML={{
                          __html: colorizeHtml(prettyRenderedHtml),
                        }}
                      />
                    </pre>
                  </div>
                    </>
                  )}
                </div>
              </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="fixed z-80 min-w-42.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
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
        <div className="fixed inset-0 z-90 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            {workspaceModal.type === 'transfer-workspace' && (
              <>
                <h3 className="text-base font-bold text-slate-800">
                  {workspaceModal.action === 'copy' ? 'Copy To Workspace' : 'Move To Workspace'}
                </h3>
                <p className="mt-1 text-xs text-slate-500">Choose a target workspace.</p>
                <div className="mt-3">
                  <ThemeListbox
                    value={workspaceModal.targetId}
                    options={workspaceModal.options}
                    onChange={(nextValue) =>
                      setWorkspaceModal((prev) =>
                        prev && prev.type === 'transfer-workspace'
                          ? { ...prev, targetId: nextValue, error: undefined }
                          : prev,
                      )
                    }
                    placeholder="Choose workspace"
                  />
                </div>
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
                      const targetWorkspaceId = workspaceModal.targetId;
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
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => getInitialWorkspaceSelectionId());
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [currentDoc, setCurrentDoc] = useState<{ id: string; title: string; content: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isViewerWorkspacePanelCollapsed, setIsViewerWorkspacePanelCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(VIEWER_WORKSPACE_PANEL_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const viewerBaseFontStack = "Raleway, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  const viewerHtml = useMemo(() => {
    const raw = currentDoc?.content?.trim();
    if (!raw) return '<p>No content available.</p>';
    return raw.replace(
      /font-family\s*:\s*(['"]?)(sans-serif|ui-sans-serif)(\1)/gi,
      `font-family:${viewerBaseFontStack}`,
    );
  }, [currentDoc?.content]);

  const filteredLeftDocs = useMemo(() => {
    let result = savedDocuments;
    if (selectedWorkspaceId) {
      result = result.filter((d) => d.workspaceId === selectedWorkspaceId);
    }

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
    return workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? workspaces[0]?.name ?? 'Workspace';
  }, [selectedWorkspaceId, workspaces]);

  const workspaceOptions = useMemo(
    () => workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    [workspaces],
  );

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
    try {
      window.localStorage.setItem(
        VIEWER_WORKSPACE_PANEL_COLLAPSED_KEY,
        isViewerWorkspacePanelCollapsed ? '1' : '0',
      );
    } catch {
      // no-op
    }
  }, [isViewerWorkspacePanelCollapsed]);

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
        setWorkspaces(available);
        const fallbackWorkspaceId = available[0]?.id ?? '';
        if (!available.some((workspace) => workspace.id === selectedWorkspaceId)) {
          setSelectedWorkspaceId(fallbackWorkspaceId);
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
  }, [token, docId, selectedWorkspaceId]);

  return (
    <div className="flex h-screen overflow-hidden bg-linear-to-br from-slate-100 via-white to-cyan-50">
      <aside
        className={`hidden border-r border-slate-200 bg-white transition-all duration-300 lg:flex lg:flex-col ${
          isViewerWorkspacePanelCollapsed ? 'lg:w-14 lg:shrink-0' : 'lg:w-80 lg:shrink-0'
        }`}
      >
        {isViewerWorkspacePanelCollapsed ? (
          <div className="flex h-full flex-col items-center px-2 py-2">
            <button
              type="button"
              onClick={() => setIsViewerWorkspacePanelCollapsed(false)}
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
                title={`${activeWorkspaceName} | ${currentDoc?.title?.trim() || 'Untitled'}`}
              >
                <span className="text-cyan-700">{activeWorkspaceName}</span>
                <span className="text-slate-400"> | </span>
                <span className="text-slate-700">{currentDoc?.title?.trim() || 'Untitled'}</span>
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
                  onClick={() => setIsViewerWorkspacePanelCollapsed(true)}
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
              <ThemeListbox
                value={selectedWorkspaceId}
                options={workspaceOptions}
                onChange={(nextValue) => setSelectedWorkspaceId(nextValue)}
                placeholder="Select workspace"
              />
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
        )}
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
              <div className="px-4 py-5 sm:px-5">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">{(currentDoc.title || 'Untitled').trim()}</h2>
                <p className="mt-2 text-xs text-slate-500">Modified {modifiedAtLabel} by {userName}</p>
                <div className="mt-5 border-t border-slate-200 pt-5">
                  <div
                    className="docsync-viewer-content max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: viewerHtml,
                    }}
                  />
                </div>
              </div>
            </article>
          )}
        </div>
      </main>
    </div>
  );
}


// ─── App shell ────────────────────────────────────────────────────────────────
function AppLoadingScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center overflow-hidden bg-slate-50/65 px-6 backdrop-blur-[1px]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
        <div className="absolute -right-20 bottom-16 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md px-6 py-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-cyan-200/70 bg-white/60 backdrop-blur-sm">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-500" />
        </div>
        <p className="text-lg font-semibold text-slate-900">{title}</p>
        <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
        <div className="mx-auto mt-6 h-1.5 max-w-56 overflow-hidden rounded-full bg-slate-200/80">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-500" />
        </div>
      </div>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const readPersistedAdminSession = useCallback((): Session | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(ADMIN_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (!parsed?.accessToken || !parsed.accessTokenExpiresAt || !parsed.user) {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        return null;
      }
      if (new Date(parsed.accessTokenExpiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const [adminSession, setAdminSession] = useState<Session | null>(() => readPersistedAdminSession());

  const applyAdminSession = useCallback((auth: Session | null) => {
    setAdminSession(auth);
    if (typeof window !== 'undefined') {
      try {
        if (auth) window.sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(auth));
        else window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
      } catch { /* ignore */ }
    }
  }, []);

  const readPersistedSession = useCallback((): Session | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (!parsed?.accessToken || !parsed.accessTokenExpiresAt || !parsed.user) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      if (new Date(parsed.accessTokenExpiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const applySession = useCallback((auth: Session | null) => {
    setSession(auth);
    if (typeof window !== 'undefined') {
      try {
        if (auth) {
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(auth));
        } else {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch {
        // Ignore storage failures in restricted environments.
      }
    }
    if (auth?.csrfToken) {
      persistCsrfToken(auth.csrfToken);
    } else {
      clearPersistedCsrfToken();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const isAdminPath = pathname.startsWith('/admin');
    const isPublicPath =
      pathname === '/' ||
      pathname === '/home' ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/verify-email') ||
      pathname.startsWith('/reset-password');
    const restoredSession = readPersistedSession();
    const isRestoredSessionUsable =
      Boolean(restoredSession) &&
      new Date(restoredSession?.accessTokenExpiresAt || 0).getTime() > Date.now() + 15_000;

    if (restoredSession) {
      applySession(restoredSession);
    }

    const refreshWithRetry = async () => {
      try {
        return await authApi.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('csrf')) {
          return authApi.refresh();
        }
        throw error;
      }
    };

    refreshWithRetry()
      .then((auth) => {
        if (cancelled) return;
        applySession(auth);
      })
      .catch(() => {
        if (cancelled) return;
        if (isRestoredSessionUsable && restoredSession) {
          applySession(restoredSession);
          return;
        }
        applySession(null);
        if (!isAdminPath && !isPublicPath) {
          navigate('/auth', { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [applySession, navigate, readPersistedSession]);

  const refreshSession = useCallback(async () => {
    const auth = await authApi.refresh();
    applySession(auth);
    return auth;
  }, [applySession]);

  useEffect(() => {
    if (!session) return;
    const refreshAt = new Date(session.accessTokenExpiresAt).getTime() - Date.now() - 60_000;
    const timeout = window.setTimeout(() => {
      void refreshSession().catch(() => {
        applySession(null);
        const isAdminPath =
          typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
        if (!isAdminPath) {
          navigate('/auth', { replace: true });
        }
      });
    }, Math.max(refreshAt, 5_000));

    return () => window.clearTimeout(timeout);
  }, [navigate, refreshSession, session]);

  const handleAuthSuccess = useCallback(
    async (auth: AuthSuccess) => {
      applySession(auth);
      if (auth.mfaSetupRequired) {
        navigate('/security?setupMfa=1', { replace: true });
        return;
      }
      navigate('/workspace', { replace: true });
    },
    [applySession, navigate],
  );

  const handleUserUpdate = useCallback((user: AuthUser) => {
    setSession((current) => {
      if (!current) return current;
      const next = { ...current, user };
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures in restricted environments.
      }
      return next;
    });
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
      applySession(null);
      navigate('/auth', { replace: true });
    }
  }, [applySession, navigate, session]);

  const handleOpenSecuritySettings = useCallback(() => {
    navigate('/settings?view=security');
  }, [navigate]);

  const handleOpenProfile = useCallback(() => {
    navigate('/settings?view=profile');
  }, [navigate]);

  const handleOpenSettingsDashboard = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      if (path.startsWith('/admin')) {
        applyAdminSession(null);
        navigate('/admin', { replace: true });
        return;
      }
      applySession(null);
      navigate('/auth', { replace: true });
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [applyAdminSession, applySession, navigate]);

  return (
    <>
      <Suspense
        fallback={(
          <AppLoadingScreen title="Loading DocSync" subtitle="Preparing your workspace and editor modules..." />
        )}
      >
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
        path="/home"
        element={
          <LandingPage
            onGetStarted={() => navigate(session ? '/workspace' : '/auth')}
            onSignIn={() => navigate('/auth')}
            isSignedIn={Boolean(session)}
            userName={session?.user.name || 'Workspace User'}
            onOpenProfile={handleOpenProfile}
            onLogout={handleLogout}
            onOpenWorkspace={() => navigate('/workspace')}
          />
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
                applySession(null);
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
              onOpenProfile={handleOpenProfile}
              onOpenSecuritySettings={handleOpenSecuritySettings}
              onOpenSettingsDashboard={handleOpenSettingsDashboard}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/home" replace />
          )
        }
      />
      <Route
        path="/admin"
        element={
          adminSession ? (
            <OrganizationAdminPage
              token={adminSession.accessToken}
              userName={adminSession.user.name}
              onAdminLogout={() => applyAdminSession(null)}
            />
          ) : (
            <AdminLoginPage onAuthSuccess={applyAdminSession} />
          )
        }
      />
      <Route
        path="/enterprise-security"
        element={
          session ? (
            <Navigate to="/settings" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/settings"
        element={
          session ? (
            <SettingsDashboardPage token={session.accessToken} userName={session.user.name} />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/organization-audit"
        element={
          session ? (
            <Navigate to="/settings" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/billing"
        element={
          session ? (
            <Navigate to="/settings" replace />
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
      <Route
        path="/editor/:docId"
        element={
          session ? <EditorRoute token={session.accessToken} /> : <Navigate to="/auth" replace />
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
      </Suspense>
      {!authReady && (
        <AppLoadingScreen
          title="Restoring your secure session"
          subtitle="Syncing credentials and workspace state..."
        />
      )}
    </>
  );
}

function EditorRoute({ token }: { token: string }) {
  const { docId = '' } = useParams();
  if (!docId) return <Navigate to="/workspace" replace />;
  return <EditorView token={token} docId={docId} />;
}

function ReadOnlyDocumentRoute({ token, userName }: { token: string; userName: string }) {
  const { docId = '' } = useParams();
  if (!docId) return <Navigate to="/workspace" replace />;
  return <ReadOnlyDocumentView token={token} docId={docId} userName={userName} />;
}

export default App;
