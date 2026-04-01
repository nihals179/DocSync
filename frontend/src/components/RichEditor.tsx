import { useRef, useImperativeHandle, forwardRef, useState, useEffect, useCallback } from 'react';
import MarginRuler from './MarginRuler';

type PageSize = 'responsive' | 'A3' | 'A4' | 'A5';

type RichEditorProps = {
  initialContent?: string;
  onContentChange?: (html: string) => void;
  pageSize: PageSize;
};

export type RichEditorHandle = {
  getContent: () => string;
  setContent: (html: string) => void;
  getFontSize: () => number;
  setFontSize: (n: number) => void;
  toggleBold: () => void;
  getBold: () => boolean;
  toggleItalic: () => void;
  getItalic: () => boolean;
  toggleUnderline: () => void;
  getUnderline: () => boolean;
  getFontFamily: () => string;
  setFontFamily: (f: string) => void;
  getTextColor: () => string;
  setTextColor: (c: string) => void;
};

// portrait dimensions in mm: width x height
const PAGE_DIMENSIONS: Record<Exclude<PageSize, 'responsive'>, { width: string; height: string; widthMm: number }> = {
  A3: { width: '297mm', height: '420mm', widthMm: 297 },
  A4: { width: '210mm', height: '297mm', widthMm: 210 },
  A5: { width: '148mm', height: '210mm', widthMm: 148 },
};

// Standard margins as % of page width
const DEFAULT_MARGINS: Record<PageSize, { left: number; right: number }> = {
  responsive: { left: 4,  right: 90 },
  A3:         { left: 8,  right: 92 },
  A4:         { left: 12, right: 88 },
  A5:         { left: 14, right: 86 },
};

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** Build a CSS font string from formatting state */
function buildFont(size: number, bold: boolean, italic: boolean, family: string): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}, ${FONT_STACK}`;
}

/** Word-wrap text into lines that fit within maxWidth */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[][] {
  const paragraphs = text.split('\n');
  return paragraphs.map((para) => {
    if (para === '') return [''];
    const words = para.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
      // if a single word is wider than maxWidth, break it character by character
      while (ctx.measureText(current).width > maxWidth && current.length > 1) {
        let breakAt = current.length;
        for (let i = 1; i < current.length; i++) {
          if (ctx.measureText(current.slice(0, i + 1)).width > maxWidth) {
            breakAt = i;
            break;
          }
        }
        lines.push(current.slice(0, breakAt));
        current = current.slice(breakAt);
      }
    }
    if (current) lines.push(current);
    if (lines.length === 0) lines.push('');
    return lines;
  });
}

/** Convert flat character offset to { para, col } in unwrapped text */
function offsetToParaCol(text: string, offset: number): { para: number; col: number } {
  const paragraphs = text.split('\n');
  let remaining = offset;
  for (let p = 0; p < paragraphs.length; p++) {
    if (remaining <= paragraphs[p].length) return { para: p, col: remaining };
    remaining -= paragraphs[p].length + 1; // +1 for \n
  }
  const last = paragraphs.length - 1;
  return { para: last, col: paragraphs[last].length };
}

/** Convert { para, col } back to flat offset */
function paraColToOffset(text: string, para: number, col: number): number {
  const paragraphs = text.split('\n');
  let offset = 0;
  for (let p = 0; p < para && p < paragraphs.length; p++) {
    offset += paragraphs[p].length + 1;
  }
  return offset + Math.min(col, paragraphs[para]?.length ?? 0);
}

/** Find which visual line and x-offset for a cursor at { para, col } */
function cursorToVisual(
  ctx: CanvasRenderingContext2D,
  wrappedLines: string[][],
  para: number,
  col: number,
): { line: number; x: number } {
  let lineIndex = 0;
  for (let p = 0; p < para; p++) {
    lineIndex += wrappedLines[p]?.length ?? 1;
  }
  const paraLines = wrappedLines[para] ?? [''];
  let charsSoFar = 0;
  for (let l = 0; l < paraLines.length; l++) {
    const lineLen = paraLines[l].length;
    if (col <= charsSoFar + lineLen || l === paraLines.length - 1) {
      const colInLine = col - charsSoFar;
      const x = ctx.measureText(paraLines[l].slice(0, colInLine)).width;
      return { line: lineIndex + l, x };
    }
    charsSoFar += lineLen + 1; // +1 for the space that was consumed by wrapping
  }
  return { line: lineIndex, x: 0 };
}

/** Convert a click (visual line + xPx) to flat offset */
function visualToOffset(
  ctx: CanvasRenderingContext2D,
  text: string,
  wrappedLines: string[][],
  visLine: number,
  xPx: number,
): number {
  let lineCount = 0;
  let targetPara = 0;
  let targetSubLine = 0;
  for (let p = 0; p < wrappedLines.length; p++) {
    const pLines = wrappedLines[p];
    if (visLine < lineCount + pLines.length) {
      targetPara = p;
      targetSubLine = visLine - lineCount;
      break;
    }
    lineCount += pLines.length;
    if (p === wrappedLines.length - 1) {
      targetPara = p;
      targetSubLine = pLines.length - 1;
    }
  }
  const lineText = wrappedLines[targetPara]?.[targetSubLine] ?? '';
  // find closest character
  let col = 0;
  for (let i = 0; i <= lineText.length; i++) {
    const w = ctx.measureText(lineText.slice(0, i)).width;
    if (w >= xPx) {
      const prevW = i > 0 ? ctx.measureText(lineText.slice(0, i - 1)).width : 0;
      col = (xPx - prevW < w - xPx) ? i - 1 : i;
      break;
    }
    col = i;
  }
  // add chars from previous sub-lines in this paragraph
  let charsBeforeSubLine = 0;
  for (let sl = 0; sl < targetSubLine; sl++) {
    charsBeforeSubLine += (wrappedLines[targetPara][sl]?.length ?? 0) + 1;
  }
  return paraColToOffset(text, targetPara, charsBeforeSubLine + col);
}

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(({ initialContent, onContentChange, pageSize }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  const pageElRef = useRef<HTMLDivElement | null>(null);

  const [leftMargin, setLeftMargin] = useState<number>(DEFAULT_MARGINS[pageSize].left);
  const [rightMargin, setRightMargin] = useState<number>(DEFAULT_MARGINS[pageSize].right);
  const prevPageSize = useRef(pageSize);

  const isPaperMode = pageSize !== 'responsive';

  // text state
  const textRef = useRef(initialContent ?? '');
  const cursorRef = useRef(0);
  const scrollYRef = useRef(0);
  const blinkRef = useRef(true);
  const blinkTimerRef = useRef<number | null>(null);
  const selStartRef = useRef<number | null>(null);

  // formatting state
  const fontSizeRef = useRef(16);
  const boldRef = useRef(false);
  const italicRef = useRef(false);
  const underlineRef = useRef(false);
  const fontFamilyRef = useRef('Raleway');
  const textColorRef = useRef('#1e293b');

  useImperativeHandle(ref, () => ({
    getContent: () => textRef.current,
    setContent: (t: string) => {
      textRef.current = t;
      cursorRef.current = t.length;
      onContentChange?.(t);
      draw();
    },
    getFontSize: () => fontSizeRef.current,
    setFontSize: (n: number) => {
      fontSizeRef.current = Math.max(8, Math.min(72, n));
      draw();
    },
    toggleBold: () => { boldRef.current = !boldRef.current; draw(); },
    getBold: () => boldRef.current,
    toggleItalic: () => { italicRef.current = !italicRef.current; draw(); },
    getItalic: () => italicRef.current,
    toggleUnderline: () => { underlineRef.current = !underlineRef.current; draw(); },
    getUnderline: () => underlineRef.current,
    getFontFamily: () => fontFamilyRef.current,
    setFontFamily: (f: string) => { fontFamilyRef.current = f; draw(); },
    getTextColor: () => textColorRef.current,
    setTextColor: (c: string) => { textColorRef.current = c; draw(); },
  }));

  useEffect(() => {
    if (initialContent !== undefined) {
      textRef.current = initialContent;
      cursorRef.current = initialContent.length;
      onContentChange?.(initialContent);
    }
  }, [initialContent]);

  // reset margins on page size change
  useEffect(() => {
    if (prevPageSize.current === pageSize) return;
    prevPageSize.current = pageSize;
    setLeftMargin(DEFAULT_MARGINS[pageSize].left);
    setRightMargin(DEFAULT_MARGINS[pageSize].right);
  }, [pageSize]);

  // ── Drawing ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // dynamic font metrics
    const fontSize = fontSizeRef.current;
    const lineHeight = Math.ceil(fontSize * 1.5);
    const font = buildFont(fontSize, boldRef.current, italicRef.current, fontFamilyRef.current);

    // margins in px
    const padLeft = (leftMargin / 100) * w + (isPaperMode ? 0 : w * 0.01);
    const padRight = ((100 - rightMargin) / 100) * w + (isPaperMode ? 0 : w * 0.01);
    const padTop = isPaperMode ? 45 : 32; // px
    const textAreaWidth = w - padLeft - padRight;

    ctx.font = font;
    ctx.textBaseline = 'top';

    // clip text rendering to the area between left and right margins
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, 0, textAreaWidth, h);
    ctx.clip();

    const wrappedLines = wrapText(ctx, textRef.current, Math.max(textAreaWidth, 50));
    // auto-scroll to keep cursor visible
    const { para, col } = offsetToParaCol(textRef.current, cursorRef.current);
    const cursorVis = cursorToVisual(ctx, wrappedLines, para, col);
    const cursorY = padTop + cursorVis.line * lineHeight - scrollYRef.current;
    if (cursorY < padTop) scrollYRef.current = Math.max(0, padTop + cursorVis.line * lineHeight - padTop);
    if (cursorY + lineHeight > h) scrollYRef.current = padTop + cursorVis.line * lineHeight - h + lineHeight + 4;

    // draw text lines
    let y = padTop - scrollYRef.current;
    ctx.fillStyle = textColorRef.current;
    for (const paraLines of wrappedLines) {
      for (const line of paraLines) {
        if (y + lineHeight > 0 && y < h) {
          ctx.fillText(line, padLeft, y + (lineHeight - fontSize) / 2);
          // underline
          if (underlineRef.current) {
            const textWidth = ctx.measureText(line).width;
            const underY = y + (lineHeight - fontSize) / 2 + fontSize + 1;
            ctx.fillRect(padLeft, underY, textWidth, 1);
          }
        }
        y += lineHeight;
      }
    }

    // draw selection highlight
    if (selStartRef.current !== null && selStartRef.current !== cursorRef.current) {
      const selFrom = Math.min(selStartRef.current, cursorRef.current);
      const selTo = Math.max(selStartRef.current, cursorRef.current);
      const fromPC = offsetToParaCol(textRef.current, selFrom);
      const toPC = offsetToParaCol(textRef.current, selTo);
      const fromVis = cursorToVisual(ctx, wrappedLines, fromPC.para, fromPC.col);
      const toVis = cursorToVisual(ctx, wrappedLines, toPC.para, toPC.col);

      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      for (let vl = fromVis.line; vl <= toVis.line; vl++) {
        const ly = padTop + vl * lineHeight - scrollYRef.current;
        const startX = vl === fromVis.line ? padLeft + fromVis.x : padLeft;
        const endX = vl === toVis.line ? padLeft + toVis.x : padLeft + textAreaWidth;
        ctx.fillRect(startX, ly, endX - startX, lineHeight);
      }
    }

    // draw cursor
    if (blinkRef.current) {
      const cursorX = padLeft + cursorVis.x;
      const cy = padTop + cursorVis.line * lineHeight - scrollYRef.current;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cursorX - 0.5, cy + 2, 1.5, lineHeight - 4);
    }

    // restore canvas state (removes clip region)
    ctx.restore();
  }, [leftMargin, rightMargin, isPaperMode]);

  // blink timer
  useEffect(() => {
    const blink = () => {
      blinkRef.current = !blinkRef.current;
      draw();
    };
    blinkTimerRef.current = window.setInterval(blink, 530);
    return () => { if (blinkTimerRef.current) clearInterval(blinkTimerRef.current); };
  }, [draw]);

  // redraw on margin changes
  useEffect(() => { draw(); }, [leftMargin, rightMargin, draw]);

  // resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const resetBlink = () => {
    blinkRef.current = true;
    if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    blinkTimerRef.current = window.setInterval(() => { blinkRef.current = !blinkRef.current; draw(); }, 530);
  };

  // ── Keyboard handling via hidden textarea ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const text = textRef.current;
    let cursor = cursorRef.current;
    let newText = text;
    let handled = true;

    const hasSelection = selStartRef.current !== null && selStartRef.current !== cursor;
    const selFrom = hasSelection ? Math.min(selStartRef.current!, cursor) : cursor;
    const selTo = hasSelection ? Math.max(selStartRef.current!, cursor) : cursor;

    if (e.key === 'Backspace') {
      if (hasSelection) {
        newText = text.slice(0, selFrom) + text.slice(selTo);
        cursor = selFrom;
      } else if (cursor > 0) {
        newText = text.slice(0, cursor - 1) + text.slice(cursor);
        cursor--;
      }
      selStartRef.current = null;
    } else if (e.key === 'Delete') {
      if (hasSelection) {
        newText = text.slice(0, selFrom) + text.slice(selTo);
        cursor = selFrom;
      } else if (cursor < text.length) {
        newText = text.slice(0, cursor) + text.slice(cursor + 1);
      }
      selStartRef.current = null;
    } else if (e.key === 'Enter') {
      if (hasSelection) {
        newText = text.slice(0, selFrom) + '\n' + text.slice(selTo);
        cursor = selFrom + 1;
      } else {
        newText = text.slice(0, cursor) + '\n' + text.slice(cursor);
        cursor++;
      }
      selStartRef.current = null;
    } else if (e.key === 'ArrowLeft') {
      if (e.shiftKey) {
        if (selStartRef.current === null) selStartRef.current = cursor;
      } else {
        selStartRef.current = null;
      }
      if (cursor > 0) cursor--;
    } else if (e.key === 'ArrowRight') {
      if (e.shiftKey) {
        if (selStartRef.current === null) selStartRef.current = cursor;
      } else {
        selStartRef.current = null;
      }
      if (cursor < text.length) cursor++;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // move cursor up/down by one visual line
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = buildFont(fontSizeRef.current, boldRef.current, italicRef.current, fontFamilyRef.current);
          const rect = canvas.getBoundingClientRect();
          const w = rect.width;
          const padLeft = (leftMargin / 100) * w + (isPaperMode ? 0 : w * 0.01);
          const padRight = ((100 - rightMargin) / 100) * w + (isPaperMode ? 0 : w * 0.01);
          const textAreaWidth = w - padLeft - padRight;
          const wrappedLines = wrapText(ctx, text, Math.max(textAreaWidth, 50));
          const { para, col } = offsetToParaCol(text, cursor);
          const vis = cursorToVisual(ctx, wrappedLines, para, col);
          const targetLine = e.key === 'ArrowUp' ? Math.max(0, vis.line - 1) : vis.line + 1;
          const totalLines = wrappedLines.reduce((sum, p) => sum + p.length, 0);
          if (targetLine >= 0 && targetLine < totalLines) {
            cursor = visualToOffset(ctx, text, wrappedLines, targetLine, vis.x);
          }
        }
      }
      if (e.shiftKey) {
        if (selStartRef.current === null) selStartRef.current = cursorRef.current;
      } else {
        selStartRef.current = null;
      }
    } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      selStartRef.current = 0;
      cursor = text.length;
    } else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
      boldRef.current = !boldRef.current;
    } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
      italicRef.current = !italicRef.current;
    } else if (e.key === 'u' && (e.metaKey || e.ctrlKey)) {
      underlineRef.current = !underlineRef.current;
    } else if (e.key === 'Home') {
      cursor = text.lastIndexOf('\n', cursor - 1) + 1;
      selStartRef.current = null;
    } else if (e.key === 'End') {
      const next = text.indexOf('\n', cursor);
      cursor = next === -1 ? text.length : next;
      selStartRef.current = null;
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      if (hasSelection) {
        newText = text.slice(0, selFrom) + e.key + text.slice(selTo);
        cursor = selFrom + 1;
      } else {
        newText = text.slice(0, cursor) + e.key + text.slice(cursor);
        cursor++;
      }
      selStartRef.current = null;
    } else {
      handled = false;
    }

    if (handled) {
      e.preventDefault();
      textRef.current = newText;
      cursorRef.current = cursor;
      onContentChange?.(newText);
      resetBlink();
      draw();
    }
  }, [draw, isPaperMode, leftMargin, rightMargin, onContentChange]);

  // ── Mouse click to position cursor ──
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = buildFont(fontSizeRef.current, boldRef.current, italicRef.current, fontFamilyRef.current);

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const padLeft = (leftMargin / 100) * w + (isPaperMode ? 0 : w * 0.01);
    const padRight = ((100 - rightMargin) / 100) * w + (isPaperMode ? 0 : w * 0.01);
    const padTop = isPaperMode ? 45 : 32;
    const textAreaWidth = w - padLeft - padRight;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const wrappedLines = wrapText(ctx, textRef.current, Math.max(textAreaWidth, 50));
    const lineHeight = Math.ceil(fontSizeRef.current * 1.5);
    const visLine = Math.max(0, Math.floor((clickY - padTop + scrollYRef.current) / lineHeight));
    const xInText = clickX - padLeft;

    cursorRef.current = visualToOffset(ctx, textRef.current, wrappedLines, visLine, Math.max(0, xInText));
    selStartRef.current = null;
    resetBlink();
    draw();

    // focus the hidden input
    hiddenInputRef.current?.focus();
  }, [draw, isPaperMode, leftMargin, rightMargin]);

  // scroll via wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    scrollYRef.current = Math.max(0, scrollYRef.current + e.deltaY);
    draw();
  }, [draw]);

  // focus hidden input on container click
  const focusInput = () => hiddenInputRef.current?.focus();

  // auto-focus
  useEffect(() => { hiddenInputRef.current?.focus(); }, []);

  return (
    <>
      <div className={`relative min-h-0 flex-1 ${isPaperMode ? 'overflow-auto' : 'overflow-hidden'} rounded-xl border border-slate-200/80 bg-white shadow-sm`}>
        {/* margin ruler */}
        <div className="sticky top-0 z-30 w-full px-3 py-1">
          <MarginRuler
            left={leftMargin}
            right={rightMargin}
            min={0}
            max={100}
            step={1}
            pageRef={isPaperMode ? pageElRef : undefined}
            paperWidthMm={isPaperMode ? PAGE_DIMENSIONS[pageSize as Exclude<PageSize,'responsive'>].widthMm : undefined}
            onChangeLeft={(v) => setLeftMargin(v)}
            onChangeRight={(v) => setRightMargin(v)}
          />
        </div>

        {/* Hidden textarea for keyboard capture */}
        <textarea
          ref={hiddenInputRef}
          className="absolute opacity-0 w-0 h-0 overflow-hidden"
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
          onKeyDown={handleKeyDown}
          autoFocus
          aria-label="Document editor input"
        />

        {isPaperMode ? (
          <div className="flex min-h-full items-start justify-center p-6">
            <div
              ref={pageElRef}
              className="relative shrink-0 bg-white"
              style={{
                width: PAGE_DIMENSIONS[pageSize as Exclude<PageSize, 'responsive'>].width,
                height: PAGE_DIMENSIONS[pageSize as Exclude<PageSize, 'responsive'>].height,
                boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
                borderRadius: 6,
              }}
            >
              <canvas
                ref={canvasRef}
                className="w-full h-full cursor-text"
                onClick={handleCanvasClick}
                onWheel={handleWheel}
                onMouseDown={focusInput}
                aria-label="Document editor"
                style={{ display: 'block' }}
              />
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full cursor-text"
            style={{ height: 'calc(100% - 48px)', display: 'block' }}
            onClick={handleCanvasClick}
            onWheel={handleWheel}
            onMouseDown={focusInput}
            aria-label="Document editor"
          />
        )}
      </div>
    </>
  );
});

export default RichEditor;
