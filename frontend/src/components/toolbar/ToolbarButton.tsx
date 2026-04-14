import React from 'react';

type ToolbarButtonProps = {
  title: string;
  icon: string;
  active?: boolean;
  onClick: () => void;
  label?: string;
};

/**
 * Reusable toolbar button with icon, active state, and focus preservation.
 * `onMouseDown` prevents canvas focus loss when clicked.
 */
export const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  title,
  icon,
  active,
  onClick,
  label,
}) => (
  <div className="group relative inline-flex">
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-7 items-center justify-center gap-1 rounded px-2 transition-colors duration-100 ${
        active ? 'bg-cyan-50 text-cyan-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
      }`}
    >
      <span className="material-icons" style={{ fontSize: 18 }}>
        {icon}
      </span>
      {label ? <span className="text-xs font-medium leading-none">{label}</span> : null}
    </button>
    <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity duration-100 group-hover:opacity-100">
      {title}
    </span>
  </div>
);
