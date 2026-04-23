import { useCallback, useEffect, useMemo, useRef } from 'react';

export type CanvasMenuAction =
  | 'toggle-bold'
  | 'toggle-italic'
  | 'toggle-underline'
  | 'set-font-family'
  | 'set-font-size'
  | 'set-font-color'
  | 'set-highlight-color'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'paste-with-format'
  | 'format-painter'
  | 'clear-formatting'
  | 'comments'
  | 'insert-link'
  | 'insert-image'
  | 'spelling-check'
  | 'table-edit-cell'
  | 'table-add-row-above'
  | 'table-add-row-below'
  | 'table-delete-row'
  | 'table-add-column-left'
  | 'table-add-column-right'
  | 'table-delete-column'
  | 'table-sort-asc'
  | 'table-sort-desc'
  | 'table-open-options'
  | 'table-delete';

type MenuItem = {
  id: CanvasMenuAction;
  label: string;
  icon: string;
  shortcut: Array<'mod' | 'alt' | 'shift' | 'space' | 'f7' | 'x' | 'c' | 'v' | 'm' | 'k' | 'i'>;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

const MENU_SECTIONS: MenuSection[] = [
  {
    title: 'Clipboard',
    items: [
      { id: 'cut', label: 'Cut', icon: 'content_cut', shortcut: ['mod', 'x'] },
      { id: 'copy', label: 'Copy', icon: 'content_copy', shortcut: ['mod', 'c'] },
      { id: 'paste', label: 'Paste', icon: 'content_paste', shortcut: ['mod', 'v'] },
      {
        id: 'paste-with-format',
        label: 'Paste with format',
        icon: 'content_paste_go',
        shortcut: [],
      },
    ],
  },
  {
    title: 'Editing',
    items: [
      {
        id: 'format-painter',
        label: 'Formatting painter',
        icon: 'format_paint',
        shortcut: ['mod', 'shift', 'c'],
      },
      {
        id: 'clear-formatting',
        label: 'Clear formatting',
        icon: 'format_clear',
        shortcut: ['mod', 'space'],
      },
      { id: 'comments', label: 'Comments', icon: 'comment', shortcut: ['mod', 'alt', 'm'] },
    ],
  },
  {
    title: 'Insert',
    items: [
      { id: 'insert-link', label: 'Insert link', icon: 'link', shortcut: ['mod', 'k'] },
      {
        id: 'insert-image',
        label: 'Insert image',
        icon: 'image',
        shortcut: ['mod', 'shift', 'i'],
      },
    ],
  },
  {
    title: 'Review',
    items: [
      { id: 'spelling-check', label: 'Spelling check', icon: 'spellcheck', shortcut: ['f7'] },
    ],
  },
];

const TABLE_MENU_SECTIONS: MenuSection[] = [
  {
    title: 'Clipboard',
    items: [
      { id: 'cut', label: 'Cut', icon: 'content_cut', shortcut: ['mod', 'x'] },
      { id: 'copy', label: 'Copy', icon: 'content_copy', shortcut: ['mod', 'c'] },
      { id: 'paste', label: 'Paste', icon: 'content_paste', shortcut: ['mod', 'v'] },
      {
        id: 'paste-with-format',
        label: 'Paste with format',
        icon: 'content_paste_go',
        shortcut: [],
      },
    ],
  },
  {
    title: 'Cell',
    items: [
      { id: 'table-edit-cell', label: 'Edit cell', icon: 'edit', shortcut: [] },
      {
        id: 'table-open-options',
        label: 'Open table options',
        icon: 'tune',
        shortcut: [],
      },
      { id: 'table-sort-asc', label: 'Sort A to Z', icon: 'sort_by_alpha', shortcut: [] },
      { id: 'table-sort-desc', label: 'Sort Z to A', icon: 'sort_by_alpha', shortcut: [] },
    ],
  },
  {
    title: 'Rows',
    items: [
      { id: 'table-add-row-above', label: 'Add row above', icon: 'add', shortcut: [] },
      { id: 'table-add-row-below', label: 'Add row below', icon: 'add', shortcut: [] },
      { id: 'table-delete-row', label: 'Delete row', icon: 'delete', shortcut: [] },
    ],
  },
  {
    title: 'Columns',
    items: [
      { id: 'table-add-column-left', label: 'Add column left', icon: 'add', shortcut: [] },
      { id: 'table-add-column-right', label: 'Add column right', icon: 'add', shortcut: [] },
      { id: 'table-delete-column', label: 'Delete column', icon: 'delete', shortcut: [] },
    ],
  },
  {
    title: 'Table',
    items: [{ id: 'table-delete', label: 'Delete table', icon: 'delete_forever', shortcut: [] }],
  },
];

export function CanvasContextMenu({
  open,
  x,
  y,
  showQuickFormatting,
  isTableContext,
  tableContextLabel,
  quickFormattingState,
  onClose,
  onAction,
}: {
  open: boolean;
  x: number;
  y: number;
  showQuickFormatting: boolean;
  isTableContext?: boolean;
  tableContextLabel?: string;
  quickFormattingState: {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    fontFamily: string;
    fontSize: number;
    color: string;
    highlightColor: string | null;
  };
  onClose: () => void;
  onAction: (action: CanvasMenuAction, value?: string | number | null) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const textColorInputRef = useRef<HTMLInputElement | null>(null);
  const highlightColorInputRef = useRef<HTMLInputElement | null>(null);
  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform ?? '';
    return /mac/i.test(platform);
  }, []);

  const formatShortcutKey = useCallback(
    (key: MenuItem['shortcut'][number]) => {
      if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
      if (key === 'alt') return isMac ? '⌥' : 'Alt';
      if (key === 'shift') return isMac ? '⇧' : 'Shift';
      if (key === 'space') return isMac ? '␣' : 'Space';
      if (key === 'f7') return 'F7';
      return key.toUpperCase();
    },
    [isMac],
  );

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!menuRef.current?.contains(target)) onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const style = useMemo(() => ({ left: x, top: y }), [x, y]);
  const activeSections = isTableContext ? TABLE_MENU_SECTIONS : MENU_SECTIONS;
  const destructiveActions = new Set<CanvasMenuAction>([
    'table-delete-row',
    'table-delete-column',
    'table-delete',
  ]);

  if (!open) return null;

  const quickActions: Array<{
    id: Extract<CanvasMenuAction, 'toggle-bold' | 'toggle-italic' | 'toggle-underline'>;
    icon: 'format_bold' | 'format_italic' | 'format_underlined';
    label: string;
    active: boolean;
  }> = [
    {
      id: 'toggle-bold',
      icon: 'format_bold',
      label: 'Bold',
      active: quickFormattingState.bold,
    },
    {
      id: 'toggle-italic',
      icon: 'format_italic',
      label: 'Italic',
      active: quickFormattingState.italic,
    },
    {
      id: 'toggle-underline',
      icon: 'format_underlined',
      label: 'Underline',
      active: quickFormattingState.underline,
    },
  ];

  const fontFamilies = [
    'Raleway',
    'Arial',
    'Helvetica',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Times New Roman',
    'Georgia',
    'Garamond',
    'Palatino',
    'Cambria',
    'Courier New',
    'Consolas',
    'Monaco',
    'Lucida Console',
    'Comic Sans MS',
    'Impact',
  ];

  return (
    <div ref={menuRef} className="absolute z-50" style={style}>
      {showQuickFormatting && (
        <div
          className="relative z-20 mb-1.5 w-fit max-w-[92vw] overflow-visible rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-sm"
          role="group"
          aria-label="Quick formatting"
        >
          <div>
            <div className="flex max-w-[90vw] flex-wrap items-center gap-1">
            <section className="flex items-center gap-1">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onAction(action.id)}
                  className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${action.active ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800'}`}
                  aria-label={action.label}
                  title={action.label}
                >
                  <span className="material-icons text-[16px]">{action.icon}</span>
                </button>
              ))}
            </section>

            <div className="h-6 w-px bg-slate-200" />

            <section className="flex items-center gap-1">
              <select
                value={quickFormattingState.fontFamily}
                onChange={(event) => onAction('set-font-family', event.target.value)}
                className="h-7 w-24 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-cyan-300"
                aria-label="Font family"
                title="Font family"
              >
                {fontFamilies.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={8}
                max={72}
                value={quickFormattingState.fontSize}
                onChange={(event) => onAction('set-font-size', Number(event.target.value))}
                className="h-7 w-12 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-cyan-300"
                aria-label="Font size"
                title="Font size"
              />
            </section>

            <div className="h-6 w-px bg-slate-200" />

            <section className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => textColorInputRef.current?.click()}
                className="relative flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100"
                aria-label="Text color"
                title="Text color"
              >
                <span className="text-[14px] font-semibold leading-none">A</span>
                <span
                  className="absolute bottom-1 h-1 w-4 rounded-full"
                  style={{ backgroundColor: quickFormattingState.color }}
                />
              </button>
              <input
                ref={textColorInputRef}
                type="color"
                value={quickFormattingState.color}
                onChange={(event) => onAction('set-font-color', event.target.value)}
                className="invisible absolute h-0 w-0"
                tabIndex={-1}
                aria-label="Font color"
              />

              <button
                type="button"
                onClick={() => highlightColorInputRef.current?.click()}
                className="relative flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100"
                aria-label="Highlight color"
                title="Highlight color"
              >
                <span className="material-icons text-[16px]">highlight</span>
                <span
                  className="absolute bottom-1 h-1 w-4 rounded-full"
                  style={{ backgroundColor: quickFormattingState.highlightColor ?? '#fde047' }}
                />
              </button>
              <input
                ref={highlightColorInputRef}
                type="color"
                value={quickFormattingState.highlightColor ?? '#fde047'}
                onChange={(event) => onAction('set-highlight-color', event.target.value)}
                className="invisible absolute h-0 w-0"
                tabIndex={-1}
                aria-label="Highlight color"
              />

              <button
                type="button"
                onClick={() => onAction('set-highlight-color', null)}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100"
                aria-label="Clear highlight"
                title="Clear highlight"
              >
                <span className="material-icons text-[16px]">format_color_reset</span>
              </button>
            </section>

            <div className="h-6 w-px bg-slate-200" />

            <section className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onAction('insert-link')}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100"
                aria-label="Insert link"
                title="Insert link"
              >
                <span className="material-icons text-[15px]">link</span>
              </button>

              <button
                type="button"
                onClick={() => onAction('insert-image')}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100"
                aria-label="Insert image"
                title="Insert image"
              >
                <span className="material-icons text-[15px]">image</span>
              </button>
            </section>
            </div>
          </div>
        </div>
      )}

      <div
        className="relative z-10 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white/98 p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.22)] backdrop-blur"
        role="menu"
        aria-label="Canvas context menu"
      >
        {isTableContext && tableContextLabel ? (
          <div className="px-2.5 py-1 text-[11px] font-medium text-slate-500">{tableContextLabel}</div>
        ) : null}
        {activeSections.map((section, sectionIndex) => (
          <div key={section.title}>
            {sectionIndex > 0 && <div className="my-1 h-px bg-slate-200" />}
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {section.title}
            </div>
            {section.items.map((item) => (
              (() => {
                const isDestructive = destructiveActions.has(item.id);
                return (
              <button
                key={item.id}
                type="button"
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  isDestructive
                    ? 'text-rose-700 hover:bg-rose-50/80'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                onClick={() => {
                  onAction(item.id);
                  onClose();
                }}
                role="menuitem"
              >
                <span
                  className={`material-icons text-[16px] ${isDestructive ? 'text-rose-600' : 'text-slate-500'}`}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                <span className="flex items-center gap-1">
                  {item.shortcut.map((part) => (
                    <span
                      key={`${item.id}-${part}`}
                      className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-500"
                    >
                      {formatShortcutKey(part)}
                    </span>
                  ))}
                </span>
              </button>
                );
              })()
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
