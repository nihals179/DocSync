import { useEffect, useMemo, useRef, useState } from 'react';

type ThemeListboxOption = {
  id: string;
  name: string;
};

type ThemeListboxProps = {
  value: string;
  options: ThemeListboxOption[];
  onChange: (nextValue: string) => void;
  placeholder?: string;
};

export default function ThemeListbox({ value, options, onChange, placeholder = 'Select an option' }: ThemeListboxProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => options.find((option) => option.id === value) || null, [options, value]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      const target = event.target as Node;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-left text-xs font-medium text-slate-800 outline-none transition hover:border-cyan-300 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="block truncate pr-5">{selected?.name || placeholder}</span>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-cyan-700">
          <span className="material-icons text-base">expand_more</span>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-95 mt-1.5 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <ul className="max-h-44 overflow-auto py-1">
            {options.map((option) => {
              const isSelected = option.id === value;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition ${
                      isSelected
                        ? 'bg-cyan-50 font-semibold text-cyan-800'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{option.name}</span>
                    {isSelected && <span className="material-icons text-sm">done</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
