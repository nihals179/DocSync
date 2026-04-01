import React, { useState } from 'react';

type CommentsProps = {
  comments?: string[];
  onAddComment?: (text: string) => void;
};

const Comments: React.FC<CommentsProps> = ({ comments = [], onAddComment }) => {
  const [text, setText] = useState('');

  return (
    <section className="mb-4 rounded-xl border border-slate-200/80 bg-white/80 p-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">Comments</h3>
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
              onClick={() => {
                if (!text.trim()) return;
                onAddComment?.(text.trim());
                setText('');
              }}
              className="rounded-md bg-cyan-600 px-3 py-1 text-sm font-medium text-white hover:bg-cyan-700"
            >
              Add Comment
            </button>
          </div>
        </div>

        <div>
          {comments.length === 0 ? (
            <p className="text-sm text-slate-500">No comments yet.</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c, i) => (
                <li key={i} className="rounded-md bg-white px-3 py-2 text-sm text-slate-700">
                  {c}
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
