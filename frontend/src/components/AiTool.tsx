import React, { useState, useRef, useEffect } from 'react';

type Message = { role: 'user' | 'ai'; text: string };

const INITIAL: Message = {
  role: 'ai',
  text: "Hi! I'm your AI writing assistant. Ask me to improve your text, summarize content, or help brainstorm ideas.",
};

const AiTool: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([INITIAL]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const t = input.trim();
    if (!t) return;
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: t },
      { role: 'ai', text: 'AI integration coming soon. This is a placeholder response.' },
    ]);
    setInput('');
  };

  return (
    <section className="flex h-full flex-col">
      <h3 className="mb-3 shrink-0 text-sm font-bold uppercase tracking-[0.12em] text-slate-600">
        AI Assistant
      </h3>

      <div className="mb-3 flex-1 overflow-y-auto space-y-2 pr-0.5">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                m.role === 'user'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {m.role === 'ai' && (
                <span
                  className="material-icons mr-1 align-middle text-cyan-500"
                  style={{ fontSize: '0.75rem' }}
                >
                  smart_toy
                </span>
              )}
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex shrink-0 gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask AI…"
          className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-cyan-400 focus:outline-none"
        />
        <button
          onClick={send}
          className="rounded-md bg-cyan-600 px-3 py-1 text-white hover:bg-cyan-700 transition-colors"
          title="Send"
        >
          <span className="material-icons" style={{ fontSize: '1rem' }}>
            send
          </span>
        </button>
      </div>
    </section>
  );
};

export default AiTool;
