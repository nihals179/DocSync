import React from 'react';

type SavedItem = {
  id: string;
  preview: string;
  savedAt: string;
};

type SidebarProps = {
  isOpen: boolean;
  savedItems: SavedItem[];
  onToggle: () => void;
  onAddPage?: () => void;
};

const Sidebar: React.FC<SidebarProps> = ({ isOpen, savedItems, onToggle, onAddPage }) => (
  <aside
    className={`min-h-0 border-r border-slate-200/70 bg-white/75 backdrop-blur-sm transition-all duration-200 ${
      isOpen ? 'w-72 p-4' : 'w-12 p-1'
    }`}
  >
    <div className="flex h-full min-h-0 flex-col">
      <div className={`mb-2 flex ${isOpen ? 'justify-end' : 'justify-center'}`}>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
          title={isOpen ? 'Hide stored workspaces' : 'Show stored workspaces'}
          aria-label={isOpen ? 'Hide stored workspaces' : 'Show stored workspaces'}
        >
          <span className="material-icons text-[4px]">{isOpen ? 'chevron_left' : 'chevron_right'}</span>
        </button>
      </div>

      {!isOpen && (
        <div className="flex flex-1 items-center justify-center">
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            Workspace
          </span>
        </div>
      )}

      {isOpen && (
        <>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.14em] text-slate-600">Workspace</h2>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200/80 bg-slate-50 p-2">
          {savedItems.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-500">No saved documents yet.</p>
          ) : (
            <ul className="space-y-2">
              {savedItems.map((item, index) => (
                <li key={item.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Doc {savedItems.length - index}</p>
                  <p className="line-clamp-2 text-xs text-slate-700">{item.preview || 'Untitled content'}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{item.savedAt}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => onAddPage && onAddPage()}
              className="w-full rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-700 transition"
            >
              + Add Page
            </button>
          </div>
        </>
      )}
    </div>
  </aside>
);

export default Sidebar;
