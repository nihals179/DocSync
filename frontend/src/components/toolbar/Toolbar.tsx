import { useState, useEffect } from 'react';
import type { CursorFormat, RichEditorHandle } from '../editor';
import { ToolbarDivider } from './ToolbarDivider';
import { PageSizeSelector } from './PageSizeSelector';
import { HistoryControls } from './HistoryControls';
import { FontControls, type TextTypeOption } from './FontControls';
import { TextFormatting } from './TextFormatting';
import { ToolbarButton } from './ToolbarButton';

type ToolbarProps = {
  editorRef: React.RefObject<RichEditorHandle | null>;
  pageSize: 'responsive' | 'A3' | 'A4' | 'A5';
  onPageSizeChange: (size: 'responsive' | 'A3' | 'A4' | 'A5') => void;
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

  // Local display state — mirrored from cursorFormat prop
  const [bold, setBold] = useState(cursorFormat?.bold ?? false);
  const [italic, setItalic] = useState(cursorFormat?.italic ?? false);
  const [underline, setUnderline] = useState(cursorFormat?.underline ?? false);
  const [highlightColor, setHighlightColor] = useState<string | null>(
    cursorFormat?.highlightColor ?? null,
  );
  const [isBullet, setIsBullet] = useState(cursorFormat?.bullet ?? false);
  const [isNumberList, setIsNumberList] = useState(cursorFormat?.numberList ?? false);
  const [hasSpaceBeforeLine, setHasSpaceBeforeLine] = useState(
    cursorFormat?.hasSpaceBeforeLine ?? false,
  );
  const [hasSpaceAfterLine, setHasSpaceAfterLine] = useState(
    cursorFormat?.hasSpaceAfterLine ?? false,
  );
  const [selectedFont, setSelectedFont] = useState(cursorFormat?.fontFamily ?? 'Raleway');
  const [selectedTextType, setSelectedTextType] = useState<TextTypeOption>(
    getTextTypeFromFormat(cursorFormat?.fontSize ?? 16, cursorFormat?.bold ?? false),
  );
  const [textColor, setTextColor] = useState(cursorFormat?.color ?? '#1e293b');
  const [fontSize, setFontSize] = useState(cursorFormat?.fontSize ?? 16);
  const [lineSpacing, setLineSpacing] = useState(cursorFormat?.lineSpacing ?? 1.5);

  // Keep local state in sync whenever the editor reports a cursor change
  useEffect(() => {
    if (!cursorFormat) return;
    setBold(cursorFormat.bold);
    setItalic(cursorFormat.italic);
    setUnderline(cursorFormat.underline);
    setHighlightColor(cursorFormat.highlightColor ?? null);
    setIsBullet(cursorFormat.bullet ?? false);
    setIsNumberList(cursorFormat.numberList ?? false);
    setHasSpaceBeforeLine(cursorFormat.hasSpaceBeforeLine ?? false);
    setHasSpaceAfterLine(cursorFormat.hasSpaceAfterLine ?? false);
    setSelectedFont(cursorFormat.fontFamily);
    setSelectedTextType(getTextTypeFromFormat(cursorFormat.fontSize, cursorFormat.bold));
    setTextColor(cursorFormat.color);
    setFontSize(cursorFormat.fontSize);
    setLineSpacing(cursorFormat.lineSpacing ?? 1.5);
  }, [cursorFormat]);

  /** Return keyboard focus to the editor canvas */
  const refocus = () => editorRef.current?.focus();

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleFontChange = (fontName: string) => {
    setSelectedFont(fontName);
    editorRef.current?.setFontFamily(fontName);
    refocus();
  };

  const handleTextTypeChange = (textType: TextTypeOption) => {
    setSelectedTextType(textType);
    const preset = TEXT_TYPE_PRESETS[textType];
    setFontSize(preset.fontSize);
    editorRef.current?.setFontSize(preset.fontSize);

    const currentBold = editorRef.current?.getBold();
    if (typeof currentBold === 'boolean' && currentBold !== preset.bold) {
      editorRef.current?.toggleBold();
      setBold(preset.bold);
    }

    refocus();
  };

  const handleFontSizeDecrease = () => {
    const next = Math.max(8, fontSize - 1);
    setFontSize(next);
    editorRef.current?.setFontSize(next);
  };

  const handleFontSizeIncrease = () => {
    const next = Math.min(72, fontSize + 1);
    setFontSize(next);
    editorRef.current?.setFontSize(next);
  };

  const handleFontSizeInput = (val: string) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 8 && n <= 72) {
      setFontSize(n);
      editorRef.current?.setFontSize(n);
    }
  };

  const handleFontSizeBlur = () => refocus();

  const handleColorChange = (color: string) => {
    setTextColor(color);
    editorRef.current?.setTextColor(color);
    refocus();
  };

  const handleToggleBold = () => editorRef.current?.toggleBold();
  const handleToggleItalic = () => editorRef.current?.toggleItalic();
  const handleToggleUnderline = () => editorRef.current?.toggleUnderline();
  const handleSetHighlightColor = (color: string | null) => {
    setHighlightColor(color);
    editorRef.current?.setHighlightColor(color);
    refocus();
  };
  const handleToggleBullet = () => editorRef.current?.toggleBullet();
  const handleToggleNumberList = () => editorRef.current?.toggleNumberList();
  const handleIndentLeft = () => editorRef.current?.indentLeft();
  const handleIndentRight = () => editorRef.current?.indentRight();
  const handleLineSpacingChange = (value: number) => {
    setLineSpacing(value);
    editorRef.current?.setLineSpacing(value);
    refocus();
  };
  const handleToggleSpaceBeforeLine = () => editorRef.current?.toggleSpaceBeforeLine();
  const handleToggleSpaceAfterLine = () => editorRef.current?.toggleSpaceAfterLine();
  const handleInsertLink = () => {
    const url = window.prompt('Enter link URL');
    if (!url?.trim()) return;
    editorRef.current?.insertLink(url.trim());
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

  const handleUndo = () => editorRef.current?.undo();
  const handleRedo = () => editorRef.current?.redo();
  const handleToggleImagePanel = () => {
    editorRef.current?.toggleImagePanel();
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
    <div className="sticky top-0 z-40 mt-2 mb-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1 shadow-sm backdrop-blur-md">
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
  );
};

export default Toolbar;
