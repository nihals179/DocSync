import React from 'react';

type SavedVersionItem = {
  id: string;
  preview: string;
  savedAt: string;
  isPublished?: boolean;
};

type SavedDocumentsProps = {
  versions: SavedVersionItem[];
  onSwitchVersion?: (versionId: string) => void;
};

const SavedDocuments: React.FC<SavedDocumentsProps> = ({ versions, onSwitchVersion }) => (
  <section className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200/80 bg-white/80 p-4">
    <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
      Saved Versions
    </h3>
    <p className="mb-2 text-[11px] text-slate-500">Double-click a version to switch.</p>
    <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-dashed border-slate-300/80 bg-slate-50 p-3">
      {versions.length === 0 ? (
        <p className="text-sm text-slate-500">
          No saved versions for this document.
        </p>
      ) : (
        <ul className="space-y-2">
          {versions.map((version) => (
            <li
              key={version.id}
              onDoubleClick={() => onSwitchVersion?.(version.id)}
              className="w-full cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-cyan-200"
              title="Double-click to switch to this version"
            >
              {version.isPublished && (
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700">
                  <span className="material-icons" style={{ fontSize: '0.75rem' }}>public</span>
                  Published
                </span>
              )}
              <p className="mt-1 line-clamp-2 text-xs text-slate-700">{version.preview || 'No preview available.'}</p>
              <p className="mt-1 text-[11px] text-slate-500">Saved {new Date(version.savedAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);

export default SavedDocuments;