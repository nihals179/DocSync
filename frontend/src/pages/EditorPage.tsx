import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/layout/Header';
import RichEditor from '../components/editor/RichEditor';
import Toolbar from '../components/editor/toolbar/Toolbar';
import ThemeListbox from '../components/common/ThemeListbox';
import RestoreVersionDialog from '../components/common/RestoreVersionDialog';
import type { CursorFormat, RichEditorHandle, Run } from '../components/editor';
import { isPageSize, type PageSize } from '../components/editor/pageConfig';
import { ApiError, docsApi, editorApi, versionsApi } from '../services/api';
import { canvasRunsToHtml, canvasTextToHtml, htmlToRuns } from '../utils/contentAdapter';
import { buildDocumentTree } from '../utils/documentTree';
import { getInitialWorkspaceSelectionId, persistWorkspaceSelectionId } from '../utils/workspaceSelection';
import { prettyPrintHtml, colorizeHtml } from '../utils/htmlFormatting';
import type {
  EditorDocNode,
  EditorWorkspaceModalState,
  RightTool,
  SavedDocument,
  SavedVersion,
  WorkspaceSummary,
} from '../types/document.types';

const AiTool = lazy(() => import('../features/panels/AiTool'));
const Comments = lazy(() => import('../features/panels/Comments'));
const GrammarChecker = lazy(() => import('../features/panels/GrammarChecker'));
const SavedDocuments = lazy(() => import('../features/panels/SavedDocuments'));
const TodoList = lazy(() => import('../features/panels/TodoList'));

const RIGHT_TOOLS: { id: RightTool; icon: string; label: string }[] = [
  { id: 'comments', icon: 'comment', label: 'Comments' },
  { id: 'versions', icon: 'description', label: 'Saved Versions' },
  { id: 'todo', icon: 'checklist', label: 'To-Do List' },
  { id: 'grammar', icon: 'spellcheck', label: 'Grammar Checker' },
  { id: 'ai', icon: 'smart_toy', label: 'AI Assistant' },
  { id: 'html', icon: 'code', label: 'HTML Renderer' },
];

const WORKSPACE_PANEL_COLLAPSED_KEY = 'docsync.workspacePanelCollapsed';
const PAGE_SIZE_STORAGE_KEY = 'docsync.pageSize';
const MAX_TITLE_LENGTH = 255;
const EMPTY_TITLE_MESSAGE = 'Add a title — changes aren’t being saved until the document has one.';
const NO_CHANGES_MESSAGE = 'No changes since the last commit.';
const ALREADY_PUBLISHED_MESSAGE = 'Already published — no changes since.';
const SAVE_NOTICE_MS = 4000;
/** The server keeps this many unpublished versions per document; published ones are never pruned. */
const MAX_UNPUBLISHED_VERSIONS = 20;

type VersionSaveResult = 'saved' | 'promoted' | 'unchanged' | 'failed';
type LoadState = 'loading' | 'ready' | 'error';
/** A document's title and content as they stood when an autosave was scheduled. */
type AutoSaveTarget = { docId: string; title: string; html: string };

/** The HTML the editor saves for its current runs (or plain text when it has no runs). */
function serializeEditorHtml(runs: Run[], text: string): string {
  return runs.length > 0 ? canvasRunsToHtml(runs) : canvasTextToHtml(text);
}

/** HTML as the editor itself would save it, so stored HTML in another format compares equal. */
function toEditorHtml(html: string): string {
  return serializeEditorHtml(htmlToRuns(html), '');
}

/** Turns a failed request into a sentence for the editor's error bar. */
function describeSaveError(error: unknown): string {
  // fetch() rejects with a TypeError when the server can't be reached.
  if (error instanceof TypeError) return 'Can’t reach the server.';
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong.';
  return message.charAt(0).toUpperCase() + message.slice(1);
}

// ─── Editor page (all hooks live here, never behind a conditional) ────────────
function EditorPage({ token, docId }: { token: string; docId: string }) {

  const navigate = useNavigate();

  const editorRef = useRef<RichEditorHandle | null>(null);
  const savePopupRef = useRef<HTMLDivElement | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const [currentText, setCurrentText] = useState('');
  const [currentRuns, setCurrentRuns] = useState<Run[]>([]);
  const [savedVersions, setSavedVersions] = useState<SavedVersion[]>([]);
  // The version the Versions panel is restoring, if any.
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const restoringVersionIdRef = useRef<string | null>(null);
  // A version picked from a comment, waiting for the user to confirm the restore.
  const [restoreConfirm, setRestoreConfirm] = useState<{ versionId: string; savedAt: string } | null>(null);
  // The version the document is on: the last one committed, published or restored. Its
  // comments are the current ones.
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
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
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  // Content of the newest version (null when there is none); what Commit compares against.
  const [lastVersionHtml, setLastVersionHtml] = useState<string | null>(null);
  // The content of the version the document is on (normalized), to tell whether a restore
  // would discard anything. Differs from lastVersionHtml after restoring an older version.
  const [currentVersionHtml, setCurrentVersionHtml] = useState<string | null>(null);
  const [lastVersionPublished, setLastVersionPublished] = useState(false);
  const [versionAction, setVersionAction] = useState<'commit' | 'publish' | null>(null);
  // Guards against a second Commit/Publish (double click, held Ctrl+S) before React re-renders.
  const versionActionRef = useRef<'commit' | 'publish' | null>(null);
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
  // What autosave last stored for the open document, in the editor's own HTML.
  const lastAutoSavedHtmlRef = useRef<string>('');
  const lastAutoSavedTitleRef = useRef<string>('');
  // Saves and edits are only allowed once the open document has loaded ('ready'); the ref
  // is what callbacks read, so a switch to another document blocks them immediately.
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const loadStateRef = useRef<LoadState>('loading');
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const currentDocIdRef = useRef(docId);
  // Autosaves are tracked per document: a save never waits on another document's save,
  // and a change made while its document is saving is queued until that save finishes.
  const savingDocIdsRef = useRef<Set<string>>(new Set());
  const queuedSavesRef = useRef<Map<string, AutoSaveTarget>>(new Map());
  // Changes not yet handed to a save; flushed when leaving the document.
  const pendingSaveRef = useRef<AutoSaveTarget | null>(null);
  // The autosave request in flight for each document, so a restore can wait for it.
  const inFlightSavesRef = useRef<Map<string, Promise<unknown>>>(new Map());
  // A failed save of a document that is no longer open, shown until dismissed.
  const [otherDocSaveError, setOtherDocSaveError] = useState('');

  function normalizeVersionHtml(html: string) {
    return String(html || '').trim();
  }

  function showSaveNotice(message: string) {
    setSaveError('');
    setSaveNotice(message);
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

  /**
   * Saves a document's title and content in the background. Results only touch the editor's
   * state while that document is still open; a failure after leaving it is reported apart.
   */
  const runAutoSave = useCallback(async (target: AutoSaveTarget): Promise<void> => {
    const isOpen = () => currentDocIdRef.current === target.docId;
    const normalizedHtml = normalizeVersionHtml(target.html);
    const normalizedTitle = target.title.trim();
    if (pendingSaveRef.current === target) pendingSaveRef.current = null;

    // The server rejects an empty title, and title and content save together, so
    // nothing is sent until the document has a title again.
    if (!normalizedTitle) {
      if (isOpen()) {
        setAutoSaveStatus('error');
        setSaveError(`Not saved: ${EMPTY_TITLE_MESSAGE}`);
      }
      return;
    }
    if (savingDocIdsRef.current.has(target.docId)) {
      queuedSavesRef.current.set(target.docId, target);
      return;
    }
    if (isOpen() && normalizedHtml === lastAutoSavedHtmlRef.current && normalizedTitle === lastAutoSavedTitleRef.current) {
      return;
    }

    savingDocIdsRef.current.add(target.docId);
    if (isOpen()) setAutoSaveStatus('saving');
    try {
      // The cloud icon shows progress, so the page-wide loading overlay stays out of the way.
      const request = docsApi.update(token, target.docId, { title: target.title, content: target.html }, { background: true });
      inFlightSavesRef.current.set(target.docId, request);
      await request;
      if (isOpen()) {
        lastAutoSavedHtmlRef.current = normalizedHtml;
        lastAutoSavedTitleRef.current = normalizedTitle;
        setAutoSaveStatus('saved');
        setSaveError('');
      }
      setSavedDocuments((prev) => prev.map((doc) => (
        doc.id === target.docId ? { ...doc, title: target.title, updatedAt: new Date().toISOString() } : doc
      )));
      // The preview comes from the server, so the sidebar search matches what GET /api/docs builds.
      void docsApi.list(token, { background: true }).then(({ docs }) => setSavedDocuments(docs)).catch(() => {});
    } catch (error: unknown) {
      console.error('Autosave failed.', error);
      if (isOpen()) {
        setAutoSaveStatus('error');
        setSaveError(`Not saved: ${describeSaveError(error)}`);
      } else {
        setOtherDocSaveError(`Changes to “${normalizedTitle}” weren’t saved: ${describeSaveError(error)}`);
      }
    } finally {
      savingDocIdsRef.current.delete(target.docId);
      inFlightSavesRef.current.delete(target.docId);
      const queued = queuedSavesRef.current.get(target.docId);
      if (queued) {
        queuedSavesRef.current.delete(target.docId);
        void runAutoSave(queued);
      }
    }
  }, [token]);

  const runAutoSaveRef = useRef(runAutoSave);
  useEffect(() => {
    runAutoSaveRef.current = runAutoSave;
  }, [runAutoSave]);

  // The access token is refreshed while the editor is open; loading reads it from a ref so a
  // refresh doesn't reload the document and throw away what was typed since the last save.
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Leaving a document (switching to another, or closing the editor) saves its changes at
  // once instead of dropping them with the pending debounce.
  useEffect(() => () => {
    const pending = pendingSaveRef.current;
    if (pending && pending.docId === docId) void runAutoSaveRef.current(pending);
  }, [docId]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingSaveRef.current && savingDocIdsRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;

    // Clear the previous document first, so nothing of it can be saved into this one
    // while this one loads.
    currentDocIdRef.current = docId;
    loadStateRef.current = 'loading';
    setLoadState('loading');
    setLoadError(null);
    pendingSaveRef.current = null;
    lastAutoSavedHtmlRef.current = '';
    lastAutoSavedTitleRef.current = '';
    setTitle('');
    setCurrentText('');
    setCurrentRuns([]);
    editorRef.current?.setRuns([]);
    // The loading overlay blocks the mouse; take focus off the canvas so keystrokes can't
    // land in it either and then be replaced by the loaded content.
    if (document.activeElement instanceof HTMLElement && editorShellRef.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setSavedVersions([]);
    setRestoreConfirm(null);
    // A restore still running belongs to the previous document; it checks and stops itself.
    restoringVersionIdRef.current = null;
    setRestoringVersionId(null);
    setCurrentVersionId(null);
    setCurrentVersionHtml(null);
    setLastVersionHtml(null);
    setLastVersionPublished(false);
    setSaveError('');
    setSaveNotice('');
    setAutoSaveStatus('idle');
    setShowSavePopup(false);
    setSaveMessage('');
    setHtmlEditMode(false);

    editorApi
      .bootstrap(tokenRef.current, docId)
      .then(({ doc, versions, latestVersion, currentVersion, docs, workspaces: available }) => {
        if (cancelled) return;

        setTitle(doc.title ?? '');
        setSavedDocuments(docs);
        setSavedVersions(versions);
        // The server's rule (the base version, else the newest), the same one Comments use.
        setCurrentVersionId(currentVersion?.id ?? null);
        setWorkspaces(available);

        const currentWorkspaceId = selectedWorkspaceIdRef.current;
        const fallbackWorkspaceId = available[0]?.id ?? '';
        if (!available.some((workspace) => workspace.id === currentWorkspaceId)) {
          setSelectedWorkspaceId(fallbackWorkspaceId);
        }

        // Compare against the content as the editor serializes it: documents stored in
        // another HTML format (templates, the API) would otherwise look changed on open
        // and be saved without an edit.
        const runs = htmlToRuns(doc.content ?? '');
        setLastVersionHtml(latestVersion ? normalizeVersionHtml(toEditorHtml(latestVersion.content)) : null);
        setLastVersionPublished(Boolean(latestVersion?.isPublished));
        const currentContent = currentVersion ? (currentVersion.content ?? latestVersion?.content) : undefined;
        setCurrentVersionHtml(currentContent === undefined ? null : normalizeVersionHtml(toEditorHtml(currentContent)));
        lastAutoSavedHtmlRef.current = normalizeVersionHtml(serializeEditorHtml(runs, ''));
        lastAutoSavedTitleRef.current = String(doc.title || '').trim();

        setCurrentRuns(runs);
        editorRef.current?.setRuns(runs);
        loadStateRef.current = 'ready';
        setLoadState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Failed to bootstrap editor.', error);
        loadStateRef.current = 'error';
        setLoadState('error');
        setLoadError({
          notFound: error instanceof ApiError && error.status === 404,
          message: describeSaveError(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [docId, reloadKey]);

  useEffect(() => {
    // The ref, not the state: on the render that switches documents the state still says
    // 'ready' for the previous one.
    if (!docId || loadStateRef.current !== 'ready') return;
    // A restore replaces the content; saving the old content meanwhile would undo it.
    if (restoringVersionIdRef.current) return;

    const html = serializeEditorHtml(currentRuns, currentText);
    const unchanged = normalizeVersionHtml(html) === lastAutoSavedHtmlRef.current
      && String(title || '').trim() === lastAutoSavedTitleRef.current;
    const target: AutoSaveTarget = { docId, title, html };
    pendingSaveRef.current = unchanged ? null : target;

    const timeoutId = window.setTimeout(() => {
      // A restore may have started after this was scheduled.
      if (restoringVersionIdRef.current) return;
      if (unchanged) {
        // Back to what is already saved (e.g. the old title was typed again): nothing is
        // unsaved, so an earlier error no longer applies.
        setSaveError('');
        setAutoSaveStatus((status) => (status === 'error' ? 'saved' : status));
        return;
      }
      void runAutoSave(target);
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [docId, title, currentText, currentRuns, loadState, restoringVersionId, runAutoSave]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, pageSize);
    } catch {
      // Ignore storage access issues.
    }
  }, [pageSize]);

  /**
   * Saves a version of the current content (published when asked). The server decides whether
   * anything changed, so a commit made in another tab is reported as 'unchanged', not an error.
   */
  const saveVersion = useCallback(
    async (previewText?: string, options: { published?: boolean } = {}): Promise<VersionSaveResult> => {
      if (!docId || loadStateRef.current !== 'ready' || restoringVersionIdRef.current) return 'failed';
      const html = serializeEditorHtml(currentRuns, currentText);
      try {
        const preview = buildVersionPreview(html, previewText);
        const { version, promoted } = await versionsApi.save(token, docId, html, preview, options);
        setLastVersionHtml(normalizeVersionHtml(html));
        setLastVersionPublished(version.isPublished);
        setCurrentVersionId(version.id);
        setCurrentVersionHtml(normalizeVersionHtml(html));
        setSavedVersions((prev) => {
          if (promoted) return prev.map((item) => (item.id === version.id ? { ...item, isPublished: true } : item));
          let unpublished = 0;
          return [version, ...prev].filter((item) => {
            if (item.isPublished) return true;
            unpublished += 1;
            return unpublished <= MAX_UNPUBLISHED_VERSIONS;
          });
        });
        return promoted ? 'promoted' : 'saved';
      } catch (error: unknown) {
        if (error instanceof ApiError && error.code === 'NO_CHANGES') {
          setLastVersionHtml(normalizeVersionHtml(html));
          // Publishing is only refused when the latest version is already published.
          if (options.published) setLastVersionPublished(true);
          return 'unchanged';
        }
        console.error('Failed to save version.', error);
        setSaveError(`Version not saved: ${describeSaveError(error)}`);
        return 'failed';
      }
    },
    [token, docId, currentText, currentRuns],
  );

  const handleSwitchSavedVersion = useCallback(
    async (versionId: string) => {
      if (!docId || loadStateRef.current !== 'ready' || restoringVersionIdRef.current) return;
      restoringVersionIdRef.current = versionId;
      setRestoringVersionId(versionId);
      // The restore replaces the content (the dialog said so): drop edits waiting to be saved,
      // and let a save already on its way land first so it can't overwrite the restore.
      pendingSaveRef.current = null;
      queuedSavesRef.current.delete(docId);
      const isStillOpen = () => currentDocIdRef.current === docId;
      // Background requests: the Versions panel and the canvas show the progress, not the
      // full-page overlay.
      const background = { background: true };
      try {
        await inFlightSavesRef.current.get(docId)?.catch(() => {});
        if (!isStillOpen()) return;
        await versionsApi.restore(token, docId, versionId, background);
        if (!isStillOpen()) return;
        const [{ doc }, { versions: allVersions }, { docs }] = await Promise.all([
          docsApi.get(token, docId, background),
          versionsApi.listAll(token, { docId, limit: 500 }, background),
          docsApi.list(token, background),
        ]);
        // Another document was opened meanwhile: none of this belongs on it.
        if (!isStillOpen()) return;

        const restoredContent = doc.content ?? '';
        const restoredTitle = doc.title ?? '';
        const restoredRuns = htmlToRuns(restoredContent);
        const normalizedHtml = normalizeVersionHtml(serializeEditorHtml(restoredRuns, ''));
        const normalizedTitle = String(restoredTitle || '').trim();

        setTitle(restoredTitle);
        setCurrentVersionId(doc.baseVersionId ?? versionId);
        setCurrentVersionHtml(normalizedHtml);
        setSavedDocuments(docs);
        setSavedVersions(
          allVersions
            .map((version) => ({
              id: version.id,
              preview: version.preview,
              savedAt: version.savedAt,
              isPublished: version.isPublished,
            }))
            .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()),
        );
        setCurrentRuns(restoredRuns);
        editorRef.current?.setRuns(restoredRuns);

        // A restore leaves the newest version as it is, so committing the restored content
        // (a rollback) counts as a change unless the restored version was the newest one.
        lastAutoSavedHtmlRef.current = normalizedHtml;
        lastAutoSavedTitleRef.current = normalizedTitle;
        setSaveError('');
      } catch (error: unknown) {
        console.error('Failed to switch saved version.', error);
        if (isStillOpen()) setSaveError(`Couldn’t restore that version: ${describeSaveError(error)}`);
      } finally {
        // Only clear our own flag: after a document switch another restore may be running.
        if (restoringVersionIdRef.current === versionId) {
          restoringVersionIdRef.current = null;
          setRestoringVersionId(null);
        }
      }
    },
    [docId, token],
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

  function openDeleteModal(docIdValue: string) {
    const doc = savedDocuments.find((d) => d.id === docIdValue);
    if (!doc) return;
    setWorkspaceModal({
      type: 'confirm-delete',
      docId: docIdValue,
      title: doc.title || 'Untitled',
      descendantCount: getDescendantIds(docIdValue).size,
    });
  }

  async function deleteDocument(docIdValue: string) {
    // The server deletes the whole subtree; leave the editor if the open document is in it.
    const deletedIds = new Set([docIdValue, ...getDescendantIds(docIdValue)]);
    setWorkspaceModal((prev) =>
      prev && prev.type === 'confirm-delete' ? { ...prev, deleting: true, error: undefined } : prev,
    );
    try {
      await docsApi.delete(token, docIdValue);
      if (deletedIds.has(docId)) {
        setWorkspaceModal(null);
        navigate('/workspace');
        return;
      }
      const { docs: list } = await docsApi.list(token);
      setSavedDocuments(list);
      setWorkspaceModal(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to delete document';
      setWorkspaceModal((prev) =>
        prev && prev.type === 'confirm-delete' ? { ...prev, deleting: false, error: message } : prev,
      );
    }
  }

  async function moveDocToWorkspace(docIdValue: string, targetWorkspaceId: string | null) {
    const doc = savedDocuments.find((d) => d.id === docIdValue);
    if (!doc) return;

    try {
      // The server moves the document with its subtree to the top of the target workspace.
      await docsApi.update(token, docIdValue, { workspaceId: targetWorkspaceId });
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
    const menuHeight = 140;
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

    try {
      // One request: the server re-parents the document (and its subtree) and renumbers
      // both the old and the new sibling lists in a single transaction.
      await docsApi.move(token, docIdValue, {
        workspaceId: destinationWorkspaceId,
        parentId: destinationParentId,
        index: insertIndex,
      });
      const { docs: list } = await docsApi.list(token);
      setSavedDocuments(list);
      if (destinationParentId) {
        setExpandedNodes((prev) => new Set([...prev, destinationParentId]));
      }
    } catch (e) {
      setWorkspaceModal({
        type: 'info',
        title: 'Could Not Move Document',
        message: e instanceof Error ? e.message : 'Failed to move document.',
      });
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

  /** Saves title and content right away (Commit, Publish). Resolves false when it failed. */
  const saveDocumentNow = useCallback(async (): Promise<boolean> => {
    if (!docId || loadStateRef.current !== 'ready' || restoringVersionIdRef.current) return false;
    const normalizedTitle = String(title || '').trim();
    if (!normalizedTitle) {
      setAutoSaveStatus('error');
      setSaveError(`Not saved: ${EMPTY_TITLE_MESSAGE}`);
      return false;
    }
    const html = serializeEditorHtml(currentRuns, currentText);
    const normalizedHtml = normalizeVersionHtml(html);
    // Autosave already stored exactly this, so skip the round trip unless a save is in flight.
    const alreadySaved = !savingDocIdsRef.current.has(docId)
      && normalizedHtml === lastAutoSavedHtmlRef.current
      && normalizedTitle === lastAutoSavedTitleRef.current;
    if (alreadySaved) return true;
    try {
      await docsApi.update(token, docId, { title, content: html }, { background: true });
    } catch (error: unknown) {
      console.error('Save failed.', error);
      setAutoSaveStatus('error');
      setSaveError(`Not saved: ${describeSaveError(error)}`);
      return false;
    }
    lastAutoSavedHtmlRef.current = normalizedHtml;
    lastAutoSavedTitleRef.current = normalizedTitle;
    setAutoSaveStatus('saved');
    setSaveError('');
    // Refreshing the sidebar is best effort; the save itself already succeeded.
    void docsApi.list(token, { background: true }).then(({ docs }) => setSavedDocuments(docs)).catch(() => {});
    return true;
  }, [token, docId, title, currentText, currentRuns]);

  /** True when the editor content differs from the newest version (or there is none yet). */
  const hasUncommittedChanges = useMemo(
    () => normalizeVersionHtml(serializeEditorHtml(currentRuns, currentText)) !== lastVersionHtml,
    [currentRuns, currentText, lastVersionHtml],
  );

  /**
   * True when the content differs from the version the document is on, so restoring another
   * version would discard something. Unlike hasUncommittedChanges, this is false right after a
   * restore of an older version.
   */
  const hasChangesSinceCurrentVersion = useMemo(
    () => normalizeVersionHtml(serializeEditorHtml(currentRuns, currentText)) !== currentVersionHtml,
    [currentRuns, currentText, currentVersionHtml],
  );

  /** Asks before restoring: from a comment's version or from a Saved Versions row. */
  const askToRestore = useCallback((versionId: string) => {
    const version = savedVersions.find((item) => item.id === versionId);
    if (version) setRestoreConfirm({ versionId, savedAt: version.savedAt });
  }, [savedVersions]);
  const closeRestoreConfirm = useCallback(() => setRestoreConfirm(null), []);

  /** Runs one Commit or Publish at a time, with the buttons showing it in progress. */
  const runVersionAction = useCallback(async (action: 'commit' | 'publish', work: () => Promise<void>) => {
    if (versionActionRef.current) return;
    versionActionRef.current = action;
    setVersionAction(action);
    try {
      await work();
    } finally {
      versionActionRef.current = null;
      setVersionAction(null);
    }
  }, []);

  const handleSaveDocument = useCallback(async () => {
    if (versionActionRef.current || loadStateRef.current !== 'ready' || restoringVersionIdRef.current) return;
    if (!hasUncommittedChanges) {
      showSaveNotice(NO_CHANGES_MESSAGE);
      return;
    }
    const trimmed = saveMessage.trim();
    await runVersionAction('commit', async () => {
      // On failure the commit popup stays open and no version is saved for unsaved content.
      if (!(await saveDocumentNow())) return;
      const result = await saveVersion(trimmed.length > 0 ? trimmed : undefined);
      if (result === 'failed') return;
      setShowSavePopup(false);
      setSaveMessage('');
      showSaveNotice(result === 'unchanged' ? NO_CHANGES_MESSAGE : 'Committed.');
    });
  }, [hasUncommittedChanges, saveMessage, runVersionAction, saveVersion, saveDocumentNow]);

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
    if (versionActionRef.current || loadStateRef.current !== 'ready' || restoringVersionIdRef.current) return;
    if (!hasUncommittedChanges && lastVersionPublished) {
      showSaveNotice(ALREADY_PUBLISHED_MESSAGE);
      return;
    }
    await runVersionAction('publish', async () => {
      if (!(await saveDocumentNow())) return;
      const result = await saveVersion(undefined, { published: true });
      if (result === 'saved') showSaveNotice('Published.');
      else if (result === 'promoted') showSaveNotice('Published the latest commit.');
      else if (result === 'unchanged') showSaveNotice(ALREADY_PUBLISHED_MESSAGE);
    });
  }, [hasUncommittedChanges, lastVersionPublished, runVersionAction, saveVersion, saveDocumentNow]);

  useEffect(() => {
    if (!saveNotice) return;
    const timeoutId = window.setTimeout(() => setSaveNotice(''), SAVE_NOTICE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [saveNotice]);

  const docText = currentText;
  const renderedHtml = useMemo(() => serializeEditorHtml(currentRuns, currentText), [currentRuns, currentText]);
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
                <>
                <div className="mb-1 flex items-center gap-2 border-b border-slate-200 px-1 pb-1">
                  <input
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    maxLength={MAX_TITLE_LENGTH}
                    placeholder={loadState === 'ready' ? 'Untitled document' : ''}
                    disabled={loadState !== 'ready' || restoringVersionId !== null}
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
                            ? saveError || 'Save failed'
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
                      disabled={versionAction !== null || loadState !== 'ready' || restoringVersionId !== null}
                      aria-busy={versionAction === 'commit'}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {versionAction === 'commit' && (
                        <span className="material-icons animate-spin" style={{ fontSize: '0.9rem' }}>autorenew</span>
                      )}
                      {versionAction === 'commit' ? 'Committing…' : 'Commit'}
                    </button>
                    {showSavePopup && (
                      <div className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                          Commit message
                        </label>
                        <textarea
                          value={saveMessage}
                          disabled={versionAction !== null}
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
                        {saveError && <p className="mb-2 text-[11px] leading-4 text-red-600">{saveError}</p>}
                        {!saveError && !hasUncommittedChanges && (
                          <p className="mb-2 text-[11px] leading-4 text-slate-500">{NO_CHANGES_MESSAGE}</p>
                        )}
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
                            disabled={versionAction !== null || !hasUncommittedChanges}
                            title={hasUncommittedChanges ? undefined : NO_CHANGES_MESSAGE}
                            className="inline-flex items-center gap-1 rounded bg-cyan-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {versionAction === 'commit' && (
                              <span className="material-icons animate-spin" style={{ fontSize: '0.8rem' }}>autorenew</span>
                            )}
                            {versionAction === 'commit' ? 'Committing…' : 'Commit'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePublishDocument()}
                    disabled={versionAction !== null || loadState !== 'ready' || restoringVersionId !== null}
                    aria-busy={versionAction === 'publish'}
                    className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {versionAction === 'publish' && (
                      <span className="material-icons animate-spin" style={{ fontSize: '0.9rem' }}>autorenew</span>
                    )}
                    {versionAction === 'publish' ? 'Publishing…' : 'Publish'}
                  </button>
                </div>
                {saveError && (
                  <div
                    role="alert"
                    className="mb-1 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600"
                  >
                    <span className="material-icons shrink-0" style={{ fontSize: '0.95rem' }}>error_outline</span>
                    <span className="min-w-0 flex-1">{saveError}</span>
                    <button
                      type="button"
                      onClick={() => setSaveError('')}
                      aria-label="Dismiss"
                      className="shrink-0 rounded text-red-400 hover:text-red-600"
                    >
                      <span className="material-icons" style={{ fontSize: '0.95rem' }}>close</span>
                    </button>
                  </div>
                )}
                {otherDocSaveError && (
                  <div
                    role="alert"
                    className="mb-1 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600"
                  >
                    <span className="material-icons shrink-0" style={{ fontSize: '0.95rem' }}>error_outline</span>
                    <span className="min-w-0 flex-1">{otherDocSaveError}</span>
                    <button
                      type="button"
                      onClick={() => setOtherDocSaveError('')}
                      aria-label="Dismiss"
                      className="shrink-0 rounded text-red-400 hover:text-red-600"
                    >
                      <span className="material-icons" style={{ fontSize: '0.95rem' }}>close</span>
                    </button>
                  </div>
                )}
                {saveNotice && !saveError && (
                  <div
                    role="status"
                    className="mb-1 flex items-start gap-2 rounded-lg bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-700"
                  >
                    <span className="material-icons shrink-0" style={{ fontSize: '0.95rem' }}>info</span>
                    <span className="min-w-0 flex-1">{saveNotice}</span>
                    <button
                      type="button"
                      onClick={() => setSaveNotice('')}
                      aria-label="Dismiss"
                      className="shrink-0 rounded text-cyan-400 hover:text-cyan-700"
                    >
                      <span className="material-icons" style={{ fontSize: '0.95rem' }}>close</span>
                    </button>
                  </div>
                )}
                </>
              )}
              {loadState === 'error' ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                  <div role="alert" className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                    <span className="material-icons mb-2 block text-3xl text-slate-300">
                      {loadError?.notFound ? 'find_in_page' : 'cloud_off'}
                    </span>
                    <h2 className="text-base font-bold text-slate-800">
                      {loadError?.notFound ? 'Document not found' : 'Couldn’t open this document'}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {loadError?.notFound ? 'It may have been deleted, or the link is wrong.' : loadError?.message}
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      {!loadError?.notFound && (
                        <button
                          type="button"
                          onClick={() => setReloadKey((key) => key + 1)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Try again
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate('/workspace')}
                        className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
                      >
                        Back to workspace
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <Toolbar
                    editorRef={editorRef}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    isFullscreen={showFullscreenEditor}
                    onToggleFullscreen={() => setIsFullscreenEditor((p) => !p)}
                    cursorFormat={cursorFormat}
                  />
                  <div className="relative min-h-0 flex-1 overflow-hidden">
                    <RichEditor
                      ref={editorRef}
                      onContentChange={handleEditorChange}
                      onRunsChange={handleRunsChange}
                      onCursorFormatChange={setCursorFormat}
                      pageSize={pageSize}
                    />
                    {(loadState === 'loading' || restoringVersionId) && (
                      // Covers the canvas so nothing can be typed until the document (or the
                      // version being restored) has loaded.
                      <div
                        role="status"
                        aria-label="Loading document"
                        className="absolute inset-0 z-10 flex items-center justify-center bg-white/70"
                      >
                        <span className="material-icons animate-spin text-cyan-600" style={{ fontSize: '1.6rem' }}>autorenew</span>
                      </div>
                    )}
                  </div>
                </>
              )}
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
                      // A fresh panel per document, so one document's comments never show on another.
                      key={docId}
                      docId={docId}
                      token={token}
                      versions={savedVersions}
                      currentVersionId={currentVersionId}
                      onOpenVersion={askToRestore}
                    />
                  )}
                  {activeTool === 'versions' && (
                    <SavedDocuments
                      versions={savedVersions}
                      restoringVersionId={restoringVersionId}
                      currentVersionId={currentVersionId}
                      onSwitchVersion={askToRestore}
                    />
                  )}
                  {activeTool === 'todo' && <TodoList key={docId} docId={docId} token={token} />}
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
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => {
              openDeleteModal(contextMenu.docId);
              setContextMenu(null);
            }}
          >
            <span className="material-icons" style={{ fontSize: '0.9rem' }}>delete</span>
            Delete
          </button>
        </div>
      )}

      {restoreConfirm && (
        <RestoreVersionDialog
          savedAt={restoreConfirm.savedAt}
          warnUnsavedChanges={hasChangesSinceCurrentVersion}
          onCancel={closeRestoreConfirm}
          onConfirm={() => {
            const { versionId } = restoreConfirm;
            setRestoreConfirm(null);
            // Show Saved Versions, so the restore's progress and the loaded version are visible.
            setActiveTool('versions');
            void handleSwitchSavedVersion(versionId);
          }}
        />
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

            {workspaceModal.type === 'confirm-delete' && (
              <>
                <h3 className="text-base font-bold text-slate-800">Delete Document</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Delete <span className="font-semibold text-slate-800">&lsquo;{workspaceModal.title}&rsquo;</span>
                  {workspaceModal.descendantCount > 0
                    ? ` and its ${workspaceModal.descendantCount} sub-document${workspaceModal.descendantCount === 1 ? '' : 's'}`
                    : ''}
                  ? {workspaceModal.descendantCount > 0 ? 'Their' : 'Its'} comments and unpublished versions are deleted too; published versions are kept as a backup. This can&apos;t be undone.
                </p>
                {workspaceModal.error && <p className="mt-2 text-xs text-red-600">{workspaceModal.error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWorkspaceModal(null)}
                    disabled={workspaceModal.deleting}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteDocument(workspaceModal.docId)}
                    disabled={workspaceModal.deleting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {workspaceModal.deleting ? 'Deleting…' : 'Delete'}
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

export default EditorPage;
