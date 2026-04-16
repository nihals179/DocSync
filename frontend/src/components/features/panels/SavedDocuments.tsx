import React from 'react';

type SavedDocumentItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
};

type SavedDocumentsProps = {
  documents: SavedDocumentItem[];
  onOpen: (id: string) => void;
};

const SavedDocuments: React.FC<SavedDocumentsProps> = ({ documents, onOpen }) => (
  <section className="rounded-xl border border-slate-200/80 bg-white/80 p-4">
    <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
      Saved Documents
    </h3>
    <div className="max-h-72 overflow-y-auto rounded-lg border border-dashed border-slate-300/80 bg-slate-50 p-3">
      {documents.length === 0 ? (
        <p className="text-sm text-slate-500">
          No saved documents found.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => onOpen(doc.id)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
              >
                <p className="truncate text-xs font-semibold text-slate-800">{doc.title || 'Untitled document'}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{doc.preview || 'No preview available.'}</p>
                <p className="mt-1 text-[11px] text-slate-500">Updated {new Date(doc.updatedAt).toLocaleString()}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>
);

export default SavedDocuments;