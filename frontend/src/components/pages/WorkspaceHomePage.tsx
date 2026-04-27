import { useEffect, useMemo, useRef, useState } from 'react';

import { docsApi, templatesApi, versionsApi, workspaceApi } from '../../lib/api';
import { buildDocumentTree } from '../../lib/documentTree';
import { getInitialWorkspaceSelectionId, persistWorkspaceSelectionId } from '../../lib/workspaceSelection';

type DocSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  parentId?: string | null;
  workspaceId?: string | null;
  sortOrder?: number;
};

type DocNode = DocSummary & { children: DocNode[] };

type VersionSummary = {
  id: string;
  preview: string;
  savedAt: string;
  docId: string;
  docTitle: string;
};

type Template = {
  id: string;
  title: string;
  description: string;
  icon: string;
  content: string;
};

type WorkspaceSummary = {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

type WorkspaceModalState =
  | { type: 'create-workspace'; name: string; error?: string }
  | {
    type: 'transfer-workspace';
    action: 'copy' | 'move';
    docId: string;
    targetId: string;
    options: Array<{ id: string; name: string }>;
    error?: string;
  }
  | { type: 'info'; title: string; message: string };

function prettyDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface WorkspaceHomePageProps {
  token: string;
  userName: string;
  onOpenDocument: (docId: string) => void;
  onOpenReadOnlyDocument?: (docId: string) => void;
  onCreateDocument: (title: string, content: string, workspaceId?: string | null) => Promise<void>;
  onOpenSecuritySettings?: () => void;
  onOpenOrganizationAdmin?: () => void;
  onLogout?: () => void;
}

export default function WorkspaceHomePage({
  token,
  userName,
  onOpenDocument,
  onOpenReadOnlyDocument,
  onCreateDocument,
  onOpenSecuritySettings,
  onOpenOrganizationAdmin,
  onLogout,
}: WorkspaceHomePageProps) {
  const personalWorkspaceName = `${userName}'s Workspace`.toLowerCase();

  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => getInitialWorkspaceSelectionId());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ docId: string; x: number; y: number } | null>(null);
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ targetId: string | null; mode: 'before' | 'after' | 'inside' | 'root' } | null>(null);
  const [workspaceModal, setWorkspaceModal] = useState<WorkspaceModalState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedWorkspaceIdRef = useRef<string>(selectedWorkspaceId);

  function handleOpenDocDoubleClick(docId: string) {
    if (onOpenReadOnlyDocument) {
      onOpenReadOnlyDocument(docId);
      return;
    }
    onOpenDocument(docId);
  }

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    persistWorkspaceSelectionId(selectedWorkspaceId);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    let ignore = false;

    async function loadWorkspaceData() {
      setLoading(true);
      setError('');

      try {
        const [{ workspaces: availableWorkspaces }, { docs: list }, { templates: availableTemplates }] = await Promise.all([
          workspaceApi.list(token),
          docsApi.list(token),
          templatesApi.list(token),
        ]);
        if (ignore) return;
        // Backend provides an auto-created personal workspace (e.g. "Admin's Workspace").
        // UI already represents personal scope as "My Workspace", so hide the duplicate.
        const visibleWorkspaces = availableWorkspaces.filter(
          (workspace) => workspace.name.trim().toLowerCase() !== personalWorkspaceName,
        );
        setWorkspaces(visibleWorkspaces);
        setDocs(list);
        setTemplates(availableTemplates);

        // Fallback to personal workspace if saved selection no longer exists.
        const savedSelection = selectedWorkspaceIdRef.current;
        if (savedSelection !== 'all' && !visibleWorkspaces.some((workspace) => workspace.id === savedSelection)) {
          selectedWorkspaceIdRef.current = 'all';
          setSelectedWorkspaceId('all');
        }

        const recentDocs = list.slice(0, 4);
        const versionsByDoc = await Promise.all(
          recentDocs.map(async (doc) => {
            try {
              const { versions: items } = await versionsApi.list(token, doc.id);
              return items.map((item) => ({ ...item, docId: doc.id, docTitle: doc.title }));
            } catch {
              return [] as VersionSummary[];
            }
          }),
        );

        if (ignore) return;
        const flat = versionsByDoc
          .flat()
          .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
          .slice(0, 8);
        setVersions(flat);
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : 'Failed to load workspace');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadWorkspaceData();
    return () => {
      ignore = true;
    };
  }, [token, personalWorkspaceName]);

  const filteredDocs = useMemo(() => {
    let result = docs;

    // Filter by selected workspace
    if (selectedWorkspaceId === 'all') {
      result = result.filter((d) => !d.workspaceId);
    } else {
      result = result.filter((d) => d.workspaceId === selectedWorkspaceId);
    }

    // Filter by search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((d) => `${d.title} ${d.preview}`.toLowerCase().includes(q));
    }

    return result;
  }, [docs, searchQuery, selectedWorkspaceId]);

  const filteredVersions = useMemo(() => {
    let result = versions;
    
    // Filter by search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((v) => `${v.docTitle} ${v.preview}`.toLowerCase().includes(q));
    }
    
    return result;
  }, [versions, searchQuery]);

  const hasDocs = useMemo(() => filteredDocs.length > 0, [filteredDocs]);

  async function createFromTemplate(template: Template) {
    try {
      setCreatingTemplate(template.id);
      const currentWorkspaceId = selectedWorkspaceIdRef.current;
      const targetWorkspaceId = currentWorkspaceId === 'all' ? null : currentWorkspaceId;
      await onCreateDocument(template.title, template.content, targetWorkspaceId);
    } finally {
      setCreatingTemplate(null);
    }
  }

  async function createBlankDoc() {
    try {
      setCreatingTemplate('blank');
      const currentWorkspaceId = selectedWorkspaceIdRef.current;
      const targetWorkspaceId = currentWorkspaceId === 'all' ? null : currentWorkspaceId;
      await onCreateDocument('Untitled', '', targetWorkspaceId);
    } finally {
      setCreatingTemplate(null);
    }
  }

  async function createWorkspaceFromSidebar(name: string) {
    const trimmedName = name.trim();
    try {
      const { workspace } = await workspaceApi.create(token, trimmedName);
      setWorkspaces((prev) => [workspace, ...prev]);
      selectedWorkspaceIdRef.current = workspace.id;
      setSelectedWorkspaceId(workspace.id);
      setWorkspaceModal(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create workspace';
      setWorkspaceModal((prev) =>
        prev && prev.type === 'create-workspace' ? { ...prev, error: message } : prev,
      );
    }
  }

  // Get the active workspace for the book title
  const activeWorkspace = useMemo(() => {
    if (selectedWorkspaceId === 'all' || !selectedWorkspaceId) {
      return { id: 'personal', name: 'My Workspace' };
    }
    return workspaces.find((w) => w.id === selectedWorkspaceId) || { id: 'personal', name: 'My Workspace' };
  }, [selectedWorkspaceId, workspaces]);

  // Create book-like navigation structure
  const bookNavigation = useMemo(() => {
    const q = navSearchQuery.trim().toLowerCase();
    const filtered = q ? filteredDocs.filter((d) => d.title.toLowerCase().includes(q)) : filteredDocs;
    return filtered;
  }, [filteredDocs, navSearchQuery]);

  const docTree = useMemo(() => buildDocumentTree(bookNavigation) as DocNode[], [bookNavigation]);

  const workspaceOptions = useMemo(
    () => [{ id: 'all', name: 'My Workspace' }, ...workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))],
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

  async function createChildDoc(parentId: string) {
    try {
      setCreatingTemplate(`child-${parentId}`);
      const parent = docs.find((d) => d.id === parentId);
      const { doc } = await docsApi.create(token, 'Untitled', '', parentId, parent?.workspaceId ?? null);
      const { docs: list } = await docsApi.list(token);
      setDocs(list);
      setExpandedNodes((prev) => new Set([...prev, parentId]));
      onOpenDocument(doc.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create document');
    } finally {
      setCreatingTemplate(null);
    }
  }

  function getWorkspaceTransferOptions(currentWorkspaceId: string | null) {
    const available = workspaceOptions.filter((w) => (w.id === 'all' ? null : w.id) !== currentWorkspaceId);
    return available;
  }

  function openWorkspaceTransferModal(docId: string, action: 'copy' | 'move') {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;

    const options = getWorkspaceTransferOptions(doc.workspaceId ?? null);
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
      docId,
      targetId: options[0].id,
      options,
    });
  }

  async function moveDocToWorkspace(docId: string, targetWorkspaceId: string | null) {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;

    const siblings = docs.filter((d) => (d.workspaceId ?? null) === targetWorkspaceId && (d.parentId ?? null) === null);
    const targetSortOrder = siblings.reduce((max, d) => Math.max(max, d.sortOrder ?? 0), 0) + 1;

    try {
      await docsApi.update(token, docId, {
        workspaceId: targetWorkspaceId,
        parentId: null,
        sortOrder: targetSortOrder,
      });
      const { docs: list } = await docsApi.list(token);
      setDocs(list);
      setWorkspaceModal(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to move document';
      setWorkspaceModal((prev) =>
        prev && prev.type === 'transfer-workspace' ? { ...prev, error: message } : prev,
      );
    }
  }

  async function copyDocToWorkspace(docId: string, targetWorkspaceId: string | null) {
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return;

    try {
      const { doc: source } = await docsApi.get(token, docId);
      await docsApi.create(token, source.title || 'Untitled', source.content || '', null, targetWorkspaceId);
      const { docs: list } = await docsApi.list(token);
      setDocs(list);
      setWorkspaceModal(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to copy document';
      setWorkspaceModal((prev) =>
        prev && prev.type === 'transfer-workspace' ? { ...prev, error: message } : prev,
      );
    }
  }

  function getDescendantIds(docId: string): Set<string> {
    const descendants = new Set<string>();
    const queue = [docId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const children = docs.filter((d) => d.parentId === current).map((d) => d.id);
      for (const childId of children) {
        if (descendants.has(childId)) continue;
        descendants.add(childId);
        queue.push(childId);
      }
    }

    return descendants;
  }

  async function moveDocWithDrag(docId: string, targetId: string | null, mode: 'before' | 'after' | 'inside' | 'root') {
    const moved = docs.find((d) => d.id === docId);
    if (!moved) return;

    const descendants = getDescendantIds(docId);
    let destinationParentId: string | null = null;
    let destinationWorkspaceId: string | null = moved.workspaceId ?? null;
    let destinationSiblings: DocSummary[] = [];
    let insertIndex = 0;

    if (mode === 'root') {
      destinationWorkspaceId = selectedWorkspaceId === 'all' ? null : selectedWorkspaceId;
      destinationParentId = null;
      destinationSiblings = docs
        .filter(
          (d) =>
            d.id !== docId &&
            (d.workspaceId ?? null) === destinationWorkspaceId &&
            (d.parentId ?? null) === null,
        )
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      insertIndex = destinationSiblings.length;
    } else {
      const target = docs.find((d) => d.id === targetId);
      if (!target || target.id === docId) return;
      destinationWorkspaceId = target.workspaceId ?? null;
      destinationParentId = mode === 'inside' ? target.id : (target.parentId ?? null);

      if (descendants.has(target.id) || (destinationParentId && descendants.has(destinationParentId))) {
        setError('Invalid move: cannot place a document inside its own hierarchy.');
        return;
      }

      destinationSiblings = docs
        .filter(
          (d) =>
            d.id !== docId &&
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
        const oldSiblings = docs
          .filter(
            (d) =>
              d.id !== docId &&
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
      setDocs(list);
      if (destinationParentId) {
        setExpandedNodes((prev) => new Set([...prev, destinationParentId]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move document by drag and drop');
    }
  }

  function handleDragStart(event: React.DragEvent<HTMLDivElement>, docId: string) {
    setDragDocId(docId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', docId);
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

  function openDocContextMenu(event: React.MouseEvent<HTMLDivElement>, docId: string) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 140;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({ docId, x: Math.max(8, x), y: Math.max(8, y) });
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

  function renderDocNode(
    node: DocNode,
    numberStr: string,
    depth: number,
  ): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);
    const isCreating = creatingTemplate === `child-${node.id}`;
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
          {/* Expand/collapse chevron */}
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:text-cyan-600 ${!hasChildren ? 'invisible' : ''}`}
          >
            <span className="material-icons" style={{ fontSize: '0.85rem' }}>
              {isExpanded ? 'expand_more' : 'chevron_right'}
            </span>
          </button>
          {/* Number badge */}
          <div
            className="flex h-5 shrink-0 items-center justify-center rounded bg-cyan-100 px-1.5 text-[10px] font-bold text-cyan-700"
            style={{ minWidth: '20px' }}
          >
            {numberStr}
          </div>
          {/* Title */}
          <button
            type="button"
            onDoubleClick={() => handleOpenDocDoubleClick(node.id)}
            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-700 hover:text-cyan-700"
          >
            {node.title || 'Untitled'}
          </button>
          {/* Minimal actions (visible on hover) */}
          <div className="invisible flex shrink-0 items-center group-hover:visible">
            <button
              type="button"
              onClick={() => void createChildDoc(node.id)}
              disabled={isCreating}
              title="Add sub-document"
              className="rounded p-0.5 text-slate-400 hover:bg-cyan-100 hover:text-cyan-600 disabled:opacity-50"
            >
              <span className="material-icons" style={{ fontSize: '0.85rem' }}>
                {isCreating ? 'hourglass_empty' : 'add'}
              </span>
            </button>
          </div>
        </div>
        {dropHint?.targetId === node.id && dropHint.mode === 'before' && (
          <div className="ml-2 h-0.5 rounded bg-cyan-500" />
        )}
        {isExpanded &&
          node.children.map((child, i) =>
            renderDocNode(child, `${numberStr}.${i + 1}`, depth + 1),
          )}
        {dropHint?.targetId === node.id && dropHint.mode === 'after' && (
          <div className="ml-2 h-0.5 rounded bg-cyan-500" />
        )}
      </div>
    );
  }

  function renderBookNavigation(): React.ReactNode {
    if (docTree.length === 0) {
      return (
        <div className="p-4 text-center">
          <span className="material-icons mx-auto mb-2 block text-2xl text-slate-300">article</span>
          <p className="text-xs text-slate-500">No chapters yet</p>
        </div>
      );
    }
    return docTree.map((node, i) => renderDocNode(node, `${i + 1}`, 0));
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-slate-200 bg-white z-50">
        <div className="px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-6">

            {/* Left: Logo + Workspace + Search */}
            <div className="flex flex-1 items-center gap-4">
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600">
                  <span className="material-icons text-white" style={{ fontSize: '1.25rem' }}>description</span>
                </div>
                <span className="hidden text-lg font-black text-cyan-700 sm:inline">DocSync</span>
              </div>

              <div className="relative shrink-0">
                <select
                  id="workspace-selector"
                  value={selectedWorkspaceId}
                  onChange={(e) => {
                    selectedWorkspaceIdRef.current = e.target.value;
                    setSelectedWorkspaceId(e.target.value);
                  }}
                  className="cursor-pointer appearance-none rounded-full bg-cyan-50 py-2 pl-4 pr-10 text-sm font-medium text-cyan-900 focus:outline-none"
                >
                  <option value="all">My Workspace</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                  ))}
                </select>
                <span className="material-icons pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-cyan-600" style={{ fontSize: '1.2rem' }}>expand_more</span>
              </div>

              <div className="relative w-full max-w-sm">
                <span className="material-icons absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: '1.2rem' }}>search</span>
                <input
                  id="search-header"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents..."
                  className="w-full rounded-full bg-slate-50 py-2 pl-12 pr-4 text-sm text-slate-700 placeholder-slate-400 outline-none focus:bg-white"
                />
              </div>
            </div>

            {/* Right: New + Profile */}
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => void createBlankDoc()}
                disabled={creatingTemplate !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-bold text-white hover:-translate-y-0.5 transition-all disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-icons" style={{ fontSize: '0.9rem' }}>add</span>
                New
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-white hover:-translate-y-0.5 transition-all"
                  title="Profile menu"
                >
                  <span className="material-icons" style={{ fontSize: '1.2rem' }}>account_circle</span>
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 z-50 mt-2 w-48 rounded-lg bg-white py-2 shadow-lg border border-slate-100">
                    <div className="border-b border-slate-200 px-4 py-2">
                      <p className="text-sm font-bold text-slate-800">{userName}</p>
                      <p className="text-xs text-slate-500">Workspace Admin</p>
                    </div>
                    <button type="button" onClick={() => { setProfileMenuOpen(false); onOpenSecuritySettings?.(); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                      <span className="material-icons" style={{ fontSize: '1rem' }}>person</span>Profile
                    </button>
                    <button type="button" onClick={() => { setProfileMenuOpen(false); onOpenSecuritySettings?.(); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                      <span className="material-icons" style={{ fontSize: '1rem' }}>settings</span>Settings
                    </button>
                    <button type="button" onClick={() => { setProfileMenuOpen(false); onOpenOrganizationAdmin?.(); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                      <span className="material-icons" style={{ fontSize: '1rem' }}>groups</span>Organization Admin
                    </button>
                    <button type="button" onClick={() => setProfileMenuOpen(false)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                      <span className="material-icons" style={{ fontSize: '1rem' }}>help</span>Help &amp; Support
                    </button>
                    <div className="my-1 border-t border-slate-200" />
                    <button type="button" onClick={() => { setProfileMenuOpen(false); onLogout?.(); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                      <span className="material-icons" style={{ fontSize: '1rem' }}>logout</span>Logout
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* ── Body (sidebar + content) ────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* Book Sidebar — true full height */}
        <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="flex flex-1 flex-col overflow-hidden p-5">

            {/* Book Header */}
            <div className="mb-4 shrink-0 pb-4 border-b border-slate-200/60">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-100">
                    <span className="material-icons text-cyan-700" style={{ fontSize: '1rem' }}>menu_book</span>
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Book</p>
                </div>
                <button
                  type="button"
                  onClick={() => setWorkspaceModal({ type: 'create-workspace', name: '' })}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-700 transition-colors hover:bg-cyan-100"
                  title="Create workspace"
                >
                  <span className="material-icons" style={{ fontSize: '0.75rem' }}>add</span>
                  New Workspace
                </button>
              </div>
              <p className="text-base font-black text-slate-800 truncate">{activeWorkspace.name}</p>
              <p className="mt-1 text-[10px] text-slate-400">Table of Contents</p>
            </div>

            {/* Search */}
            <div className="mb-3 shrink-0">
              <div className="relative">
                <span className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" style={{ fontSize: '0.9rem' }}>search</span>
                <input
                  value={navSearchQuery}
                  onChange={(e) => setNavSearchQuery(e.target.value)}
                  placeholder="Find chapter..."
                  className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 outline-none focus:bg-white focus:ring-1 focus:ring-cyan-400"
                />
              </div>
            </div>

            {/* Chapter count label */}
            <p className="mb-1 shrink-0 px-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Chapters ({bookNavigation.length})
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

            {/* Chapters — scrollable */}
            <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5 pr-1">
              {renderBookNavigation()}
            </div>

            {/* Book Footer */}
            <div className="mt-3 shrink-0 border-t border-slate-200/60 pt-3 text-[10px] text-slate-400">
              {docs.length} total chapter{docs.length !== 1 ? 's' : ''}
            </div>

          </div>
        </aside>

        {/* Right column: scrollable sections + footer */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto px-5 py-7 lg:px-8">
            <div className="flex flex-col gap-8 pb-8">

              {error && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>
              )}

              {/* Templates */}
              <section id="templates-section" className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="mb-5">
                  <h2 className="text-lg font-black tracking-tight text-slate-800">Launch A Template</h2>
                  <p className="mt-1 text-xs text-slate-500">Choose a pre-designed template to get started quickly</p>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                  {templates.map((template) => (
                    <article key={template.id} className="group relative w-56 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:-translate-y-1 hover:shadow-md">
                      <div className="p-5">
                        <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500 text-white">
                          <span className="material-icons" style={{ fontSize: '1.25rem' }}>{template.icon}</span>
                        </div>
                        <h3 className="text-sm font-black text-slate-800">{template.title}</h3>
                        <p className="mt-1.5 min-h-8 text-xs text-slate-500">{template.description}</p>
                        <button
                          type="button"
                          onClick={() => void createFromTemplate(template)}
                          disabled={creatingTemplate !== null}
                          className="mt-4 w-full rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-700 transition-all hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {creatingTemplate === template.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="material-icons" style={{ fontSize: '0.85rem', animation: 'spin 1s linear infinite' }}>hourglass_empty</span>Creating…
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="material-icons" style={{ fontSize: '0.85rem' }}>add_circle_outline</span>Use Template
                            </span>
                          )}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {/* Documents + Version History */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

                <section id="documents-section" className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-black tracking-tight text-slate-800">Recent Documents</h2>
                      <p className="mt-0.5 text-xs text-slate-500">Quickly access your recent work</p>
                    </div>
                    {loading && <span className="text-xs text-slate-400">Loading…</span>}
                  </div>
                  {!loading && !hasDocs && (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                      <span className="material-icons mx-auto mb-2 block text-4xl text-slate-300">description</span>
                      <p className="text-sm font-semibold text-slate-600">No documents yet</p>
                      <p className="mt-1 text-xs text-slate-500">Start with a template above</p>
                    </div>
                  )}
                  <ul className="space-y-2">
                    {filteredDocs.slice(0, 8).map((doc) => (
                      <li key={doc.id} className="rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-cyan-200 hover:shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="material-icons text-slate-400" style={{ fontSize: '1rem' }}>description</span>
                              <p className="truncate text-sm font-semibold text-slate-800">{doc.title || 'Untitled'}</p>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Updated {prettyDate(doc.updatedAt)}</p>
                            {doc.preview && <p className="mt-1.5 line-clamp-1 text-xs text-slate-400">{doc.preview}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button type="button" onClick={() => onOpenDocument(doc.id)} className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-cyan-700">
                              Open
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section id="versions-section" className="rounded-2xl bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-black tracking-tight text-slate-800">Version History</h2>
                      <p className="mt-0.5 text-xs text-slate-500">Recently saved snapshots</p>
                    </div>
                    {loading && <span className="text-xs text-slate-400">Loading…</span>}
                  </div>
                  {!loading && versions.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                      <span className="material-icons mx-auto mb-2 block text-4xl text-slate-300">history</span>
                      <p className="text-sm font-semibold text-slate-600">No versions yet</p>
                      <p className="mt-1 text-xs text-slate-500">Save versions in the editor</p>
                    </div>
                  )}
                  <ul className="space-y-2">
                    {filteredVersions.slice(0, 8).map((version) => (
                      <li key={`${version.docId}-${version.id}`} className="rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-cyan-200 hover:shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="material-icons text-slate-400" style={{ fontSize: '1rem' }}>restore</span>
                              <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-600">{version.docTitle}</p>
                            </div>
                            <p className="mt-1.5 line-clamp-1 text-xs font-medium text-slate-700">{version.preview || 'Version snapshot'}</p>
                            <p className="mt-1 text-xs text-slate-400">{prettyDate(version.savedAt)}</p>
                          </div>
                          <button type="button" onClick={() => onOpenDocument(version.docId)} className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-700 transition-colors">
                            View
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

              </div>
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
          className="fixed z-[70] min-w-[170px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Document actions"
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-cyan-50 hover:text-cyan-700"
            onClick={() => {
              onOpenDocument(contextMenu.docId);
              setContextMenu(null);
            }}
          >
            <span className="material-icons" style={{ fontSize: '0.9rem' }}>edit</span>
            Edit
          </button>
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            {workspaceModal.type === 'create-workspace' && (
              <>
                <h3 className="text-base font-bold text-slate-800">Create Workspace</h3>
                <p className="mt-1 text-xs text-slate-500">Enter a name for your new workspace.</p>
                <input
                  autoFocus
                  value={workspaceModal.name}
                  onChange={(event) =>
                    setWorkspaceModal((prev) =>
                      prev && prev.type === 'create-workspace'
                        ? { ...prev, name: event.target.value, error: undefined }
                        : prev,
                    )
                  }
                  placeholder="Workspace name"
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none focus:border-cyan-400"
                />
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
                      if (!workspaceModal.name.trim()) {
                        setWorkspaceModal((prev) =>
                          prev && prev.type === 'create-workspace'
                            ? { ...prev, error: 'Workspace name cannot be empty.' }
                            : prev,
                        );
                        return;
                      }
                      void createWorkspaceFromSidebar(workspaceModal.name);
                    }}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
                  >
                    Create
                  </button>
                </div>
              </>
            )}

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
