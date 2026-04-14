import React, { useEffect, useRef, useState } from 'react';
import { ToolbarButton } from './ToolbarButton';
import { ColorPicker } from './ColorPicker';

type TextFormattingProps = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textColor: string;
  highlightColor: string | null;
  isBullet: boolean;
  isNumberList: boolean;
  lineSpacing: number;
  hasSpaceBeforeLine: boolean;
  hasSpaceAfterLine: boolean;
  onIndentLeft: () => void;
  onIndentRight: () => void;
  onLineSpacingChange: (value: number) => void;
  onToggleSpaceBeforeLine: () => void;
  onToggleSpaceAfterLine: () => void;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleUnderline: () => void;
  onColorChange: (color: string) => void;
  onSetHighlightColor: (color: string | null) => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onToggleBullet: () => void;
  onToggleNumberList: () => void;
};

/**
 * Text formatting buttons: Bold, Italic, Underline, Bullet.
 * Each button toggles its respective formatting on/off.
 */
export const TextFormatting: React.FC<TextFormattingProps> = ({
  bold,
  italic,
  underline,
  textColor,
  highlightColor,
  isBullet,
  isNumberList,
  lineSpacing,
  hasSpaceBeforeLine,
  hasSpaceAfterLine,
  onIndentLeft,
  onIndentRight,
  onLineSpacingChange,
  onToggleSpaceBeforeLine,
  onToggleSpaceAfterLine,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
  onColorChange,
  onSetHighlightColor,
  onInsertLink,
  onInsertImage,
  onToggleBullet,
  onToggleNumberList,
}) => {
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [showLineSpacingMenu, setShowLineSpacingMenu] = useState(false);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const lineSpacingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showHighlightMenu && !showLineSpacingMenu) return;

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!highlightRef.current?.contains(target)) setShowHighlightMenu(false);
      if (!lineSpacingRef.current?.contains(target)) setShowLineSpacingMenu(false);
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [showHighlightMenu, showLineSpacingMenu]);

  const spacingOptions = [1, 1.5, 2];
  const highlightOptions = ['#facc15', '#4ade80', '#60a5fa', '#f472b6'];

  return (
    <>
      <div className="mr-1 flex items-center gap-0.5">
        <ToolbarButton title="Bold (⌘B)" icon="format_bold" active={bold} onClick={onToggleBold} />
        <ToolbarButton
          title="Italic (⌘I)"
          icon="format_italic"
          active={italic}
          onClick={onToggleItalic}
        />
        <ToolbarButton
          title="Underline (⌘U)"
          icon="format_underlined"
          active={underline}
          onClick={onToggleUnderline}
        />
        <div className="relative" ref={highlightRef}>
          <ToolbarButton
            title="Highlight"
            icon="edit"
            active={showHighlightMenu || Boolean(highlightColor)}
            onClick={() => setShowHighlightMenu((prev) => !prev)}
          />

          {showHighlightMenu && (
            <div
              className="absolute left-0 top-9 z-80 min-w-36 rounded-xl border border-slate-300 bg-white p-2 shadow-xl ring-1 ring-slate-200 pointer-events-auto"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Highlight
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {highlightOptions.map((option) => {
                  const active = highlightColor === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      title="Highlight color"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className={`relative h-7 w-7 rounded-md border ${active ? 'border-slate-700 ring-1 ring-slate-400' : 'border-slate-300 hover:border-slate-400'}`}
                      style={{ backgroundColor: option }}
                      onClick={() => {
                        onSetHighlightColor(active ? null : option);
                        setShowHighlightMenu(false);
                      }}
                    >
                      {active && (
                        <span className="material-icons text-[12px] leading-none text-slate-900">
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="mt-2 flex w-full items-center justify-center rounded-md border border-slate-200 px-2 py-1 text-center text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onSetHighlightColor(null);
                  setShowHighlightMenu(false);
                }}
              >
                Clear highlight
              </button>
            </div>
          )}
        </div>
        <ColorPicker textColor={textColor} onColorChange={onColorChange} />
        <span className="mx-0.5 h-5 w-px bg-slate-200" />
      </div>
      <ToolbarButton title="Insert link" icon="link" onClick={onInsertLink} />
      <ToolbarButton title="Insert image" icon="image" onClick={onInsertImage} />
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <ToolbarButton
        title="Bullet list"
        icon="format_list_bulleted"
        active={isBullet}
        onClick={onToggleBullet}
      />
      <ToolbarButton
        title="Numbered list"
        icon="format_list_numbered"
        active={isNumberList}
        onClick={onToggleNumberList}
      />
      <ToolbarButton title="Decrease indent" icon="format_indent_decrease" onClick={onIndentLeft} />
      <ToolbarButton
        title="Increase indent"
        icon="format_indent_increase"
        onClick={onIndentRight}
      />

      <div className="relative" ref={lineSpacingRef}>
        <ToolbarButton
          title="Line spacing"
          icon="format_line_spacing"
          active={showLineSpacingMenu}
          onClick={() => setShowLineSpacingMenu((prev) => !prev)}
        />

        {showLineSpacingMenu && (
          <div
            className="absolute right-0 top-9 z-80 min-w-23 rounded-xl border border-slate-300 bg-white p-1.5 shadow-xl ring-1 ring-slate-200 pointer-events-auto"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {spacingOptions.map((option) => {
              const active = Math.abs(lineSpacing - option) < 0.001;
              return (
                <button
                  key={option}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className={`mb-1 w-full rounded-md px-2 py-1 text-left text-xs ${active ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'} last:mb-0`}
                  onClick={() => {
                    onLineSpacingChange(option);
                    setShowLineSpacingMenu(false);
                  }}
                >
                  {option.toFixed(1)}
                </button>
              );
            })}

            <div className="my-1 border-t border-slate-200" />

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="mb-1 w-full rounded-md px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              onClick={() => {
                onToggleSpaceBeforeLine();
                setShowLineSpacingMenu(false);
              }}
            >
              {hasSpaceBeforeLine ? 'Remove space before line' : 'Add space before line'}
            </button>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="w-full rounded-md px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              onClick={() => {
                onToggleSpaceAfterLine();
                setShowLineSpacingMenu(false);
              }}
            >
              {hasSpaceAfterLine ? 'Remove space after line' : 'Add space after line'}
            </button>
          </div>
        )}
      </div>
    </>
  );
};
