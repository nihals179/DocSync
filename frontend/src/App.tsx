
import { useCallback, useEffect, useRef, useState } from 'react';

import Toolbar from './components/Toolbar';
import Header from './components/Header';
import RichEditor, { type RichEditorHandle } from './components/RichEditor';
import Comments from './components/Comments';
import VersionHistory from './components/VersionHistory';
import Sidebar from './components/Sidebar';
import TodoList from './components/TodoList';
import GrammarChecker from './components/GrammarChecker';
import AiTool from './components/AiTool';

type SavedVersion = {
  id: string;
  preview: string;
  savedAt: string;
};

const SAVED_VERSIONS_KEY = 'docsync.savedVersions';

type RightTool = 'comments' | 'versions' | 'todo' | 'grammar' | 'ai';

const RIGHT_TOOLS: { id: RightTool; icon: string; label: string }[] = [
  { id: 'comments',  icon: 'comment',              label: 'Comments'        },
  { id: 'versions',  icon: 'history',              label: 'Version Control' },
  { id: 'todo',      icon: 'checklist',            label: 'To-Do List'      },
  { id: 'grammar',   icon: 'spellcheck',           label: 'Grammar Checker' },
  { id: 'ai',        icon: 'smart_toy',            label: 'AI Assistant'    },
];

function App() {
  const editorRef = useRef<RichEditorHandle | null>(null);
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
  const [pageSize, setPageSize] = useState<'responsive' | 'A3' | 'A4' | 'A5'>('responsive');

  // savedVersions initialized from localStorage via lazy state initializer

  // Auto-save behavior removed. Versions are saved when a comment is added.

  const saveVersion = useCallback((previewText?: string) => {
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
  }, [title, currentHtml]);

  const handleEditorChange = useCallback((html: string) => {
    setCurrentHtml(html);
  }, []);

  const handleToggleDocsMenu = useCallback(() => {
    setIsDocsMenuOpen((prev) => !prev);
  }, []);

  const handleAddComment = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    setComments((prev) => [...prev, text.trim()]);
    saveVersion();
  }, [saveVersion]);

  // Expose handler for external callers (e.g., tests or integrations) to add a comment and trigger save
  useEffect(() => {
    (window as unknown as { externalAddComment?: (t: string) => void }).externalAddComment = handleAddComment;
    return () => {
      delete (window as unknown as { externalAddComment?: (t: string) => void }).externalAddComment;
    };
  }, [handleAddComment]);

  const handleTitleChange = useCallback((t: string) => setTitle(t), []);
  const [activeTool, setActiveTool] = useState<RightTool | null>(null);
  const [comments, setComments] = useState<string[]>([]);

  const handleRestoreVersion = useCallback((id: string) => {
    const version = savedVersions.find((v) => v.id === id);
    if (!version) return;
    editorRef.current?.setContent?.(version.preview);
  }, [savedVersions]);

  const handleDeleteVersion = useCallback((id: string) => {
    setSavedVersions((prev) => {
      const next = prev.filter((v) => v.id !== id);
      localStorage.setItem(SAVED_VERSIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-linear-to-br from-slate-100 via-white to-cyan-50">
      <Sidebar isOpen={isDocsMenuOpen} savedItems={savedVersions} onToggle={handleToggleDocsMenu} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Header />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <main className="flex min-h-0 flex-1 overflow-hidden px-4 py-1 sm:px-6 lg:px-8 lg:py-3">
            <div className="flex min-h-0 w-full flex-col">
              <input
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Untitled document"
                className="w-full border-b border-slate-200 px-3 py-1 text-sm font-semibold text-slate-800 bg-transparent"
              />
              <Toolbar editorRef={editorRef} pageSize={pageSize} onPageSizeChange={(s) => setPageSize(s)} />
              <RichEditor ref={editorRef} onContentChange={handleEditorChange} pageSize={pageSize} />
            </div>
          </main>
          {/* Right tool panel system — sits beside main, pushes it left */}
          <div className="flex shrink-0 items-stretch">
            {/* Sliding content panel */}
            <div className={`flex flex-col border-l border-slate-200/70 bg-white/90 backdrop-blur-sm shadow-xl transition-all duration-300 overflow-hidden ${activeTool ? 'w-80' : 'w-0'}`}>
              <div className="h-full w-80 overflow-auto p-4">
                {activeTool === 'comments'  && <Comments comments={comments} onAddComment={handleAddComment} />}
                {activeTool === 'versions'  && <VersionHistory versions={savedVersions} onRestore={handleRestoreVersion} onDelete={handleDeleteVersion} />}
                {activeTool === 'todo'      && <TodoList />}
                {activeTool === 'grammar'   && <GrammarChecker />}
                {activeTool === 'ai'        && <AiTool />}
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
                  <span className="material-icons" style={{ fontSize: '1.2rem' }}>{tool.icon}</span>
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
