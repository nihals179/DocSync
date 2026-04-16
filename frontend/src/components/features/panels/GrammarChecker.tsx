import React, { useState } from 'react';
import { grammarApi } from '../../../lib/api';

type Issue = {
  id: number;
  type: string;
  text: string;
  suggestion: string;
};

const badgeClass: Record<string, string> = {
  spelling: 'bg-red-100 text-red-600',
  grammar: 'bg-amber-100 text-amber-600',
  style: 'bg-blue-100 text-blue-600',
};

const GrammarChecker: React.FC<{ token: string; docText: string }> = ({ token, docText }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);

  const visible = issues.filter((i) => !dismissed.includes(i.id));

  async function checkDocument() {
    setState('loading');
    setDismissed([]);
    try {
      const { issues: found } = await grammarApi.check(token, docText || ' ');
      setIssues(found);
    } catch {
      setIssues([]);
    }
    setState('done');
  }

  return (
    <section className="flex h-full flex-col">
      <h3 className="mb-3 shrink-0 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
        Grammar Checker
      </h3>

      {state === 'loading' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <svg className="h-8 w-8 animate-spin text-cyan-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-xs text-slate-500">Checking document…</p>
        </div>
      ) : state === 'idle' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="material-icons text-slate-300" style={{ fontSize: '3rem' }}>
            spellcheck
          </span>
          <p className="text-xs text-slate-500">
            Check your document for grammar, spelling, and style issues.
          </p>
          <button
            onClick={() => void checkDocument()}
            className="rounded-md bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
          >
            Check Document
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <span className="material-icons text-green-500" style={{ fontSize: '2.5rem' }}>
                check_circle
              </span>
              <p className="text-sm font-medium text-slate-700">No issues found!</p>
              <p className="text-xs text-slate-500">Your document looks great.</p>
            </div>
          ) : (
            <ul className="flex-1 space-y-2 overflow-y-auto">
              {visible.map((issue) => (
                <li
                  key={issue.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 text-xs"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badgeClass[issue.type]}`}
                    >
                      {issue.type}
                    </span>
                    <button
                      onClick={() => setDismissed((p) => [...p, issue.id])}
                      className="text-slate-300 hover:text-slate-500"
                      title="Dismiss"
                    >
                      <span className="material-icons" style={{ fontSize: '0.85rem' }}>
                        close
                      </span>
                    </button>
                  </div>
                  <p className="text-slate-500 line-through">{issue.text}</p>
                  <p className="mt-0.5 font-medium text-slate-700">→ {issue.suggestion}</p>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => { setState('idle'); setDismissed([]); setIssues([]); }}
            className="mt-3 shrink-0 text-xs text-cyan-600 hover:underline"
          >
            Check again
          </button>
        </div>
      )}
    </section>
  );
};

export default GrammarChecker;
