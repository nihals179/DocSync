import { useEffect, useState, useRef } from 'react';
import type { CursorFormat, RichEditorHandle } from '../editor';
import type { PageSize } from '../editor/pageConfig';
import { ToolbarDivider } from './ToolbarDivider';
import { PageSizeSelector } from './PageSizeSelector';
import { HistoryControls } from './HistoryControls';
import { FontControls, type TextTypeOption } from './FontControls';
import { TextFormatting } from './TextFormatting';
import { ToolbarButton } from './ToolbarButton';

type ToolbarProps = {
  editorRef: React.RefObject<RichEditorHandle | null>;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Current cursor/selection format from the editor — keeps toolbar in sync */
  cursorFormat?: CursorFormat;
};

/**
 * Main toolbar component that orchestrates all formatting controls.
 * Composed of modular sub-components for maintainability and reusability.
 */
const Toolbar: React.FC<ToolbarProps> = ({
  editorRef,
  pageSize,
  onPageSizeChange,
  isFullscreen = false,
  onToggleFullscreen,
  cursorFormat,
}) => {
  const getTextTypeFromFormat = (fontSizeValue: number, isBoldValue: boolean): TextTypeOption => {
    if (fontSizeValue >= 38) return 'title';
    if (fontSizeValue >= 30) return 'heading1';
    if (fontSizeValue >= 24) return 'heading2';
    if (fontSizeValue >= 20) return 'heading3';
    return isBoldValue && fontSizeValue >= 18 ? 'heading3' : 'paragraph';
  };

  const TEXT_TYPE_PRESETS: Record<TextTypeOption, { fontSize: number; bold: boolean }> = {
    title: { fontSize: 38, bold: true },
    heading1: { fontSize: 32, bold: true },
    heading2: { fontSize: 26, bold: true },
    heading3: { fontSize: 22, bold: true },
    paragraph: { fontSize: 16, bold: false },
  };

  const bold = cursorFormat?.bold ?? false;
  const italic = cursorFormat?.italic ?? false;
  const underline = cursorFormat?.underline ?? false;
  const highlightColor = cursorFormat?.highlightColor ?? null;
  const isBullet = cursorFormat?.bullet ?? false;
  const isNumberList = cursorFormat?.numberList ?? false;
  const hasSpaceBeforeLine = cursorFormat?.hasSpaceBeforeLine ?? false;
  const hasSpaceAfterLine = cursorFormat?.hasSpaceAfterLine ?? false;
  const selectedFont = cursorFormat?.fontFamily ?? 'Raleway';
  const selectedTextType = getTextTypeFromFormat(cursorFormat?.fontSize ?? 16, cursorFormat?.bold ?? false);
  const textColor = cursorFormat?.color ?? '#1e293b';
  const fontSize = cursorFormat?.fontSize ?? 16;
  const lineSpacing = cursorFormat?.lineSpacing ?? 1.5;
  const shouldRefocusCanvas = !cursorFormat?.tableSelected;
  const liveFontSizeRef = useRef(fontSize);

  useEffect(() => {
    liveFontSizeRef.current = fontSize;
  }, [fontSize]);

  /** Return keyboard focus to the editor canvas */
  const refocus = () => {
    if (!shouldRefocusCanvas) return;
    editorRef.current?.focus();
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleFontChange = (fontName: string) => {
    editorRef.current?.setFontFamily(fontName);
    refocus();
  };

  const handleTextTypeChange = (textType: TextTypeOption) => {
    const preset = TEXT_TYPE_PRESETS[textType];
    const currentLineSpacing = cursorFormat?.lineSpacing ?? 1.5;
    editorRef.current?.setFontSize(preset.fontSize);

    const currentBold = editorRef.current?.getBold();
    if (typeof currentBold === 'boolean' && currentBold !== preset.bold) {
      editorRef.current?.toggleBold();
    }

    // Keep line spacing stable when changing text type presets.
    editorRef.current?.setLineSpacing(currentLineSpacing);

    refocus();
  };

  const handleFontSizeDecrease = () => {
    const next = Math.max(8, liveFontSizeRef.current - 1);
    liveFontSizeRef.current = next;
    editorRef.current?.setFontSize(next);
  };

  const handleFontSizeIncrease = () => {
    const next = Math.min(72, liveFontSizeRef.current + 1);
    liveFontSizeRef.current = next;
    editorRef.current?.setFontSize(next);
  };

  const handleFontSizeInput = (val: string) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 8 && n <= 72) {
      liveFontSizeRef.current = n;
      editorRef.current?.setFontSize(n);
    }
  };

  const handleFontSizeBlur = () => refocus();

  const handleColorChange = (color: string) => {
    editorRef.current?.setTextColor(color);
    refocus();
  };

  const handleToggleBold = () => editorRef.current?.toggleBold();
  const handleToggleItalic = () => editorRef.current?.toggleItalic();
  const handleToggleUnderline = () => editorRef.current?.toggleUnderline();
  const handleSetHighlightColor = (color: string | null) => {
    editorRef.current?.setHighlightColor(color);
    refocus();
  };
  const handleToggleBullet = () => editorRef.current?.toggleBullet();
  const handleToggleNumberList = () => editorRef.current?.toggleNumberList();
  const handleIndentLeft = () => editorRef.current?.indentLeft();
  const handleIndentRight = () => editorRef.current?.indentRight();
  const handleLineSpacingChange = (value: number) => {
    editorRef.current?.setLineSpacing(value);
    refocus();
  };
  const handleToggleSpaceBeforeLine = () => editorRef.current?.toggleSpaceBeforeLine();
  const handleToggleSpaceAfterLine = () => editorRef.current?.toggleSpaceAfterLine();
  const [linkPopupOpen, setLinkPopupOpen] = useState(false);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const linkLabelRef = useRef<HTMLInputElement>(null);

  const handleInsertLink = () => {
    setLinkLabel('');
    setLinkUrl('');
    setLinkPopupOpen(true);
    // Focus the label field after render
    setTimeout(() => linkLabelRef.current?.focus(), 50);
  };

  const handleLinkConfirm = () => {
    if (!linkUrl.trim()) return;
    editorRef.current?.insertLink(linkLabel.trim(), linkUrl.trim());
    setLinkPopupOpen(false);
    setLinkLabel('');
    setLinkUrl('');
    refocus();
  };

  const handleLinkCancel = () => {
    setLinkPopupOpen(false);
    setLinkLabel('');
    setLinkUrl('');
    refocus();
  };
  const handleInsertImage = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        editorRef.current?.insertImage(dataUrl);
        refocus();
      };
      reader.onerror = () => {
        const objectUrl = URL.createObjectURL(file);
        editorRef.current?.insertImage(objectUrl);
        refocus();
      };
      reader.readAsDataURL(file);
    };
    picker.click();
  };
  const handleInsertTable = (rows: number, columns: number) => {
    editorRef.current?.insertTable(rows, columns);
    refocus();
  };
  const handleInsertPageBreak = () => {
    editorRef.current?.insertPageBreak();
    refocus();
  };

  const handleUndo = () => editorRef.current?.undo();
  const handleRedo = () => editorRef.current?.redo();
  const handleToggleImagePanel = () => {
    editorRef.current?.toggleImagePanel();
    refocus();
  };
  const handleToggleTablePanel = () => {
    editorRef.current?.toggleTablePanel();
    refocus();
  };

  const handleFormatPainter = () => {
    editorRef.current?.formatPainter();
    refocus();
  };

  const handleClearFormatting = () => {
    editorRef.current?.clearFormatting();
    refocus();
  };

  return (
    <>
    <div
      data-docsync-toolbar="true"
      className="sticky top-0 z-40 mt-2 mb-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1 shadow-sm backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 flex-wrap">
          {/* Page Size */}
          <PageSizeSelector pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
          <ToolbarDivider />

          {/* Undo / Redo */}
          <HistoryControls onUndo={handleUndo} onRedo={handleRedo} />
          <ToolbarButton
            title="Formatting Painter"
            icon="format_paint"
            onClick={handleFormatPainter}
          />
          <ToolbarButton
            title="Clear Formatting"
            icon="format_clear"
            onClick={handleClearFormatting}
          />
          <ToolbarDivider />

          {/* Font Controls */}
          <FontControls
            selectedTextType={selectedTextType}
            selectedFont={selectedFont}
            fontSize={fontSize}
            onTextTypeChange={handleTextTypeChange}
            onFontChange={handleFontChange}
            onFontSizeDecrease={handleFontSizeDecrease}
            onFontSizeIncrease={handleFontSizeIncrease}
            onFontSizeInput={handleFontSizeInput}
            onFontSizeBlur={handleFontSizeBlur}
          />
          <ToolbarDivider />

          {/* Text Formatting */}
          <TextFormatting
            bold={bold}
            italic={italic}
            underline={underline}
            textColor={textColor}
            highlightColor={highlightColor}
            isBullet={isBullet}
            isNumberList={isNumberList}
            lineSpacing={lineSpacing}
            hasSpaceBeforeLine={hasSpaceBeforeLine}
            hasSpaceAfterLine={hasSpaceAfterLine}
            onIndentLeft={handleIndentLeft}
            onIndentRight={handleIndentRight}
            onLineSpacingChange={handleLineSpacingChange}
            onToggleSpaceBeforeLine={handleToggleSpaceBeforeLine}
            onToggleSpaceAfterLine={handleToggleSpaceAfterLine}
            onToggleBold={handleToggleBold}
            onToggleItalic={handleToggleItalic}
            onToggleUnderline={handleToggleUnderline}
            onColorChange={handleColorChange}
            onSetHighlightColor={handleSetHighlightColor}
            onInsertLink={handleInsertLink}
            onInsertImage={handleInsertImage}
            onInsertTable={handleInsertTable}
            onInsertPageBreak={handleInsertPageBreak}
            showPageBreakAction={pageSize !== 'responsive'}
            onToggleBullet={handleToggleBullet}
            onToggleNumberList={handleToggleNumberList}
          />
          {cursorFormat?.imageSelected && (
            <>
              <ToolbarDivider />
              <ToolbarButton
                title="Image Options"
                icon="tune"
                label="Image Options"
                active={cursorFormat.imagePanelOpen}
                onClick={handleToggleImagePanel}
              />
            </>
          )}
          {cursorFormat?.tableSelected && (
            <>
              <ToolbarDivider />
              <ToolbarButton
                title="Table Options"
                icon="table_rows"
                label="Table Options"
                active={cursorFormat.tablePanelOpen}
                onClick={handleToggleTablePanel}
              />
            </>
          )}
        </div>

        <div className="group relative inline-flex">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
            aria-label={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 transition-colors duration-100 hover:bg-slate-100 hover:text-slate-800"
          >
            <span className="material-icons" style={{ fontSize: 18 }}>
              {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
            </span>
          </button>
          <span className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          </span>
        </div>
      </div>
    </div>

    {/* Insert Link popup */}
    {linkPopupOpen && (
      <div
        className="fixed inset-0 z-200 flex items-center justify-center"
        onMouseDown={(e) => { if (e.target === e.currentTarget) handleLinkCancel(); }}
      >
        <div
          className="w-90 rounded-xl border border-slate-200 bg-white shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <span className="material-icons text-blue-500" style={{ fontSize: 20 }}>link</span>
            <span className="text-[14px] font-semibold text-slate-800">Insert Link</span>
          </div>
          {/* Body */}
          <div className="flex flex-col gap-3.5 px-5 py-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Label</label>
              <input
                ref={linkLabelRef}
                type="text"
                placeholder="Display text (optional)"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLinkConfirm(); } if (e.key === 'Escape') handleLinkCancel(); }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">URL <span className="text-red-400">*</span></label>
              <div className="flex items-center gap-1.5">
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLinkConfirm(); } if (e.key === 'Escape') handleLinkCancel(); }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  title="Paste from clipboard"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) setLinkUrl(text.trim());
                    } catch {
                      // clipboard access denied — ignore silently
                    }
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                >
                  <span className="material-icons" style={{ fontSize: 18 }}>content_paste</span>
                </button>
              </div>
            </div>
          </div>
          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={handleLinkCancel}
              className="rounded-lg px-4 py-1.5 text-[13px] font-medium text-slate-500 hover:bg-slate-50"
            >Cancel</button>
            <button
              type="button"
              onClick={handleLinkConfirm}
              disabled={!linkUrl.trim()}
              className="rounded-lg bg-blue-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-600 disabled:opacity-40"
            >Insert</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Toolbar;
