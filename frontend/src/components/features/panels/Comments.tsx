import React, { useEffect, useState } from 'react';
import { commentsApi } from '../../../lib/api';

type CommentItem = { id: string; text: string; userName: string; createdAt: string };

type CommentsProps = {
  docId: string;
  token: string;
  onCommentAdded?: () => void;
};

const Comments: React.FC<CommentsProps> = ({ docId, token, onCommentAdded }) => {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) return;
    commentsApi.list(token, docId)
      .then(({ comments: list }) => setComments(list))
      .catch(() => {});
  }, [token, docId]);

  const handleAdd = async () => {
    if (!text.trim() || !docId) return;
    setLoading(true);
    try {
      const { comment } = await commentsApi.add(token, docId, text.trim());
      setComments((prev) => [...prev, comment]);
      setText('');
      onCommentAdded?.();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await commentsApi.delete(token, docId, id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silent
    }
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
          {comments.length === 0 ? (
            <p className="text-sm text-slate-500">No comments yet.</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-md border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="wrap-break-word">{c.text}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {c.userName} · {new Date(c.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleDelete(c.id)}
                      className="shrink-0 text-slate-300 hover:text-red-400 transition-colors"
                      title="Delete comment"
                    >
                      <span className="material-icons" style={{ fontSize: '0.9rem' }}>close</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};

export default Comments;
