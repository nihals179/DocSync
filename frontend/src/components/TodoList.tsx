import React, { useState } from 'react';

type TodoItem = { id: string; text: string; done: boolean };

const TodoList: React.FC = () => {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [input, setInput] = useState('');

  const add = () => {
    const t = input.trim();
    if (!t) return;
    setItems((prev) => [...prev, { id: String(Date.now()), text: t, done: false }]);
    setInput('');
  };

  const toggle = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));

  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  return (
    <section className="flex h-full flex-col">
      <h3 className="mb-3 shrink-0 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
        To-Do List
      </h3>
      <div className="mb-3 flex shrink-0 gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a task…"
          className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-cyan-400 focus:outline-none"
        />
        <button
          onClick={add}
          className="rounded-md bg-cyan-600 px-3 py-1 text-sm font-medium text-white hover:bg-cyan-700 transition-colors"
        >
          Add
        </button>
      </div>
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
              onChange={() => toggle(item.id)}
              className="accent-cyan-600"
            />
            <span
              className={`flex-1 text-xs text-slate-700 ${item.done ? 'line-through text-slate-400' : ''}`}
            >
              {item.text}
            </span>
            <button
              onClick={() => remove(item.id)}
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
