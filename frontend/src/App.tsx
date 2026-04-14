import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AiTool,
  Comments,
  GrammarChecker,
  Header,
  RichEditor,
  Sidebar,
  TodoList,
  Toolbar,
  VersionHistory,
} from './components';
import type { CursorFormat, RichEditorHandle } from './components/editor';

type SavedVersion = {
  id: string;
  preview: string;
  savedAt: string;
};

const SAVED_VERSIONS_KEY = 'docsync.savedVersions';

type RightTool = 'comments' | 'versions' | 'todo' | 'grammar' | 'ai';

const RIGHT_TOOLS: { id: RightTool; icon: string; label: string }[] = [
  { id: 'comments', icon: 'comment', label: 'Comments' },
  { id: 'versions', icon: 'history', label: 'Version Control' },
  { id: 'todo', icon: 'checklist', label: 'To-Do List' },
  { id: 'grammar', icon: 'spellcheck', label: 'Grammar Checker' },
  { id: 'ai', icon: 'smart_toy', label: 'AI Assistant' },
];

function App() {
  const editorRef = useRef<RichEditorHandle | null>(null);
  const savePopupRef = useRef<HTMLDivElement | null>(null);
  const [currentHtml, setCurrentHtml] = useState('');
  const [savedVersions, setSavedVersions] = useState<SavedVersion[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_VERSIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedVersion[];
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [isDocsMenuOpen, setIsDocsMenuOpen] = useState(false);
  const [title, setTitle] = useState<string>('');
  const [showSavePopup, setShowSavePopup] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
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

  // savedVersions initialized from localStorage via lazy state initializer

  // Auto-save behavior removed. Versions are saved when a comment is added.

  const saveVersion = useCallback(
    (previewText?: string) => {
      const trimmed = (previewText ?? currentHtml.replace(/<[^>]+>/g, '')).trim();
      if (!trimmed) return; // require non-empty content

      const preview = trimmed.slice(0, 90);
      const savedAt = new Date().toLocaleString();

      setSavedVersions((prev) => {
        const next: SavedVersion[] = [
          {
            id: String(Date.now()),
            preview,
            savedAt,
          },
          ...prev,
        ].slice(0, 8);

        localStorage.setItem(SAVED_VERSIONS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [title, currentHtml],
  );

  const handleEditorChange = useCallback((html: string) => {
    setCurrentHtml(html);
  }, []);

  const handleToggleDocsMenu = useCallback(() => {
    setIsDocsMenuOpen((prev) => !prev);
  }, []);

  const handleAddComment = useCallback(
    (text: string) => {
      if (!text || !text.trim()) return;
      setComments((prev) => [...prev, text.trim()]);
      saveVersion();
    },
    [saveVersion],
  );

  // Expose handler for external callers (e.g., tests or integrations) to add a comment and trigger save
  useEffect(() => {
    (window as unknown as { externalAddComment?: (t: string) => void }).externalAddComment =
      handleAddComment;
    return () => {
      delete (window as unknown as { externalAddComment?: (t: string) => void }).externalAddComment;
    };
  }, [handleAddComment]);

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
  const [comments, setComments] = useState<string[]>([]);

  const handleRestoreVersion = useCallback(
    (id: string) => {
      const version = savedVersions.find((v) => v.id === id);
      if (!version) return;
      editorRef.current?.setContent?.(version.preview);
    },
    [savedVersions],
  );

  const handleDeleteVersion = useCallback((id: string) => {
    setSavedVersions((prev) => {
      const next = prev.filter((v) => v.id !== id);
      localStorage.setItem(SAVED_VERSIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSaveDocument = useCallback(() => {
    const trimmed = saveMessage.trim();
    saveVersion(trimmed.length > 0 ? trimmed : undefined);
    setShowSavePopup(false);
    setSaveMessage('');
  }, [saveMessage, saveVersion]);

  const handlePublishDocument = useCallback(() => {
    saveVersion();
    window.alert('Document published successfully.');
  }, [saveVersion]);

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-linear-to-br from-slate-100 via-white to-cyan-50">
      <Sidebar isOpen={isDocsMenuOpen} savedItems={savedVersions} onToggle={handleToggleDocsMenu} />
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
                              handleSaveDocument();
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
                            onClick={handleSaveDocument}
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
                    onClick={handlePublishDocument}
                    className="rounded-md bg-cyan-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-cyan-700"
                  >
                    Publish
                  </button>
                </div>
              )}
              <Toolbar
                editorRef={editorRef}
                pageSize={pageSize}
                onPageSizeChange={(s: 'responsive' | 'A3' | 'A4' | 'A5') => setPageSize(s)}
                isFullscreen={isFullscreenEditor}
                onToggleFullscreen={() => setIsFullscreenEditor((prev) => !prev)}
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
          {/* Right tool panel system — sits beside main, pushes it left */}
          <div className="flex shrink-0 items-stretch">
            {/* Sliding content panel */}
            <div
              className={`flex flex-col border-l border-slate-200/70 bg-white/90 backdrop-blur-sm shadow-xl transition-all duration-300 overflow-hidden ${activeTool ? 'w-80' : 'w-0'}`}
            >
              <div className="h-full w-80 overflow-auto p-4">
                {activeTool === 'comments' && (
                  <Comments comments={comments} onAddComment={handleAddComment} />
                )}
                {activeTool === 'versions' && (
                  <VersionHistory
                    versions={savedVersions}
                    onRestore={handleRestoreVersion}
                    onDelete={handleDeleteVersion}
                  />
                )}
                {activeTool === 'todo' && <TodoList />}
                {activeTool === 'grammar' && <GrammarChecker />}
                {activeTool === 'ai' && <AiTool />}
              </div>
            </div>
            {/* Icon strip — always visible */}
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
    </div>
  );
}

export default App;
