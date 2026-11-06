import { useEffect } from 'react';

type RestoreVersionDialogProps = {
  /** When the version being restored was saved. */
  savedAt: string;
  /** Show the warning that edits not in any version will be replaced. */
  warnUnsavedChanges?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Asks before a version replaces the document's content. Escape and a click on the backdrop
 * cancel, as Cancel does.
 */
function RestoreVersionDialog({ savedAt, warnUnsavedChanges = false, onCancel, onConfirm }: RestoreVersionDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-90 flex items-center justify-center bg-slate-900/45 p-4"
      // A click on the backdrop (not inside the dialog) cancels.
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-version-title"
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <h3 id="restore-version-title" className="text-base font-bold text-slate-800">Restore this version?</h3>
        <p className="mt-1 text-xs text-slate-500">
          The document will be replaced with the version saved {new Date(savedAt).toLocaleString()}.
        </p>
        {warnUnsavedChanges && (
          <p className="mt-2 text-xs font-medium text-amber-700">
            Your uncommitted changes will be lost unless you commit them first.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}

export default RestoreVersionDialog;
