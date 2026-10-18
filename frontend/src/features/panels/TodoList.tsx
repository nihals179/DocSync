import React, { useEffect, useState } from 'react';
import { todosApi } from '../../services/api';

type TodoItem = { id: string; text: string; done: boolean };

const TodoList: React.FC<{ docId: string; token: string }> = ({ docId, token }) => {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!docId) return;
    todosApi.list(token, docId)
      .then(({ todos }) => {
        setItems(todos);
        setError('');
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load todos.';
        setError(message);
      });
  }, [token, docId]);

  const add = async () => {
    const t = input.trim();
    if (!t || !docId) return;
    setError('');
    try {
      const { todo } = await todosApi.add(token, docId, t);
      setItems((prev) => [...prev, todo]);
      setInput('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add todo.';
      setError(message);
    }
  };

  const toggle = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item || !docId) return;
    setError('');
    try {
      const { todo } = await todosApi.update(token, docId, id, { done: !item.done });
      setItems((prev) => prev.map((i) => (i.id === id ? todo : i)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update todo.';
      setError(message);
    }
  };

  const remove = async (id: string) => {
    if (!docId) return;
    setError('');
    try {
      await todosApi.delete(token, docId, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete todo.';
      setError(message);
    }
  };

  return (
    <section className="flex h-full flex-col">
      <h3 className="mb-3 shrink-0 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
        To-Do List
      </h3>
      <div className="mb-3 flex shrink-0 gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="Add a task…"
          className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-cyan-400 focus:outline-none"
        />
        <button
          onClick={() => void add()}
          className="rounded-md bg-cyan-600 px-3 py-1 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
        >
          Add
        </button>
      </div>
      {error ? (
        <p className="mb-2 shrink-0 text-xs text-rose-600">{error}</p>
      ) : null}
      <ul className="flex-1 space-y-1.5 overflow-y-auto">
        {items.length === 0 && (
          <p className="text-xs text-slate-500">No tasks yet. Add one above.</p>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5"
          >
            <input
              type="checkbox"
              checked={item.done}
              onChange={() => void toggle(item.id)}
              className="accent-cyan-600"
            />
            <span
              className={`flex-1 text-xs text-slate-700 ${item.done ? 'line-through text-slate-400' : ''}`}
            >
              {item.text}
            </span>
            <button
              onClick={() => void remove(item.id)}
              className="text-slate-300 hover:text-red-400 transition-colors"
              title="Remove task"
            >
              <span className="material-icons" style={{ fontSize: '0.9rem' }}>
                close
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default TodoList;
