import React, { useEffect, useMemo, useState } from 'react';
import { commentsApi } from '../../services/api';
import type { DocComment } from '../../services/api';

type VersionSummary = { id: string; savedAt: string; isPublished?: boolean };

type CommentsProps = {
  docId: string;
  token: string;
  /** The document's saved versions, used to label the groups of earlier comments. */
  versions?: VersionSummary[];
  /** The version the document is on; when it changes (a commit or restore), comments reload. */
  currentVersionId?: string | null;
  /** Called when a comment on an earlier version is double-clicked, to restore that version. */
  onOpenVersion?: (versionId: string) => void;
};

type CommentGroup = {
  key: string;
  /** The group's version when it still exists, so its comments can open it; otherwise null. */
  versionId: string | null;
  label: string;
  isPublished: boolean;
  comments: DocComment[];
};

const BACKGROUND = { background: true };

/**
 * Groups comments that belong to earlier versions, newest version first. Comments on a version
 * that is no longer available come next, then those written before the first version.
 */
function groupEarlierComments(comments: DocComment[], versions: VersionSummary[]): CommentGroup[] {
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const byVersion = new Map<string, DocComment[]>();
  for (const comment of comments) {
    const key = comment.versionId ?? '';
    byVersion.set(key, [...(byVersion.get(key) ?? []), comment]);
  }

  const rank = (key: string) => {
    if (!key) return Number.NEGATIVE_INFINITY;
    const version = versionById.get(key);
    return version ? new Date(version.savedAt).getTime() : Number.MIN_SAFE_INTEGER;
  };

  return [...byVersion.entries()]
    .sort(([a], [b]) => rank(b) - rank(a))
    .map(([key, list]) => {
      const version = versionById.get(key);
      // Deleted, or older than the plan's history window: either way it can't be opened.
      let label = 'Version no longer available';
      if (!key) label = 'Before the first version';
      else if (version) label = `Version saved ${new Date(version.savedAt).toLocaleString()}`;
      return { key: key || 'none', versionId: version ? key : null, label, isPublished: Boolean(version?.isPublished), comments: list };
    });
}

const Comments: React.FC<CommentsProps> = ({
  docId,
  token,
  versions = [],
  currentVersionId: documentVersionId = null,
  onOpenVersion,
}) => {
  const [comments, setComments] = useState<DocComment[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setError('');
    setLoadingList(true);
    commentsApi.list(token, docId, BACKGROUND)
      .then(({ comments: list, currentVersionId: current }) => {
        if (cancelled) return;
        setComments(list);
        setCurrentVersionId(current);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load comments.';
        setComments([]);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, docId, documentVersionId]);

  const { current, earlier } = useMemo(() => {
    const isCurrent = (comment: DocComment) => comment.versionId === currentVersionId;
    return {
      current: comments.filter(isCurrent),
      earlier: groupEarlierComments(comments.filter((comment) => !isCurrent(comment)), versions),
    };
  }, [comments, currentVersionId, versions]);

  const handleAdd = async () => {
    if (!text.trim() || !docId) return;
    setLoading(true);
    setError('');
    try {
      const { comment } = await commentsApi.add(token, docId, text.trim(), BACKGROUND);
      // The server pins it to the newest version, which is the current one.
      setCurrentVersionId(comment.versionId);
      setComments((prev) => [...prev, comment]);
      setText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add comment.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError('');
    try {
      await commentsApi.delete(token, docId, id, BACKGROUND);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete comment.';
      setError(message);
    }
  };

  /** `versionId` is set for comments on an earlier version that can be opened by double-clicking. */
  const renderComment = (c: DocComment, versionId: string | null = null) => {
    const canOpen = Boolean(versionId && onOpenVersion);
    return (
      <li
        key={c.id}
        onDoubleClick={canOpen && versionId ? () => onOpenVersion?.(versionId) : undefined}
        title={canOpen ? 'Double-click to restore this version' : undefined}
        className={`rounded-md border bg-white px-3 py-2 text-sm text-slate-700 ${
          canOpen ? 'cursor-pointer border-slate-100 transition-colors hover:border-cyan-200' : 'border-slate-100'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="wrap-break-word">{c.text}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              {(c.userName && c.userName.trim()) || c.userId} · {new Date(c.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => void handleDelete(c.id)}
            onDoubleClick={(e) => e.stopPropagation()}
            className="shrink-0 text-slate-300 hover:text-red-400 transition-colors"
            title="Delete comment"
          >
            <span className="material-icons" style={{ fontSize: '0.9rem' }}>close</span>
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="mb-4 rounded-xl border border-slate-200/80 bg-white/80 p-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
        Comments
      </h3>
      <div className="rounded-lg border border-dashed border-slate-300/80 bg-slate-50 p-3 min-h-20">
        <div className="mb-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a comment…"
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm"
            rows={3}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={loading}
              className="rounded-md bg-cyan-600 px-3 py-1 text-sm font-medium text-white hover:bg-cyan-700"
            >
              {loading ? 'Adding…' : 'Add Comment'}
            </button>
          </div>
        </div>

        <div>
          {error ? (
            <p className="mb-2 text-xs text-rose-600">{error}</p>
          ) : null}
          {/* Hidden until the list arrives: before that the current version isn't known. */}
          {!(loadingList && comments.length === 0) && (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {currentVersionId ? 'This version' : 'Draft (not committed yet)'}
            </p>
          )}
          {loadingList && comments.length === 0 ? (
            <p className="text-xs text-slate-500">Loading comments…</p>
          ) : current.length === 0 ? (
            <p className="text-sm text-slate-500">No comments on this version yet.</p>
          ) : (
            <ul className="space-y-2">{current.map((c) => renderComment(c))}</ul>
          )}

          {earlier.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Earlier versions</p>
              {earlier.map((group) => (
                <details key={group.key} className="rounded-md border border-slate-200 bg-white/70">
                  <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs text-slate-600">
                    <span className="flex-1">{group.label}</span>
                    {group.isPublished && (
                      <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-700">
                        Published
                      </span>
                    )}
                    <span className="text-slate-400">{group.comments.length}</span>
                  </summary>
                  <ul className="space-y-2 px-2 pb-2">{group.comments.map((c) => renderComment(c, group.versionId))}</ul>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default Comments;
