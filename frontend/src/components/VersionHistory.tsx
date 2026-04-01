import React, { useState, useRef, useEffect } from 'react';

type VersionItem = {
  id: string;
  preview: string;
  savedAt: string;
};

type VersionHistoryProps = {
  versions: VersionItem[];
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
};

const VersionMenu: React.FC<{ id: string; onRestore?: (id: string) => void; onDelete?: (id: string) => void }> = ({ id, onRestore, onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 focus:outline-none"
        title="Options"
      >
        <span className="material-icons" style={{ fontSize: '1rem' }}>more_vert</span>
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          <button
            onClick={() => { onRestore?.(id); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            <span className="material-icons text-slate-400" style={{ fontSize: '0.85rem' }}>restore</span>
            Restore
          </button>
          <button
            onClick={() => { onDelete?.(id); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
          >
            <span className="material-icons text-red-400" style={{ fontSize: '0.85rem' }}>delete</span>
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

const VersionHistory: React.FC<VersionHistoryProps> = ({ versions, onRestore, onDelete }) => (
  <section className="rounded-xl border border-slate-200/80 bg-white/80 p-4">
    <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Saved Versions</h3>
    <div className="max-h-72 overflow-y-auto rounded-lg border border-dashed border-slate-300/80 bg-slate-50 p-3">
      {versions.length === 0 ? (
        <p className="text-sm text-slate-500">No saved content yet. Start typing to create snapshots.</p>
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => (
            <li key={version.id} className="flex items-start gap-1 rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-xs text-slate-700">{version.preview || 'Untitled content'}</p>
                <p className="mt-1 text-[11px] text-slate-500">{version.savedAt}</p>
              </div>
              <VersionMenu id={version.id} onRestore={onRestore} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);

export default VersionHistory;

