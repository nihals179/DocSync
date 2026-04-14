import type { MouseEvent, ReactNode } from 'react';
import type { ImageWrap } from '../textModel';
import type { ImageBox } from '../useEditorDraw';
import { IMAGE_WRAP_OPTIONS } from './imageUiConfig';
import { ImageWrapIcon } from './imageWrapIcons';

export type BreakLayoutMode = 'break-right' | 'break-left' | 'break-center';

type BreakLayoutOption = {
  key: BreakLayoutMode;
  title: string;
  align: 'left' | 'center' | 'right';
  icon: ReactNode;
};

const BREAK_LAYOUT_OPTIONS: BreakLayoutOption[] = [
  {
    key: 'break-left',
    title: 'Break text left',
    align: 'left',
    icon: (
      <svg viewBox="0 -960 960 960" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Z" />
      </svg>
    ),
  },
  {
    key: 'break-center',
    title: 'Break text center',
    align: 'center',
    icon: (
      <svg viewBox="0 -960 960 960" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M120-760v-80h720v80H120Zm160 480v-400h400v400H280Zm80-80h240v-240H360v240ZM120-120v-80h720v80H120Zm360-360Z" />
      </svg>
    ),
  },
  {
    key: 'break-right',
    title: 'Break text right',
    align: 'right',
    icon: (
      <svg viewBox="0 -960 960 960" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M120-760v-80h720v80H120Zm320 480v-400h400v400H440Zm80-80h240v-240H520v240ZM120-120v-80h720v80H120Zm520-360Z" />
      </svg>
    ),
  },
];

type ButtonMouseDown = (event: MouseEvent<HTMLButtonElement>) => void;

export function BreakLayoutControls({
  image,
  onSelect,
  onMouseDownButton,
  variant,
}: {
  image: ImageBox;
  onSelect: (mode: BreakLayoutMode) => void;
  onMouseDownButton?: ButtonMouseDown;
  variant: 'compact' | 'panel';
}) {
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1 rounded-full bg-slate-100/90 p-1">
        {BREAK_LAYOUT_OPTIONS.map((option) => {
          const isActive = image.meta.wrap === 'break' && image.meta.align === option.align;
          return (
            <div key={option.key} className="relative inline-flex group">
              <button
                type="button"
                title={option.title}
                onMouseDown={onMouseDownButton}
                onClick={() => onSelect(option.key)}
                className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${isActive ? 'bg-white text-cyan-700 shadow-[0_2px_6px_rgba(15,23,42,0.14)]' : 'text-slate-500 hover:bg-white/90 hover:text-slate-700'}`}
              >
                {option.icon}
              </button>
              <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {option.title}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-3 grid grid-cols-3 gap-2">
      {BREAK_LAYOUT_OPTIONS.map((option) => {
        const isActive = image.meta.wrap === 'break' && image.meta.align === option.align;
        return (
          <button
            key={option.key}
            type="button"
            className={`flex items-center justify-center rounded-xl border px-2.5 py-2 transition-all ${isActive ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50/40'}`}
            onClick={() => onSelect(option.key)}
            title={option.title}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}

export function WrapModeControls({
  currentWrap,
  onSelect,
  onMouseDownButton,
  variant,
}: {
  currentWrap: ImageWrap;
  onSelect: (wrap: ImageWrap) => void;
  onMouseDownButton?: ButtonMouseDown;
  variant: 'compact' | 'panel';
}) {
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1 rounded-full bg-slate-100/90 p-1">
        {IMAGE_WRAP_OPTIONS.map((option) => {
          const isActive = currentWrap === option.key;
          return (
            <div key={option.key} className="relative inline-flex group">
              <button
                type="button"
                title={option.title}
                onMouseDown={onMouseDownButton}
                onClick={() => onSelect(option.key)}
                className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${isActive ? 'bg-white text-cyan-700 shadow-[0_2px_6px_rgba(15,23,42,0.14)]' : 'text-slate-500 hover:bg-white/90 hover:text-slate-700'}`}
              >
                <ImageWrapIcon wrap={option.key} className="h-4 w-4" />
              </button>
              <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {option.title}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {IMAGE_WRAP_OPTIONS.map((option) => {
        const isActive = currentWrap === option.key;
        return (
          <button
            key={option.key}
            type="button"
            className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all ${isActive ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50/40'}`}
            onClick={() => onSelect(option.key)}
            title={option.title}
          >
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${isActive ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              <ImageWrapIcon wrap={option.key} className="h-5 w-5" />
            </span>
            <span className="text-xs font-medium leading-tight">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
