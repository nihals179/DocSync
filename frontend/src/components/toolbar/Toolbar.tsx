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
  const [tablePanelOpen, setTablePanelOpen] = useState(false);
  const [tableBorderColor, setTableBorderColor] = useState('#cbd5e1');
  const [tableBorderWidth, setTableBorderWidth] = useState(1);
  const [tableBorderRadius, setTableBorderRadius] = useState(0);
  const linkLabelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cursorFormat?.tableSelected) return;
    setTableBorderRadius(Math.max(0, Math.min(24, Math.round(cursorFormat.tableBorderRadiusPx ?? 0))));
  }, [cursorFormat?.tableSelected, cursorFormat?.tableBorderRadiusPx]);

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
    setTablePanelOpen((prev) => !prev);
  };

  const handleSetTableTextAlign = (align: 'left' | 'center' | 'right') => {
    editorRef.current?.setTableTextAlign(align);
  };

  const handleSetTableBorderColor = (color: string) => {
    setTableBorderColor(color);
    editorRef.current?.setTableBorderColor(color);
  };

  const handleSetTableBorderWidth = (width: number) => {
    const next = Math.max(0, Math.min(8, Math.round(width)));
    setTableBorderWidth(next);
    editorRef.current?.setTableBorderWidth(next);
  };

  const handleSetTableNoBorders = () => {
    setTableBorderWidth(0);
    editorRef.current?.setTableNoBorders();
  };

  const handleSetTableBorderRadius = (radiusPx: number) => {
    const next = Math.max(0, Math.min(24, Math.round(radiusPx)));
    setTableBorderRadius(next);
    editorRef.current?.setTableBorderRadius(next);
  };

  const handleAddTableRowAbove = () => {
    editorRef.current?.addTableRowAbove();
  };

  const handleAddTableRowBelow = () => {
    editorRef.current?.addTableRowBelow();
  };

  const handleAddTableColumnLeft = () => {
    editorRef.current?.addTableColumnLeft();
  };

  const handleAddTableColumnRight = () => {
    editorRef.current?.addTableColumnRight();
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
          {(cursorFormat?.tableSelected || tablePanelOpen) && (
            <>
              <ToolbarDivider />
              <ToolbarButton
                title="Table Options"
                icon="table_rows"
                label="Table Options"
                active={tablePanelOpen}
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

    <div
      className="pointer-events-none fixed inset-0 z-50 transition"
      aria-hidden={!tablePanelOpen}
    >
      <aside
        className={`pointer-events-auto absolute bottom-0 right-0 top-16 w-75 max-w-[92vw] border-l border-slate-200/90 bg-white/98 shadow-[-10px_14px_34px_rgba(15,23,42,0.16)] backdrop-blur transition-transform duration-200 ${tablePanelOpen ? 'translate-x-0' : 'translate-x-[108%]'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-slate-800">
            <span className="material-icons text-cyan-700" style={{ fontSize: 17 }}>table_rows</span>
            <span className="text-[13px] font-semibold">Table Options</span>
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTablePanelOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Close table options"
          >
            <span className="material-icons" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        <div className="h-[calc(100%-50px)] space-y-4 overflow-y-auto p-3.5">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Text Alignment</div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                title="Align left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSetTableTextAlign('left')}
                className={`flex h-8 items-center justify-center rounded-md border text-xs font-medium ${cursorFormat?.textAlign === 'left' ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <span className="material-icons" style={{ fontSize: 18 }}>format_align_left</span>
              </button>
              <button
                type="button"
                title="Align center"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSetTableTextAlign('center')}
                className={`flex h-8 items-center justify-center rounded-md border text-xs font-medium ${cursorFormat?.textAlign === 'center' ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <span className="material-icons" style={{ fontSize: 18 }}>format_align_center</span>
              </button>
              <button
                type="button"
                title="Align right"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSetTableTextAlign('right')}
                className={`flex h-8 items-center justify-center rounded-md border text-xs font-medium ${cursorFormat?.textAlign === 'right' ? 'border-cyan-500 bg-cyan-50 text-cyan-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <span className="material-icons" style={{ fontSize: 18 }}>format_align_right</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Structure</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddTableRowAbove}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Add row above"
              >
                <span className="material-icons" style={{ fontSize: 14 }}>add</span>
                Row Above
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddTableRowBelow}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Add row below"
              >
                <span className="material-icons" style={{ fontSize: 14 }}>add</span>
                Row Below
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddTableColumnLeft}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Add column left"
              >
                <span className="material-icons" style={{ fontSize: 14 }}>add</span>
                Col Left
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddTableColumnRight}
                className="flex h-8 items-center justify-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Add column right"
              >
                <span className="material-icons" style={{ fontSize: 14 }}>add</span>
                Col Right
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Borders</div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Border Color</div>
                <div className="text-[11px] text-slate-400">Applies to selected table edges</div>
              </div>
              <input
                type="color"
                value={tableBorderColor}
                onChange={(e) => handleSetTableBorderColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                title="Table border color"
              />
            </div>

            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Border Size</div>
                <div className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{tableBorderWidth}px</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={tableBorderWidth}
                  onChange={(e) => handleSetTableBorderWidth(Number(e.target.value || 0))}
                  className="h-2 w-full cursor-pointer accent-cyan-600"
                  title="Table border size"
                />
                <input
                  type="number"
                  min={0}
                  max={8}
                  step={1}
                  value={tableBorderWidth}
                  onChange={(e) => handleSetTableBorderWidth(Number(e.target.value || 0))}
                  className="h-8 w-14 rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200"
                  title="Table border size"
                />
              </div>
            </div>

            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleSetTableNoBorders}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Remove borders"
            >
              <span className="material-icons" style={{ fontSize: 15 }}>border_clear</span>
              No Borders
            </button>

            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Roundness</div>
                <div className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{tableBorderRadius}px</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={tableBorderRadius}
                  onChange={(e) => handleSetTableBorderRadius(Number(e.target.value || 0))}
                  className="h-2 w-full cursor-pointer accent-cyan-600"
                  title="Rounded border radius"
                />
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={tableBorderRadius}
                  onChange={(e) => handleSetTableBorderRadius(Number(e.target.value || 0))}
                  className="h-8 w-14 rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200"
                  title="Rounded border radius"
                />
              </div>
            </div>
          </div>
        </div>
      </aside>
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
