import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ThemeListbox from '../components/common/ThemeListbox';
import { docsApi, versionsApi, workspaceApi } from '../services/api';
import { buildDocumentTree } from '../utils/documentTree';
import { getInitialWorkspaceSelectionId, persistWorkspaceSelectionId } from '../utils/workspaceSelection';
import type {
  EditorDocNode,
  SavedDocument,
  SavedVersion,
  WorkspaceSummary,
} from '../types/document.types';

const VIEWER_WORKSPACE_PANEL_COLLAPSED_KEY = 'docsync.viewerWorkspacePanelCollapsed';

function DocumentViewerPage({ token, docId, userName }: { token: string; docId: string; userName: string }) {
  const navigate = useNavigate();
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[]>([]);
  const [docVersions, setDocVersions] = useState<SavedVersion[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => getInitialWorkspaceSelectionId());
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [currentDoc, setCurrentDoc] = useState<{ id: string; title: string; content: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [isViewerMenuOpen, setIsViewerMenuOpen] = useState(false);
  const [isVersionsLoading, setIsVersionsLoading] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [versionMessage, setVersionMessage] = useState('');
  const [switchingVersionId, setSwitchingVersionId] = useState<string | null>(null);
  const viewerMenuRef = useRef<HTMLDivElement | null>(null);
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

  const canSwitchVersions = useMemo(
    () => docVersions.length > 0 && !isLoading && !error,
    [docVersions.length, error, isLoading],
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
    if (!isViewerMenuOpen) return;

    const closeMenu = () => setIsViewerMenuOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (viewerMenuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isViewerMenuOpen]);

  useEffect(() => {
    let ignore = false;

    async function loadViewerData() {
      setIsLoading(true);
      setError('');
      setVersionError('');

      try {
        const [{ docs }, { doc }, { workspaces: available }, { versions }] = await Promise.all([
          docsApi.list(token),
          docsApi.get(token, docId),
          workspaceApi.list(token),
          versionsApi.list(token, docId),
        ]);
        if (ignore) return;
        setSavedDocuments(docs);
        setCurrentDoc(doc);
        setWorkspaces(available);
        setDocVersions(versions);
        setVersionMessage('');
        const fallbackWorkspaceId = available[0]?.id ?? '';
        if (!available.some((workspace) => workspace.id === selectedWorkspaceId)) {
          setSelectedWorkspaceId(fallbackWorkspaceId);
        }
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : 'Failed to load document');
        setDocVersions([]);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    void loadViewerData();
    return () => {
      ignore = true;
    };
  }, [token, docId, selectedWorkspaceId]);

  async function handleSwitchVersion(versionId: string) {
    setSwitchingVersionId(versionId);
    setVersionError('');
    setVersionMessage('');
    setIsVersionsLoading(true);
    try {
      await versionsApi.restore(token, docId, versionId);
      const [{ doc }, { docs }, { versions }] = await Promise.all([
        docsApi.get(token, docId),
        docsApi.list(token),
        versionsApi.list(token, docId),
      ]);
      setCurrentDoc(doc);
      setSavedDocuments(docs);
      setDocVersions(versions);
      setVersionMessage('Version switched successfully.');
      setIsVersionPanelOpen(false);
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : 'Failed to switch document version.');
    } finally {
      setSwitchingVersionId(null);
      setIsVersionsLoading(false);
    }
  }

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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/editor/${docId}`)}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
              >
                Edit Document
              </button>
              <button
                type="button"
                onClick={() => navigate('/workspace')}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Back To Workspace
              </button>
              <div className="relative" ref={viewerMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsViewerMenuOpen((prev) => !prev)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-50"
                  aria-label="More options"
                  title="More options"
                >
                  <span className="material-icons" style={{ fontSize: '1rem' }}>more_vert</span>
                </button>
                {isViewerMenuOpen ? (
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setIsVersionPanelOpen((prev) => !prev);
                        setIsViewerMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      <span className="material-icons text-slate-500" style={{ fontSize: '0.95rem' }}>history</span>
                      {isVersionPanelOpen ? 'Hide Version View' : 'Version View'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
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

          <div
            className={`fixed inset-0 z-20 bg-slate-900/20 transition-opacity duration-300 ${isVersionPanelOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            onClick={() => setIsVersionPanelOpen(false)}
          />
          <aside
            className={`fixed right-0 top-0 z-30 flex h-screen w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out ${isVersionPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Version History</h3>
                {!canSwitchVersions && !isLoading && !error ? (
                  <p className="mt-0.5 text-xs font-medium text-slate-500">No saved versions</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setIsVersionPanelOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
                aria-label="Close version view"
                title="Close version view"
              >
                <span className="material-icons" style={{ fontSize: '1.05rem' }}>close</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {versionMessage && (
                <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {versionMessage}
                </div>
              )}

              {versionError && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {versionError}
                </div>
              )}

              {isVersionsLoading ? (
                <p className="text-xs font-medium text-slate-500">Loading versions...</p>
              ) : (
                <ul className="space-y-2">
                  {docVersions.map((version) => (
                    <li key={version.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-1 text-xs font-semibold text-slate-700">{version.preview || 'Version snapshot'}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {new Date(version.savedAt).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={switchingVersionId === version.id}
                          onClick={() => void handleSwitchVersion(version.id)}
                          className="rounded-md border border-cyan-300 px-2.5 py-1 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {switchingVersionId === version.id ? 'Switching...' : 'Switch Version'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default DocumentViewerPage;
