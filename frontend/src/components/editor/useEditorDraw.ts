/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef } from 'react';
import {
  buildFont,
  computeLineHeight,
  DEFAULT_RUN_FMT,
  getFormatAt,
  getTableTokenRanges,
  runsToText,
  type Run,
  type RunFmt,
  getImageTokenRanges,
  parseImageToken,
  parseTableToken,
} from './textModel';
import {
  buildVisualLines,
  getImageRenderMetrics,
  getTableRenderMetrics,
  type VisualLine,
} from './layout';
import { getLayoutMetrics, imageMetaKey } from './drawHelpers';
import {
  isBreakLineWrap,
  isFlowingImageWrap,
  isInlineWrap,
  isTextInFrontWrap,
  resolveImageClickOffsetByWrap,
  isWrapTextWrap,
} from './image/imageWrapMode';
import {
  STANDARD_PAPER_BOTTOM_MARGIN_MM,
  STANDARD_PAPER_TOP_MARGIN_MM,
} from './pageConfig';

export type ImageBox = {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  drawWidth: number;
  drawHeight: number;
  centerX: number;
  centerY: number;
  meta: NonNullable<VisualLine['imageMeta']>;
  tableImage?: {
    tableStart: number;
    row: number;
    column: number;
    tokenRangeIndex: number;
  };
};

export type TableBox = {
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  columns: number;
  rowHeight: number;
  cellWidth: number;
  rowHeights: number[];
  columnWidths: number[];
  rowOffsets: number[];
  columnOffsets: number[];
};

export type TableHit = {
  box: TableBox;
  row: number;
  column: number;
};

export type TableSelectionRange = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
};

export type TableLineHover = {
  box: TableBox;
  axis: 'row' | 'column';
  index: number;
  segment: number;
};

export type TableLineSelectionRange = {
  box: TableBox;
  axis: 'row' | 'column';
  indexStart: number;
  indexEnd: number;
  segmentStart: number;
  segmentEnd: number;
};

export interface DrawRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  tableInputRef: React.RefObject<HTMLTextAreaElement | null>;
  runsRef: React.MutableRefObject<Run[]>;
  cursorRef: React.MutableRefObject<number>;
  selStartRef: React.MutableRefObject<number | null>;
  scrollYRef: React.MutableRefObject<number>;
  blinkRef: React.MutableRefObject<boolean>;
  blinkTimerRef: React.MutableRefObject<number | null>;
  curFmtRef: React.MutableRefObject<RunFmt>;
  selectedTableHitRef: React.MutableRefObject<TableHit | null>;
  tableSelectionRangeRef: React.MutableRefObject<TableSelectionRange | null>;
  hoveredTableLineRef: React.MutableRefObject<TableLineHover | null>;
  selectedTableLineRef: React.MutableRefObject<TableLineHover | null>;
  selectedTableLineRangeRef: React.MutableRefObject<TableLineSelectionRange | null>;
  isTableCellEditingRef: React.MutableRefObject<boolean>;
  activeTableEditingCellRef: React.MutableRefObject<{
    tableStart: number;
    row: number;
    column: number;
  } | null>;
  tableCellCursorRef: React.MutableRefObject<{
    tableStart: number;
    row: number;
    column: number;
    offset: number;
  } | null>;
  tableTextSelectionRef: React.MutableRefObject<{
    tableStart: number;
    row: number;
    column: number;
    start: number;
    end: number;
  } | null>;
  autoScrollCursorIntoViewRef: React.MutableRefObject<boolean>;
}

/** Returns the `draw` callback and a `resetBlink` helper */
export function useEditorDraw(
  refs: DrawRefs,
  leftMargin: number,
  rightMargin: number,
  isPaperMode: boolean,
  paperHeightRatio: number | null,
  paperWidthMm: number | null,
  onPaperPaginationChange?: (pageCount: number, pageHeightPx: number) => void,
) {
  type CachedImage = { drawable: CanvasImageSource; w: number; h: number };
  const imageCacheRef = useRef<Map<string, CachedImage>>(new Map());
  const imagePendingRef = useRef<Set<string>>(new Set());
  const imageBoxesRef = useRef<ImageBox[]>([]);
  const tableBoxesRef = useRef<TableBox[]>([]);
  const lastCursorPageIndexRef = useRef(0);
  const drawRef = useRef<() => void>(() => {});

  const {
    canvasRef,
    tableInputRef,
    runsRef,
    cursorRef,
    selStartRef,
    scrollYRef,
    blinkRef,
    blinkTimerRef,
    curFmtRef,
    selectedTableHitRef,
    tableSelectionRangeRef,
    hoveredTableLineRef,
    selectedTableLineRef,
    selectedTableLineRangeRef,
    isTableCellEditingRef,
    activeTableEditingCellRef,
    tableCellCursorRef,
    tableTextSelectionRef,
    autoScrollCursorIntoViewRef,
  } = refs;

  const getAlignedXInTextArea = useCallback(
    (align: 'left' | 'center' | 'right', boxWidth: number, areaWidth: number) => {
      const maxX = Math.max(0, areaWidth - boxWidth);
      const raw =
        align === 'left'
          ? 0
          : align === 'right'
            ? areaWidth - boxWidth
            : (areaWidth - boxWidth) / 2;
      return Math.max(0, Math.min(raw, maxX));
    },
    [],
  );

  const hasBreakOrWrapImageInLine = useCallback((line: VisualLine) => {
    return line.segs.some((sg) => {
      const meta = parseImageToken(sg.text);
      return Boolean(meta && (isBreakLineWrap(meta.wrap) || isWrapTextWrap(meta.wrap)));
    });
  }, []);

  const hasInlineImageInLine = useCallback((line: VisualLine) => {
    return line.segs.some((sg) => {
      const meta = parseImageToken(sg.text);
      return Boolean(meta && isInlineWrap(meta.wrap));
    });
  }, []);

  const buildImageDimsMap = useCallback(() => {
    const imageDims = new Map<string, { w: number; h: number }>();
    for (const [src, cached] of imageCacheRef.current) {
      imageDims.set(src, { w: cached.w, h: cached.h });
    }
    return imageDims;
  }, []);

  const getClosestVisualLine = useCallback((lines: VisualLine[], clickY: number): VisualLine => {
    // First: check if the click falls within any line's actual Y range.
    // This prevents clicks near the bottom of a line snapping to the next line's
    // midpoint, which caused the cursor to jump to the wrong line.
    for (const line of lines) {
      if (clickY >= line.y && clickY < line.y + line.lineH) {
        return line;
      }
    }
    // Fallback: find the line whose midpoint is closest to the click.
    let closest = lines[0];
    let bestDist = Infinity;
    for (const line of lines) {
      const mid = line.y + line.lineH / 2;
      const d = Math.abs(clickY - mid);
      if (d < bestDist) {
        bestDist = d;
        closest = line;
      }
    }
    return closest;
  }, []);

  const getTrackIndexFromOffsets = useCallback((offsets: number[], value: number) => {
    for (let index = 0; index < offsets.length - 1; index++) {
      if (value >= offsets[index] && value < offsets[index + 1]) return index;
    }
    return Math.max(0, offsets.length - 2);
  }, []);

  const getNearestBorderIndex = useCallback((offsets: number[], value: number) => {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < offsets.length; index++) {
      const distance = Math.abs(value - offsets[index]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    return { index: nearestIndex, distance: nearestDistance };
  }, []);

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

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const paperTopPaddingPx =
      isPaperMode && paperWidthMm && paperWidthMm > 0
        ? (w * STANDARD_PAPER_TOP_MARGIN_MM) / paperWidthMm
        : undefined;
    const paperBottomPaddingPx =
      isPaperMode && paperWidthMm && paperWidthMm > 0
        ? (w * STANDARD_PAPER_BOTTOM_MARGIN_MM) / paperWidthMm
        : undefined;

    const { padLeft, textAreaWidth, padTop, baseLineH } = getLayoutMetrics(
      w,
      leftMargin,
      rightMargin,
      isPaperMode,
      curFmtRef.current.fontSize,
      paperTopPaddingPx,
    );
    const paperPageHeightPx =
      isPaperMode && paperHeightRatio && paperHeightRatio > 0 ? w * paperHeightRatio : null;
    const paperPageGapPx = isPaperMode ? 44 : 0;

    ctx.textBaseline = 'top';

    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, 0, textAreaWidth, h);
    ctx.clip();

    const flatText = runsToText(runsRef.current);
    const neededImageSrcs = new Set<string>();
    for (const { start, end } of getImageTokenRanges(flatText)) {
      const token = flatText.slice(start, end);
      const meta = parseImageToken(token);
      if (meta && meta.src) neededImageSrcs.add(meta.src);
    }
    for (const { start, end } of getTableTokenRanges(flatText)) {
      const token = flatText.slice(start, end);
      const tableMeta = parseTableToken(token);
      if (!tableMeta) continue;
      for (let r = 0; r < tableMeta.rows; r++) {
        for (let c = 0; c < tableMeta.columns; c++) {
          const cellValue = runsToText(tableMeta.cells?.[r]?.[c] ?? []);
          if (!cellValue) continue;
          for (const imageRange of getImageTokenRanges(cellValue)) {
            const tokenValue = cellValue.slice(imageRange.start, imageRange.end);
            const imageMeta = parseImageToken(tokenValue);
            if (imageMeta?.src) neededImageSrcs.add(imageMeta.src);
          }
        }
      }
    }

    for (const src of neededImageSrcs) {
      if (!imageCacheRef.current.has(src) && !imagePendingRef.current.has(src)) {
        imagePendingRef.current.add(src);
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          imageCacheRef.current.set(src, {
            drawable: img,
            w: img.naturalWidth,
            h: img.naturalHeight,
          });
          imagePendingRef.current.delete(src);
          drawRef.current();
        };
        img.onerror = () => {
          imagePendingRef.current.delete(src);
        };
        img.src = src;
      }
    }

    const imageDimsForLayout = buildImageDimsMap();
    const { vls } = buildVisualLines(
      ctx,
      runsRef.current,
      flatText,
      curFmtRef.current,
      padLeft,
      textAreaWidth,
      padTop,
      baseLineH,
      scrollYRef.current,
      imageDimsForLayout,
      paperPageHeightPx
        ? {
            pageHeightPx: paperPageHeightPx,
            pageGapPx: paperPageGapPx,
            bottomPaddingPx: paperBottomPaddingPx ?? padTop,
          }
        : undefined,
    );
    const hasSelection = selStartRef.current !== null && selStartRef.current !== cursorRef.current;
    const selFrom = hasSelection ? Math.min(selStartRef.current!, cursorRef.current) : 0;
    const selTo = hasSelection ? Math.max(selStartRef.current!, cursorRef.current) : 0;
    imageBoxesRef.current = [];
    tableBoxesRef.current = [];

    if (vls.length > 0) {
      const last = vls[vls.length - 1];
      const contentBottomY = last.y + last.lineH;
      const trailingSafeSpacePx = Math.max(56, Math.round(baseLineH * 4));
      const maxScroll = Math.max(
        0,
        contentBottomY + scrollYRef.current - h + trailingSafeSpacePx,
      );
      if (scrollYRef.current > maxScroll) {
        scrollYRef.current = maxScroll;
        ctx.restore();
        drawRef.current();
        return;
      }

      const shouldAutoScrollCursorIntoView = autoScrollCursorIntoViewRef.current;
      autoScrollCursorIntoViewRef.current = false;

      if (shouldAutoScrollCursorIntoView) {
        // Keep caret line inside viewport only for explicit typing/newline actions.
        const cursor = cursorRef.current;
        const cursorLine =
          vls.find((line) => cursor >= line.startOffset && cursor <= line.endOffset) ??
          vls[vls.length - 1];

        if (isPaperMode && paperPageHeightPx) {
          const pageStride = paperPageHeightPx + paperPageGapPx;
          const cursorTopAbs = cursorLine.y + scrollYRef.current;
          const cursorPageIndex = Math.max(
            0,
            Math.floor((cursorTopAbs - padTop) / Math.max(1, pageStride)),
          );
          const prevCursorPageIndex = lastCursorPageIndexRef.current;
          lastCursorPageIndexRef.current = cursorPageIndex;

          if (cursorPageIndex > prevCursorPageIndex) {
            const pageTopAbs = padTop + cursorPageIndex * pageStride;
            const targetScroll = Math.max(0, pageTopAbs - Math.max(12, Math.round(baseLineH * 0.6)));
            if (Math.abs(targetScroll - scrollYRef.current) > 0.5) {
              scrollYRef.current = targetScroll;
              ctx.restore();
              drawRef.current();
              return;
            }
          }
        }

        const viewportTopPad = Math.max(14, Math.round(baseLineH * 0.8));
        const viewportBottomPad = Math.max(18, Math.round(baseLineH * 1.1));
        const cursorTop = cursorLine.y;
        const cursorBottom = cursorLine.y + cursorLine.lineH;

        let scrollDelta = 0;
        if (cursorBottom > h - viewportBottomPad) {
          scrollDelta = cursorBottom - (h - viewportBottomPad);
        } else if (cursorTop < viewportTopPad) {
          scrollDelta = cursorTop - viewportTopPad;
        }

        if (Math.abs(scrollDelta) > 0.5) {
          const nextScroll = Math.max(0, Math.min(maxScroll, scrollYRef.current + scrollDelta));
          if (Math.abs(nextScroll - scrollYRef.current) > 0.5) {
            scrollYRef.current = nextScroll;
            ctx.restore();
            drawRef.current();
            return;
          }
        }
      }
    }

    if (paperPageHeightPx && onPaperPaginationChange) {
      const last = vls[vls.length - 1];
      const lastBottomAbs = (last?.y ?? padTop) + (last?.lineH ?? baseLineH) + scrollYRef.current;
      const pageStride = paperPageHeightPx + paperPageGapPx;
      const relativeBottom = Math.max(0, lastBottomAbs - padTop);
      const pageCount = Math.max(1, Math.floor(relativeBottom / pageStride) + 1);
      onPaperPaginationChange(pageCount, paperPageHeightPx);
    }

    for (const vl of vls) {
      if (vl.y + vl.lineH < 0 || vl.y > h) continue;
      const lineHasBreakImage = hasBreakOrWrapImageInLine(vl);
      const lineHasInlineImage = hasInlineImageInLine(vl);
      // Inline image and text rendering
      let lineOffset = vl.startOffset;
      for (const seg of vl.segs) {
        const segStart = lineOffset;
        const segEnd = segStart + seg.text.length;
        const imageMeta = parseImageToken(seg.text);
        const tableMeta = parseTableToken(seg.text);
        if (tableMeta) {
          const metrics = getTableRenderMetrics(tableMeta, textAreaWidth, imageDimsForLayout);
          const boxX = padLeft + seg.x;
          const boxY = vl.y + (vl.lineH - metrics.boxHeight) / 2;
          const selectedTableHit = selectedTableHitRef.current;
          const tableSelection = tableSelectionRangeRef.current;
          const hoveredLine = hoveredTableLineRef.current;
          const selectedLine = selectedTableLineRef.current;
          const selectedLineRange = selectedTableLineRangeRef.current;
          const isActiveTable = selectedTableHit?.box.start === segStart;
          const hasTableSelectionInActiveTable =
            isActiveTable && tableSelection && selectedTableHit?.box.start === segStart;
          const normalizedSelection = hasTableSelectionInActiveTable
            ? {
                rowStart: Math.max(
                  0,
                  Math.min(tableMeta.rows - 1, Math.min(tableSelection!.rowStart, tableSelection!.rowEnd)),
                ),
                rowEnd: Math.max(
                  0,
                  Math.min(tableMeta.rows - 1, Math.max(tableSelection!.rowStart, tableSelection!.rowEnd)),
                ),
                columnStart: Math.max(
                  0,
                  Math.min(
                    tableMeta.columns - 1,
                    Math.min(tableSelection!.columnStart, tableSelection!.columnEnd),
                  ),
                ),
                columnEnd: Math.max(
                  0,
                  Math.min(
                    tableMeta.columns - 1,
                    Math.max(tableSelection!.columnStart, tableSelection!.columnEnd),
                  ),
                ),
              }
            : null;
          const isWholeTableSelected =
            Boolean(normalizedSelection) &&
            normalizedSelection!.rowStart === 0 &&
            normalizedSelection!.columnStart === 0 &&
            normalizedSelection!.rowEnd === tableMeta.rows - 1 &&
            normalizedSelection!.columnEnd === tableMeta.columns - 1;

          const frontWrapCells = new Set<string>();
          for (let rr = 0; rr < tableMeta.rows; rr++) {
            for (let cc = 0; cc < tableMeta.columns; cc++) {
              const cellRuns = tableMeta.cells?.[rr]?.[cc] ?? [];
              const cellRaw = runsToText(cellRuns);
              if (!cellRaw) continue;
              const hasFrontWrapImage = getImageTokenRanges(cellRaw).some((range) => {
                const meta = parseImageToken(cellRaw.slice(range.start, range.end));
                return Boolean(meta && isTextInFrontWrap(meta.wrap));
              });
              if (hasFrontWrapImage) {
                frontWrapCells.add(`${rr}:${cc}`);
              }
            }
          }

          for (let rr = 0; rr < tableMeta.rows; rr++) {
            for (let cc = 0; cc < tableMeta.columns; cc++) {
              if (frontWrapCells.has(`${rr}:${cc}`)) continue;
              const cellX = boxX + metrics.columnOffsets[cc];
              const cellY = boxY + metrics.rowOffsets[rr];
              const cellW = metrics.columnOffsets[cc + 1] - metrics.columnOffsets[cc];
              const cellH = metrics.rowOffsets[rr + 1] - metrics.rowOffsets[rr];
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(cellX, cellY, cellW, cellH);
            }
          }

          if (isActiveTable && selectedTableHit && tableSelection) {
            const rowStart = tableSelection.rowStart;
            const rowEnd = tableSelection.rowEnd;
            const columnStart = tableSelection.columnStart;
            const columnEnd = tableSelection.columnEnd;

            const safeRowStart = Math.max(0, Math.min(tableMeta.rows - 1, rowStart));
            const safeRowEnd = Math.max(0, Math.min(tableMeta.rows - 1, rowEnd));
            const safeColumnStart = Math.max(0, Math.min(tableMeta.columns - 1, columnStart));
            const safeColumnEnd = Math.max(0, Math.min(tableMeta.columns - 1, columnEnd));

            const selX = boxX + metrics.columnOffsets[safeColumnStart];
            const selY = boxY + metrics.rowOffsets[safeRowStart];
            const selW = metrics.columnOffsets[safeColumnEnd + 1] - metrics.columnOffsets[safeColumnStart];
            const selH = metrics.rowOffsets[safeRowEnd + 1] - metrics.rowOffsets[safeRowStart];

            ctx.save();
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 2;
            ctx.strokeRect(
              selX + 1,
              selY + 1,
              Math.max(2, selW - 2),
              Math.max(2, selH - 2),
            );
            ctx.restore();
          }

          for (let r = 0; r <= tableMeta.rows; r++) {
            const y = boxY + metrics.rowOffsets[r];
            for (let c = 0; c < tableMeta.columns; c++) {
              const key = `h:${r}:${c}`;
              const border = tableMeta.borderSegments[key] ??
                tableMeta.rowBorders[String(r)] ?? {
                  width: tableMeta.borderWidth,
                  color: tableMeta.borderColor,
                };
              if (!border.color || border.width <= 0) continue;
              const x0 = boxX + metrics.columnOffsets[c];
              const x1 = boxX + metrics.columnOffsets[c + 1];
              ctx.save();
              ctx.strokeStyle = border.color;
              ctx.lineWidth = Math.max(0.5, border.width);
              ctx.beginPath();
              ctx.moveTo(x0, y);
              ctx.lineTo(x1, y);
              ctx.stroke();
              const isHovered =
                hoveredLine &&
                hoveredLine.box.start === segStart &&
                hoveredLine.axis === 'row' &&
                hoveredLine.index === r &&
                hoveredLine.segment === c;
              const isSelected =
                (selectedLineRange &&
                  selectedLineRange.box.start === segStart &&
                  selectedLineRange.axis === 'row' &&
                  r >= selectedLineRange.indexStart &&
                  r <= selectedLineRange.indexEnd &&
                  c >= selectedLineRange.segmentStart &&
                  c <= selectedLineRange.segmentEnd) ||
                (selectedLine &&
                  selectedLine.box.start === segStart &&
                  selectedLine.axis === 'row' &&
                  selectedLine.index === r &&
                  selectedLine.segment === c);
              if (isHovered || isSelected) {
                ctx.strokeStyle = isSelected ? '#0891b2' : '#22d3ee';
                ctx.lineWidth = Math.max(2.5, border.width + 1.5);
                ctx.beginPath();
                ctx.moveTo(x0, y);
                ctx.lineTo(x1, y);
                ctx.stroke();
              }
              ctx.restore();
            }
          }

          for (let c = 0; c <= tableMeta.columns; c++) {
            const x = boxX + metrics.columnOffsets[c];
            for (let r = 0; r < tableMeta.rows; r++) {
              const key = `v:${c}:${r}`;
              const border = tableMeta.borderSegments[key] ??
                tableMeta.columnBorders[String(c)] ?? {
                  width: tableMeta.borderWidth,
                  color: tableMeta.borderColor,
                };
              if (!border.color || border.width <= 0) continue;
              const y0 = boxY + metrics.rowOffsets[r];
              const y1 = boxY + metrics.rowOffsets[r + 1];
              ctx.save();
              ctx.strokeStyle = border.color;
              ctx.lineWidth = Math.max(0.5, border.width);
              ctx.beginPath();
              ctx.moveTo(x, y0);
              ctx.lineTo(x, y1);
              ctx.stroke();
              const isHovered =
                hoveredLine &&
                hoveredLine.box.start === segStart &&
                hoveredLine.axis === 'column' &&
                hoveredLine.index === c &&
                hoveredLine.segment === r;
              const isSelected =
                (selectedLineRange &&
                  selectedLineRange.box.start === segStart &&
                  selectedLineRange.axis === 'column' &&
                  c >= selectedLineRange.indexStart &&
                  c <= selectedLineRange.indexEnd &&
                  r >= selectedLineRange.segmentStart &&
                  r <= selectedLineRange.segmentEnd) ||
                (selectedLine &&
                  selectedLine.box.start === segStart &&
                  selectedLine.axis === 'column' &&
                  selectedLine.index === c &&
                  selectedLine.segment === r);
              if (isHovered || isSelected) {
                ctx.strokeStyle = isSelected ? '#0891b2' : '#22d3ee';
                ctx.lineWidth = Math.max(2.5, border.width + 1.5);
                ctx.beginPath();
                ctx.moveTo(x, y0);
                ctx.lineTo(x, y1);
                ctx.stroke();
              }
              ctx.restore();
            }
          }

          // For full-table selection, avoid expensive per-segment highlight redraws.
          // Draw a single batched overlay for all grid lines.
          if (isWholeTableSelected) {
            ctx.save();
            ctx.strokeStyle = '#0891b2';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            for (let r = 0; r <= tableMeta.rows; r++) {
              const y = boxY + metrics.rowOffsets[r];
              ctx.moveTo(boxX + metrics.columnOffsets[0], y);
              ctx.lineTo(boxX + metrics.columnOffsets[tableMeta.columns], y);
            }
            for (let c = 0; c <= tableMeta.columns; c++) {
              const x = boxX + metrics.columnOffsets[c];
              ctx.moveTo(x, boxY + metrics.rowOffsets[0]);
              ctx.lineTo(x, boxY + metrics.rowOffsets[tableMeta.rows]);
            }
            ctx.stroke();
            ctx.restore();
          }

          for (let r = 0; r < tableMeta.rows; r++) {
            for (let c = 0; c < tableMeta.columns; c++) {
              const cellRuns = tableMeta.cells?.[r]?.[c] ?? [];
              const raw = runsToText(cellRuns);
              if (!raw && cellRuns.length === 0) continue;
              const imageRanges = getImageTokenRanges(raw);
              // Use first run's format for layout metrics (line height, wrap width, alignment)
              const primaryFmt: RunFmt = cellRuns[0]
                ? { ...DEFAULT_RUN_FMT, ...cellRuns[0] }
                : { ...DEFAULT_RUN_FMT };
              const activeEditingCell = activeTableEditingCellRef.current;
              const isEditingCell =
                isTableCellEditingRef.current &&
                activeEditingCell?.tableStart === segStart &&
                activeEditingCell?.row === r &&
                activeEditingCell?.column === c;
              const cellPadding = Math.max(2, Math.min(32, Math.round(tableMeta.cellPaddingPx ?? 8)));
              const cellPadStartX = Math.max(
                2,
                Math.min(
                  Math.max(2, Math.round((metrics.columnWidths[c] ?? metrics.cellWidth) - 4)),
                  Math.round(tableMeta.columnStartPaddingPx?.[c] ?? cellPadding),
                ),
              );
              const cellPadEndX = cellPadding;
              const cellPadY = cellPadding + 1;
              const x = boxX + metrics.columnOffsets[c] + cellPadStartX;
              const y = boxY + metrics.rowOffsets[r] + cellPadY;
              const cellWidth = metrics.columnWidths[c] ?? metrics.cellWidth;
              const cellHeight = metrics.rowHeights[r] ?? metrics.rowHeight;
              const clipPadLeft = Math.max(2, Math.round(cellPadStartX / 2));
              const clipPadRight = Math.max(2, Math.round(cellPadEndX / 2));
              const clipPadY = Math.max(2, Math.round(cellPadY / 2));
              const innerX = boxX + metrics.columnOffsets[c] + clipPadLeft;
              const innerY = boxY + metrics.rowOffsets[r] + clipPadY;
              const innerW = Math.max(8, cellWidth - clipPadLeft - clipPadRight);
              const innerH = Math.max(8, cellHeight - clipPadY * 2);
              const innerRight = innerX + innerW;

              type CellPart =
                | { type: 'text'; value: string; rawStart: number }
                | {
                    type: 'image';
                    meta: NonNullable<ReturnType<typeof parseImageToken>>;
                    tokenRangeIndex: number;
                  };

              const parts: CellPart[] = [];
              let cursor = 0;
              imageRanges.forEach((range, tokenRangeIndex) => {
                if (range.start > cursor) {
                  parts.push({ type: 'text', value: raw.slice(cursor, range.start), rawStart: cursor });
                }
                const token = raw.slice(range.start, range.end);
                const meta = parseImageToken(token);
                if (meta) parts.push({ type: 'image', meta, tokenRangeIndex });
                cursor = range.end;
              });
              if (cursor < raw.length) {
                parts.push({ type: 'text', value: raw.slice(cursor), rawStart: cursor });
              }
              if (parts.length === 0) {
                parts.push({ type: 'text', value: raw, rawStart: 0 });
              }
              const hasFrontWrapPart = parts.some(
                (part) => part.type === 'image' && isTextInFrontWrap(part.meta.wrap),
              );

              const baseLineHeight = computeLineHeight(primaryFmt.fontSize, primaryFmt.lineSpacing ?? 1.2);
              const tableImageBelowGapY = 12;
              const textStartX = x;
              const textMaxWidth = Math.max(12, cellWidth - cellPadStartX - cellPadEndX);
              const textAlign = primaryFmt.textAlign ?? 'left';
              const suppressTextWhileEditing =
                isEditingCell &&
                imageRanges.length === 0 &&
                typeof document !== 'undefined' &&
                tableInputRef.current !== null &&
                document.activeElement === tableInputRef.current;
              const tableTextSelection = tableTextSelectionRef.current;
              const hasTableTextSelection =
                Boolean(tableTextSelection) &&
                tableTextSelection?.tableStart === segStart &&
                tableTextSelection?.row === r &&
                tableTextSelection?.column === c &&
                tableTextSelection.end > tableTextSelection.start;
              const tableSelStart = hasTableTextSelection ? tableTextSelection!.start : 0;
              const tableSelEnd = hasTableTextSelection ? tableTextSelection!.end : 0;
              let flowY = y;
              let wrapLaneX: number | null = null;
              let wrapLaneBottomY = 0;
              let laneCoversAllChunks = false;
              let centerWrapFlow:
                | { leftEnd: number; rightStart: number; bottomY: number }
                | null = null;
              const maxY = innerY + innerH - 2;

              // Draw a single line, rendering each run segment with its own style.
              // lineRawStart: offset in `raw` where this line starts.
              const drawTextRunsLine = (lineRawStart: number, line: string) => {
                if (flowY > maxY) return;
                const measureRangeWidth = (from: number, to: number) => {
                  let width = 0;
                  let rp = 0;
                  for (const run of cellRuns) {
                    const runEnd = rp + run.text.length;
                    if (runEnd > from && rp < to) {
                      const segText = run.text.slice(
                        Math.max(0, from - rp),
                        Math.min(run.text.length, to - rp),
                      );
                      if (segText) {
                        ctx.font = buildFont(run.fontSize, run.bold, run.italic, run.fontFamily);
                        width += ctx.measureText(segText).width;
                      }
                    }
                    rp = runEnd;
                    if (rp >= to) break;
                  }
                  return width;
                };

                const drawChunkAtY = (chunkStart: number, chunkEnd: number, drawX: number, lineY: number) => {
                  let rp = 0;
                  for (const run of cellRuns) {
                    const runEnd = rp + run.text.length;
                    if (runEnd > chunkStart && rp < chunkEnd) {
                      const segText = run.text.slice(
                        Math.max(0, chunkStart - rp),
                        Math.min(run.text.length, chunkEnd - rp),
                      );
                      if (segText) {
                        ctx.font = buildFont(run.fontSize, run.bold, run.italic, run.fontFamily);
                        const runSliceStart = Math.max(0, chunkStart - rp);
                        const segRawStart = rp + runSliceStart;
                        const segW = ctx.measureText(segText).width;

                        if (hasTableTextSelection) {
                          const overlapStart = Math.max(segRawStart, tableSelStart);
                          const overlapEnd = Math.min(segRawStart + segText.length, tableSelEnd);
                          if (overlapEnd > overlapStart) {
                            const localSelStart = overlapStart - segRawStart;
                            const localSelEnd = overlapEnd - segRawStart;
                            const selStartX = ctx.measureText(segText.slice(0, localSelStart)).width;
                            const selEndX = ctx.measureText(segText.slice(0, localSelEnd)).width;
                            ctx.fillStyle = 'rgba(59, 130, 246, 0.24)';
                            ctx.fillRect(
                              drawX + selStartX,
                              lineY - 1,
                              Math.max(1, selEndX - selStartX),
                              Math.max(2, run.fontSize + 2),
                            );
                          }
                        }

                        if (run.highlightColor) {
                          ctx.fillStyle = run.highlightColor;
                          ctx.fillRect(drawX - 1, lineY + 1, segW + 2, Math.max(12, run.fontSize + 1));
                        }
                        ctx.fillStyle = run.color;
                        ctx.fillText(segText, drawX, lineY);
                        if (run.underline) {
                          const underlineY = lineY + Math.max(12, run.fontSize + 1);
                          ctx.beginPath();
                          ctx.strokeStyle = run.color;
                          ctx.lineWidth = Math.max(1, Math.floor(run.fontSize / 14));
                          ctx.moveTo(drawX, underlineY);
                          ctx.lineTo(drawX + segW, underlineY);
                          ctx.stroke();
                        }
                        drawX += segW;
                      }
                    }
                    rp = runEnd;
                  }
                };

                if (centerWrapFlow && flowY < centerWrapFlow.bottomY - 0.5) {
                  if (!line) {
                    flowY += baseLineHeight;
                    if (flowY >= centerWrapFlow.bottomY - 0.5) centerWrapFlow = null;
                    return;
                  }

                  let local = 0;
                  while (local < line.length) {
                    const leftEnd = Math.max(textStartX, Math.min(innerRight, centerWrapFlow.leftEnd));
                    const rightStart = Math.max(textStartX, Math.min(innerRight, centerWrapFlow.rightStart));
                    const regions: Array<{ start: number; end: number }> = [];
                    if (leftEnd - textStartX >= 12) regions.push({ start: textStartX, end: leftEnd });
                    if (innerRight - rightStart >= 12) regions.push({ start: rightStart, end: innerRight });
                    if (regions.length === 0) {
                      centerWrapFlow = null;
                      break;
                    }

                    const rowChunks: Array<{
                      start: number;
                      end: number;
                      regionStart: number;
                      regionWidth: number;
                      lineFmt: RunFmt;
                      lineHeight: number;
                    }> = [];
                    let rowLineHeight = baseLineHeight;

                    for (const region of regions) {
                      if (local >= line.length) break;
                      const chunkStart = lineRawStart + local;
                      const probeOffset = Math.max(0, Math.min(raw.length, chunkStart + 1));
                      const lineFmt = { ...DEFAULT_RUN_FMT, ...getFormatAt(cellRuns, probeOffset) };
                      const lineHeight = computeLineHeight(lineFmt.fontSize, lineFmt.lineSpacing ?? 1.2);
                      rowLineHeight = Math.max(rowLineHeight, lineHeight);

                      const availableWidth = Math.max(12, region.end - region.start);
                      let bestEnd = local + 1;
                      let breakAt = -1;
                      for (let i = local + 1; i <= line.length; i += 1) {
                        const width = measureRangeWidth(lineRawStart + local, lineRawStart + i);
                        if (width <= availableWidth) {
                          bestEnd = i;
                          const ch = line[i - 1];
                          if (ch === ' ' || ch === '-') breakAt = i;
                        } else {
                          break;
                        }
                      }
                      if (bestEnd === local) bestEnd = local + 1;
                      if (bestEnd < line.length && breakAt > local + 1) bestEnd = breakAt;

                      const chunkEnd = lineRawStart + bestEnd;
                      rowChunks.push({
                        start: chunkStart,
                        end: chunkEnd,
                        regionStart: region.start,
                        regionWidth: availableWidth,
                        lineFmt,
                        lineHeight,
                      });
                      local = bestEnd;
                      while (local < line.length && line[local] === ' ') local += 1;
                    }

                    for (const chunk of rowChunks) {
                      const chunkWidth = measureRangeWidth(chunk.start, chunk.end);
                      const textAlign = chunk.lineFmt.textAlign ?? 'left';
                      let drawX = chunk.regionStart;
                      if (textAlign === 'center') {
                        drawX = chunk.regionStart + Math.max(0, (chunk.regionWidth - chunkWidth) / 2);
                      } else if (textAlign === 'right') {
                        drawX = chunk.regionStart + Math.max(0, chunk.regionWidth - chunkWidth);
                      }
                      drawChunkAtY(chunk.start, chunk.end, drawX, flowY);
                    }

                    flowY += rowLineHeight;
                    if (flowY >= centerWrapFlow.bottomY - 0.5) {
                      centerWrapFlow = null;
                      break;
                    }
                  }
                  return;
                }

                const chunks: Array<{ start: number; end: number }> = [];
                const firstChunkHasLane =
                  wrapLaneX !== null &&
                  flowY < wrapLaneBottomY - 0.5 &&
                  wrapLaneX > textStartX + 0.5;
                const firstActiveLaneX = firstChunkHasLane ? (wrapLaneX ?? textStartX) : textStartX;
                const firstChunkMaxWidth = firstChunkHasLane
                  ? Math.max(12, innerRight - firstActiveLaneX)
                  : textMaxWidth;
                if (!line) {
                  chunks.push({ start: lineRawStart, end: lineRawStart });
                } else {
                  let local = 0;
                  while (local < line.length) {
                    let bestEnd = local + 1;
                    let breakAt = -1;
                    const maxWidthForChunk = chunks.length === 0 ? firstChunkMaxWidth : textMaxWidth;
                    for (let i = local + 1; i <= line.length; i += 1) {
                      const width = measureRangeWidth(lineRawStart + local, lineRawStart + i);
                      if (width <= maxWidthForChunk) {
                        bestEnd = i;
                        const ch = line[i - 1];
                        if (ch === ' ' || ch === '-') breakAt = i;
                      } else {
                        break;
                      }
                    }
                    if (bestEnd === local) bestEnd = local + 1;
                    if (bestEnd < line.length && breakAt > local + 1) bestEnd = breakAt;
                    chunks.push({ start: lineRawStart + local, end: lineRawStart + bestEnd });
                    local = bestEnd;
                    while (local < line.length && line[local] === ' ') local += 1;
                  }
                }
                for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
                  const chunk = chunks[chunkIndex];
                  const probeOffset =
                    chunk.end > chunk.start
                      ? Math.max(0, Math.min(raw.length, chunk.start + 1))
                      : chunk.start;
                  const lineFmt = { ...DEFAULT_RUN_FMT, ...getFormatAt(cellRuns, probeOffset) };
                  const lineHeight = computeLineHeight(lineFmt.fontSize, lineFmt.lineSpacing ?? 1.2);

                  if (chunk.end === chunk.start) {
                    flowY += lineHeight;
                    continue;
                  }

                  // First pass: measure total line width for center/right alignment
                  const totalLineWidth = measureRangeWidth(chunk.start, chunk.end);

                    const chunkHasLaneOffset =
                      wrapLaneX !== null &&
                      flowY < wrapLaneBottomY - 0.5 &&
                      wrapLaneX > textStartX + 0.5;
                    const activeLaneX = chunkHasLaneOffset ? (wrapLaneX ?? textStartX) : textStartX;
                    const chunkStartsInLane = chunkHasLaneOffset && (laneCoversAllChunks || chunkIndex === 0);
                    const baseX = chunkStartsInLane ? activeLaneX : textStartX;
                  const baseWidth = chunkStartsInLane
                    ? Math.max(12, innerRight - activeLaneX)
                    : textMaxWidth;

                  let drawX = baseX;
                  if (!chunkStartsInLane && baseX === textStartX) {
                    if (textAlign === 'center') {
                      drawX = baseX + Math.max(0, (baseWidth - totalLineWidth) / 2);
                    } else if (textAlign === 'right') {
                      drawX = baseX + Math.max(0, baseWidth - totalLineWidth);
                    }
                  }

                  // Second pass: draw each run segment
                  drawChunkAtY(chunk.start, chunk.end, drawX, flowY);

                  flowY += lineHeight;
                  if (wrapLaneX !== null && flowY >= wrapLaneBottomY - 0.5) {
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                  }
                }
              };

              ctx.save();
              if (!hasFrontWrapPart) {
                ctx.beginPath();
                ctx.rect(
                  boxX + metrics.columnOffsets[c] + 2,
                  boxY + metrics.rowOffsets[r] + 2,
                  Math.max(8, cellWidth - 4),
                  Math.max(8, cellHeight - 4),
                );
                ctx.clip();
              }
              const deferredFrontImages: Array<{
                cached: CachedImage;
                drawX: number;
                drawY: number;
                drawW: number;
                drawH: number;
                rotationDeg: number;
                opacityPct: number;
              }> = [];

              for (const part of parts) {
                if (flowY > maxY) break;
                if (part.type === 'image') {
                  const imageMeta = part.meta;
                  const cached = imageCacheRef.current.get(imageMeta.src);
                  const imageMetrics = getImageRenderMetrics(
                    imageMeta,
                    innerW,
                    cached ? { w: cached.w, h: cached.h } : undefined,
                  );
                  const drawW = Math.max(1, imageMetrics.drawWidth);
                  const drawH = Math.max(1, imageMetrics.drawHeight);
                  const drawX =
                    imageMeta.align === 'right'
                      ? innerX + Math.max(0, innerW - drawW)
                      : imageMeta.align === 'center'
                        ? innerX + Math.max(0, (innerW - drawW) / 2)
                        : innerX;
                  const drawY = flowY;

                  if (cached) {
                    if (isTextInFrontWrap(imageMeta.wrap)) {
                      deferredFrontImages.push({
                        cached,
                        drawX,
                        drawY,
                        drawW,
                        drawH,
                        rotationDeg: imageMeta.rotationDeg,
                        opacityPct: imageMeta.frontOpacityPct ?? 45,
                      });
                    } else {
                      ctx.save();
                      ctx.beginPath();
                      ctx.rect(innerX, innerY, innerW, innerH);
                      ctx.clip();
                      ctx.drawImage(cached.drawable, drawX, drawY, drawW, drawH);
                      ctx.restore();
                    }
                  } else {
                    ctx.save();
                    if (isTextInFrontWrap(imageMeta.wrap)) {
                      ctx.globalAlpha = Math.max(0, Math.min(1, (imageMeta.frontOpacityPct ?? 45) / 100));
                    }
                    if (!isTextInFrontWrap(imageMeta.wrap)) {
                      ctx.fillStyle = '#f1f5f9';
                      ctx.fillRect(innerX, innerY, innerW, innerH);
                      ctx.strokeStyle = '#cbd5e1';
                      ctx.strokeRect(drawX + 0.5, drawY + 0.5, Math.max(1, drawW - 1), Math.max(1, drawH - 1));
                      ctx.fillStyle = '#64748b';
                      ctx.font = '11px Raleway, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                      ctx.fillText('Image', drawX + 6, drawY + 14);
                    }
                    ctx.restore();
                  }

                  const frontNoClip = isTextInFrontWrap(imageMeta.wrap);
                  const visX = frontNoClip ? drawX : Math.max(innerX, drawX);
                  const visY = frontNoClip ? drawY : Math.max(innerY, drawY);
                  const visW = frontNoClip
                    ? drawW
                    : Math.max(1, Math.min(innerX + innerW, drawX + drawW) - visX);
                  const visH = frontNoClip
                    ? drawH
                    : Math.max(1, Math.min(innerY + innerH, drawY + drawH) - visY);

                  imageBoxesRef.current.push({
                    start: segStart,
                    end: segEnd,
                    x: visX,
                    y: visY,
                    width: visW,
                    height: visH,
                    drawWidth: drawW,
                    drawHeight: drawH,
                    centerX: visX + visW / 2,
                    centerY: visY + visH / 2,
                    meta: imageMeta,
                    tableImage: {
                      tableStart: segStart,
                      row: r,
                      column: c,
                      tokenRangeIndex: part.tokenRangeIndex,
                    },
                  });

                  const useSideLaneFlow =
                    imageMeta.align === 'left' &&
                    (isInlineWrap(imageMeta.wrap) || isWrapTextWrap(imageMeta.wrap));
                  const useCenterDualFlow =
                    (imageMeta.align === 'center' || imageMeta.align === 'right') &&
                    isWrapTextWrap(imageMeta.wrap);
                  const inlineSingleLineFlow =
                    imageMeta.align === 'left' && isInlineWrap(imageMeta.wrap);
                  const wrapFullHeightFlow =
                    imageMeta.align === 'left' &&
                    isWrapTextWrap(imageMeta.wrap);

                  if (isTextInFrontWrap(imageMeta.wrap)) {
                    // Front mode should not change text flow geometry in table cells.
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                    laneCoversAllChunks = false;
                    centerWrapFlow = null;
                  } else if (useCenterDualFlow) {
                    flowY = drawY;
                    centerWrapFlow = {
                      leftEnd: Math.max(textStartX, drawX - 8),
                      rightStart:
                        imageMeta.align === 'right'
                          ? innerRight
                          : Math.min(innerRight, drawX + drawW + 8),
                      bottomY: drawY + drawH,
                    };
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                    laneCoversAllChunks = false;
                  } else if (useSideLaneFlow) {
                    const nextInlineX = Math.max(textStartX, drawX + drawW + 4);
                    const minLaneWidth = wrapFullHeightFlow ? 4 : 12;
                    if (nextInlineX > innerRight - minLaneWidth) {
                      flowY += Math.max(baseLineHeight, drawH);
                      wrapLaneX = null;
                      wrapLaneBottomY = 0;
                      laneCoversAllChunks = false;
                      centerWrapFlow = null;
                    } else {
                      // Wrap/front start at image top-right and flow for full image height.
                      // Inline keeps the previous bottom-anchored single-line behavior.
                      if (wrapFullHeightFlow) {
                        flowY = drawY;
                      } else {
                        flowY += Math.max(0, drawH - baseLineHeight);
                      }
                      wrapLaneX = nextInlineX;
                      laneCoversAllChunks = wrapFullHeightFlow;
                      // Inline mode: only the first wrapped line should use the side lane.
                      wrapLaneBottomY = inlineSingleLineFlow ? flowY + 0.6 : drawY + drawH;
                      centerWrapFlow = null;
                    }
                  } else {
                    // Keep break-like text a bit lower after images in tables.
                    flowY += drawH + tableImageBelowGapY;
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                    laneCoversAllChunks = false;
                    centerWrapFlow = null;
                  }
                  continue;
                }

                if (suppressTextWhileEditing || !part.value) continue;
                let lineRawStart = part.rawStart;
                for (const line of part.value.split('\n')) {
                  drawTextRunsLine(lineRawStart, line);
                  lineRawStart += line.length + 1; // +1 for the '\n' separator
                  if (flowY > maxY) break;
                }
              }

              for (const frontImage of deferredFrontImages) {
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, frontImage.opacityPct / 100));
                ctx.translate(
                  frontImage.drawX + frontImage.drawW / 2,
                  frontImage.drawY + frontImage.drawH / 2,
                );
                ctx.rotate((frontImage.rotationDeg * Math.PI) / 180);
                ctx.drawImage(
                  frontImage.cached.drawable,
                  -frontImage.drawW / 2,
                  -frontImage.drawH / 2,
                  frontImage.drawW,
                  frontImage.drawH,
                );
                ctx.restore();
              }

              ctx.restore();
            }
          }

          if (hasSelection && segStart < selTo && segEnd > selFrom) {
            ctx.save();
            ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
            ctx.fillRect(boxX, boxY, metrics.boxWidth, metrics.boxHeight);
            ctx.restore();
          }

          lineOffset += seg.text.length;
          tableBoxesRef.current.push({
            start: segStart,
            end: segEnd,
            x: boxX,
            y: boxY,
            width: metrics.boxWidth,
            height: metrics.boxHeight,
            rows: tableMeta.rows,
            columns: tableMeta.columns,
            rowHeight: metrics.rowHeight,
            cellWidth: metrics.cellWidth,
            rowHeights: metrics.rowHeights,
            columnWidths: metrics.columnWidths,
            rowOffsets: metrics.rowOffsets,
            columnOffsets: metrics.columnOffsets,
          });
          continue;
        }
        if (imageMeta && (isFlowingImageWrap(imageMeta.wrap) || isTextInFrontWrap(imageMeta.wrap))) {
          const cached = imageCacheRef.current.get(imageMeta.src);
          const metrics = getImageRenderMetrics(
            imageMeta,
            textAreaWidth,
            cached ? { w: cached.w, h: cached.h } : undefined,
          );
          const alignedSegX =
            vl.segs.length === 1
              ? getAlignedXInTextArea(metrics.align, metrics.boxWidth, textAreaWidth)
              : seg.x;
          const boxX = padLeft + alignedSegX;
          const imgY =
            isBreakLineWrap(imageMeta.wrap) ||
            isWrapTextWrap(imageMeta.wrap) ||
            isTextInFrontWrap(imageMeta.wrap)
              ? vl.y
              : vl.y + (vl.lineH - metrics.boxHeight) / 2;
          if (cached) {
            ctx.save();
            if (isTextInFrontWrap(imageMeta.wrap)) {
              ctx.globalAlpha = Math.max(0, Math.min(1, (imageMeta.frontOpacityPct ?? 45) / 100));
            }
            ctx.translate(boxX + metrics.boxWidth / 2, imgY + metrics.boxHeight / 2);
            ctx.rotate((imageMeta.rotationDeg * Math.PI) / 180);
            ctx.drawImage(
              cached.drawable,
              -metrics.drawWidth / 2,
              -metrics.drawHeight / 2,
              metrics.drawWidth,
              metrics.drawHeight,
            );
            ctx.restore();
          } else {
            ctx.save();
            if (isTextInFrontWrap(imageMeta.wrap)) {
              ctx.globalAlpha = Math.max(0, Math.min(1, (imageMeta.frontOpacityPct ?? 45) / 100));
            }
            if (!isTextInFrontWrap(imageMeta.wrap)) {
              ctx.fillStyle = '#f1f5f9';
              ctx.fillRect(boxX, imgY, metrics.boxWidth, metrics.boxHeight);
              ctx.strokeStyle = '#e2e8f0';
              ctx.strokeRect(boxX + 0.5, imgY + 0.5, metrics.boxWidth - 1, metrics.boxHeight - 1);
            }
            ctx.restore();
          }
          if (hasSelection && segStart < selTo && segEnd > selFrom) {
            ctx.save();
            ctx.fillStyle = 'rgba(59, 130, 246, 0.24)';
            ctx.fillRect(boxX, imgY, metrics.boxWidth, metrics.boxHeight);
            ctx.restore();
          }
          imageBoxesRef.current.push({
            start: lineOffset,
            end: lineOffset + seg.text.length,
            x: boxX,
            y: imgY,
            width: metrics.boxWidth,
            height: metrics.boxHeight,
            drawWidth: metrics.drawWidth,
            drawHeight: metrics.drawHeight,
            centerX: boxX + metrics.boxWidth / 2,
            centerY: imgY + metrics.boxHeight / 2,
            meta: imageMeta,
          });
          lineOffset += seg.text.length;
          continue;
        }
        // Normal text rendering
        ctx.font = buildFont(seg.fmt.fontSize, seg.fmt.bold, seg.fmt.italic, seg.fmt.fontFamily);
        const segY = lineHasBreakImage
          ? vl.y
          : lineHasInlineImage
            ? vl.y + Math.max(0, vl.lineH - seg.fmt.fontSize)
            : vl.y + (vl.lineH - seg.fmt.fontSize) / 2;
        if (hasSelection && segStart < selTo && segEnd > selFrom && seg.text.length > 0) {
          const localStart = Math.max(0, selFrom - segStart);
          const localEnd = Math.min(seg.text.length, selTo - segStart);
          if (localEnd > localStart) {
            const startX = ctx.measureText(seg.text.slice(0, localStart)).width;
            const endX = ctx.measureText(seg.text.slice(0, localEnd)).width;
            ctx.save();
            ctx.fillStyle = 'rgba(59, 130, 246, 0.24)';
            ctx.fillRect(
              padLeft + seg.x + startX,
              segY - 1,
              Math.max(1, endX - startX),
              Math.max(2, seg.fmt.fontSize + 2),
            );
            ctx.restore();
          }
        }
        if (seg.fmt.highlightColor) {
          const segW = ctx.measureText(seg.text).width;
          const highlightPadY = 2;
          ctx.fillStyle = seg.fmt.highlightColor;
          ctx.fillRect(
            padLeft + seg.x,
            segY - highlightPadY,
            segW,
            Math.max(2, seg.fmt.fontSize + highlightPadY * 2),
          );
        }
        ctx.fillStyle = seg.fmt.color;
        ctx.fillText(seg.text, padLeft + seg.x, segY);
        if (seg.fmt.underline) {
          ctx.fillRect(
            padLeft + seg.x,
            segY + seg.fmt.fontSize + 1,
            ctx.measureText(seg.text).width,
            1,
          );
        }
        lineOffset += seg.text.length;
      }
      const imageMeta = vl.imageMeta ?? null;
      if (imageMeta) {
        const cached = imageCacheRef.current.get(imageMeta.src);
        const metrics = getImageRenderMetrics(
          imageMeta,
          textAreaWidth,
          cached ? { w: cached.w, h: cached.h } : undefined,
        );
        const boxX = padLeft + getAlignedXInTextArea(metrics.align, metrics.boxWidth, textAreaWidth);
        const boxY = vl.y + (vl.lineH - metrics.boxHeight) / 2;

        if (cached) {
          ctx.save();
          if (isTextInFrontWrap(imageMeta.wrap)) {
            ctx.globalAlpha = Math.max(0, Math.min(1, (imageMeta.frontOpacityPct ?? 45) / 100));
          }
          ctx.translate(boxX + metrics.boxWidth / 2, boxY + metrics.boxHeight / 2);
          ctx.rotate((imageMeta.rotationDeg * Math.PI) / 180);
          ctx.drawImage(
            cached.drawable,
            -metrics.drawWidth / 2,
            -metrics.drawHeight / 2,
            metrics.drawWidth,
            metrics.drawHeight,
          );
          ctx.restore();
        } else {
          if (!isTextInFrontWrap(imageMeta.wrap)) {
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(boxX, boxY, metrics.boxWidth, metrics.boxHeight);
            ctx.strokeStyle = '#e2e8f0';
            ctx.strokeRect(boxX + 0.5, boxY + 0.5, metrics.boxWidth - 1, metrics.boxHeight - 1);
          }
        }
        if (hasSelection && vl.startOffset < selTo && vl.endOffset > selFrom) {
          ctx.save();
          ctx.fillStyle = 'rgba(59, 130, 246, 0.24)';
          ctx.fillRect(boxX, boxY, metrics.boxWidth, metrics.boxHeight);
          ctx.restore();
        }
        imageBoxesRef.current.push({
          start: vl.startOffset,
          end: vl.endOffset,
          x: boxX,
          y: boxY,
          width: metrics.boxWidth,
          height: metrics.boxHeight,
          drawWidth: metrics.drawWidth,
          drawHeight: metrics.drawHeight,
          centerX: boxX + metrics.boxWidth / 2,
          centerY: boxY + metrics.boxHeight / 2,
          meta: imageMeta,
        });
      }
    }

    const tableEditorFocused =
      typeof document !== 'undefined' &&
      tableInputRef.current !== null &&
      document.activeElement === tableInputRef.current;

    // Draw insertion caret (cursor) with image-aware anchors.
    // Skip canvas caret while the table textarea owns focus to avoid duplicate cursors.
    if (blinkRef.current && !hasSelection && !isTableCellEditingRef.current && !tableEditorFocused) {
      const cursor = cursorRef.current;
      let caretX = padLeft;
      let caretY = padTop;
      let caretH = Math.max(16, curFmtRef.current.fontSize);
      const imageCaretH = Math.max(16, curFmtRef.current.fontSize);
      const breakCaretGapY = 8;
      const tableImageBelowGapY = 12;
      let placedTableCaret = false;

      const selectedTable = selectedTableHitRef.current;
      const tableCursor = tableCellCursorRef.current;
      if (
        selectedTable &&
        tableCursor &&
        tableCursor.tableStart === selectedTable.box.start &&
        tableCursor.row === selectedTable.row &&
        tableCursor.column === selectedTable.column
      ) {
        // selectedTable.box.end is captured at click time and becomes stale after any
        // cell edit (cell content changes → table token length changes). Look up the
        // current table end from tableBoxesRef which is rebuilt fresh this draw call.
        const currentTableBox = tableBoxesRef.current.find((tb) => tb.start === selectedTable.box.start);
        const currentTableEnd = currentTableBox?.end ?? selectedTable.box.end;
        const token = flatText.slice(selectedTable.box.start, currentTableEnd);
        const tableMeta = parseTableToken(token);
        if (tableMeta) {
          const row = Math.max(0, Math.min(tableMeta.rows - 1, selectedTable.row));
          const column = Math.max(0, Math.min(tableMeta.columns - 1, selectedTable.column));
          const cellRuns = tableMeta.cells?.[row]?.[column] ?? [];
          const cellValue = runsToText(tableMeta.cells?.[row]?.[column] ?? []);
          const primaryCellFmt: RunFmt = cellRuns[0]
            ? { ...DEFAULT_RUN_FMT, ...cellRuns[0] }
            : { ...DEFAULT_RUN_FMT };
          const cellBaseLineHeight = computeLineHeight(
            primaryCellFmt.fontSize,
            primaryCellFmt.lineSpacing ?? 1.2,
          );
          const cellOffset = Math.max(0, Math.min(cellValue.length, tableCursor.offset));
          const ranges = getImageTokenRanges(cellValue);
          const findTableImageBox = (preferredTokenRangeIndex?: number) => {
            const cellBoxes = imageBoxesRef.current.filter(
              (box) =>
                box.tableImage?.tableStart === selectedTable.box.start &&
                box.tableImage.row === row &&
                box.tableImage.column === column,
            );
            if (cellBoxes.length === 0) return null;
            if (preferredTokenRangeIndex === undefined) return cellBoxes[0];
            const exact = cellBoxes.find(
              (box) => box.tableImage?.tokenRangeIndex === preferredTokenRangeIndex,
            );
            if (exact) return exact;

            let closest = cellBoxes[0];
            let bestDistance = Number.POSITIVE_INFINITY;
            for (const box of cellBoxes) {
              const idx = box.tableImage?.tokenRangeIndex ?? 0;
              const distance = Math.abs(idx - preferredTokenRangeIndex);
              if (distance < bestDistance) {
                bestDistance = distance;
                closest = box;
              }
            }
            return closest;
          };
          const tokenIndex = ranges.findIndex(
            (range) => cellOffset > range.start && cellOffset < range.end,
          );
          const getPreferredFormatOffset = (offset: number) => {
            // At image boundaries, prefer adjacent text formatting over image-token
            // formatting so caret line-height matches surrounding words.
            const atImageEnd = ranges.some((range) => range.end === offset);
            if (atImageEnd && offset < cellValue.length) return Math.min(cellValue.length, offset + 1);

            const atImageStart = ranges.some((range) => range.start === offset);
            if (atImageStart && offset > 0) return Math.max(0, offset - 1);

            return Math.max(0, Math.min(cellValue.length, offset));
          };
          if (tokenIndex >= 0) {
            const imageBox = findTableImageBox(tokenIndex);
            if (imageBox) {
              const range = ranges[tokenIndex];
              // Treat image boundaries as two distinct caret stops:
              // range.start = left side (typing inserts before image)
              // range.end   = right side (typing inserts after image)
              const atStart = cellOffset === range.start;
              const caretFmtOffset = getPreferredFormatOffset(atStart ? range.start : range.end);
              const caretFmt = {
                ...DEFAULT_RUN_FMT,
                ...getFormatAt(cellRuns, caretFmtOffset),
              };
              const tableBoxForCaret = tableBoxesRef.current.find(
                (box) => box.start === selectedTable.box.start,
              );
              const cellPadding = Math.max(2, Math.min(32, Math.round(tableMeta.cellPaddingPx ?? 8)));
              const cellStartPadding = Math.max(
                2,
                Math.min(
                  Math.max(2, Math.round((tableBoxForCaret?.columnWidths[column] ?? tableBoxForCaret?.cellWidth ?? 96) - 4)),
                  Math.round(tableMeta.columnStartPaddingPx?.[column] ?? cellPadding),
                ),
              );
              const cellEndPadding = cellPadding;
              const cellInnerLeft = tableBoxForCaret
                ? tableBoxForCaret.x + tableBoxForCaret.columnOffsets[column] + cellStartPadding
                : imageBox.x;
              const cellInnerRight = tableBoxForCaret
                ? tableBoxForCaret.x + tableBoxForCaret.columnOffsets[column] +
                  Math.max(
                    10,
                    (tableBoxForCaret.columnWidths[column] ?? tableBoxForCaret.cellWidth) - cellEndPadding,
                  )
                : imageBox.x + imageBox.drawWidth;
              const naturalSideLaneX = imageBox.x + imageBox.drawWidth + 4;
              const sideLaneX = Math.max(cellInnerLeft, Math.min(cellInnerRight, naturalSideLaneX));
              const minLaneWidth =
                isInlineWrap(imageBox.meta.wrap) ? 12 : isWrapTextWrap(imageBox.meta.wrap) ? 4 : 12;
              const canUseSideLane = naturalSideLaneX <= cellInnerRight - minLaneWidth;
              const sideLaneLineH = cellBaseLineHeight;
              const isLeftSideLaneFlow =
                imageBox.meta.align === 'left' &&
                (isInlineWrap(imageBox.meta.wrap) || isWrapTextWrap(imageBox.meta.wrap));
              // Use drawHeight (full rendered H) not height (clipped to cell bounds)
              // so caret Y is always anchored to the actual image bottom, not the
              // visible-area boundary.
              const imgDrawH = imageBox.drawHeight;
              if (isBreakLineWrap(imageBox.meta.wrap)) {
                const breakLineInnerLeft = tableBoxForCaret
                  ? tableBoxForCaret.x + tableBoxForCaret.columnOffsets[column] + cellStartPadding
                  : imageBox.x;
                caretX = breakLineInnerLeft;
                caretY = imageBox.y + imgDrawH + tableImageBelowGapY;
                caretH = Math.max(16, curFmtRef.current.fontSize);
              } else if (isLeftSideLaneFlow && !atStart && canUseSideLane) {
                // For post-image typing in table side-lane flow, match rendered text start.
                caretX = sideLaneX;
                if (isInlineWrap(imageBox.meta.wrap)) {
                  caretY = imageBox.y + Math.max(0, imgDrawH - sideLaneLineH);
                } else {
                  caretY = imageBox.y;
                }
                caretH = Math.max(16, caretFmt.fontSize);
              } else if (
                !atStart &&
                (isInlineWrap(imageBox.meta.wrap) || isWrapTextWrap(imageBox.meta.wrap))
              ) {
                // Non-left flow modes in tables are rendered break-like after image.
                caretX = cellInnerLeft;
                caretY = imageBox.y + imgDrawH + tableImageBelowGapY;
                caretH = Math.max(16, caretFmt.fontSize);
              } else {
                caretX = atStart ? imageBox.x : imageBox.x + imageBox.drawWidth;
                caretY = imageBox.y + Math.max(0, imgDrawH - imageCaretH);
                caretH = imageCaretH;
              }
              placedTableCaret = true;
            }
          }

          if (!placedTableCaret) {
            const tableBox = tableBoxesRef.current.find(
              (box) => box.start === selectedTable.box.start,
            );
            if (tableBox) {
              const cellRuns = tableMeta.cells?.[row]?.[column] ?? [];
              const fmt = {
                ...DEFAULT_RUN_FMT,
                ...getFormatAt(cellRuns, getPreferredFormatOffset(cellOffset)),
              };
              const cellX = tableBox.x + tableBox.columnOffsets[column];
              const cellY = tableBox.y + tableBox.rowOffsets[row];
              const cellW = tableBox.columnWidths[column] ?? tableBox.cellWidth;
              const cellPadding = Math.max(2, Math.min(32, Math.round(tableMeta.cellPaddingPx ?? 8)));
              const cellPadStartX = Math.max(
                2,
                Math.min(Math.max(2, Math.round(cellW - 4)), Math.round(tableMeta.columnStartPaddingPx?.[column] ?? cellPadding)),
              );
              const cellPadEndX = cellPadding;
              const cellPadY = cellPadding + 1;
              const innerLeft = cellX + cellPadStartX;
              const innerRight = cellX + Math.max(10, cellW - cellPadEndX);

              // Reconstruct wrapped text chunks with image lane transitions so caret
              // placement mirrors click hit-testing and draw layout.
              type WrappedChunk = {
                start: number;
                end: number;
                drawX: number;
                baselineY: number;
                fontSize: number;
                lineHeight: number;
              };
              const wrappedChunks: WrappedChunk[] = [];
              let geomY = cellY + cellPadY;
              let geomX = innerLeft;
              let wrapLaneX: number | null = null;
              let wrapLaneBottomY = 0;
              let laneCoversAllChunks = false;

              const measureRunAwareWidth = (from: number, to: number) => {
                const safeFrom = Math.max(0, Math.min(cellValue.length, from));
                const safeTo = Math.max(safeFrom, Math.min(cellValue.length, to));
                let width = 0;
                let runPos = 0;
                for (const run of cellRuns) {
                  const runEnd = runPos + run.text.length;
                  const segFrom = Math.max(safeFrom, runPos);
                  const segTo = Math.min(safeTo, runEnd);
                  if (segTo > segFrom) {
                    const segText = run.text.slice(segFrom - runPos, segTo - runPos);
                    ctx.font = buildFont(run.fontSize, run.bold, run.italic, run.fontFamily);
                    width += ctx.measureText(segText).width;
                  }
                  runPos = runEnd;
                  if (runPos >= safeTo) break;
                }
                return width;
              };

              const appendWrappedText = (
                value: string,
                absoluteStart: number,
                firstLineStartX: number,
              ) => {
                const lines = value.split('\n');
                let consumed = 0;
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                  const line = lines[lineIndex] ?? '';
                  const lineAbsStart = absoluteStart + consumed;
                  const subChunks: Array<{ start: number; end: number }> = [];
                  const lineLaneActive = wrapLaneX !== null && geomY < wrapLaneBottomY - 0.5;
                  const lineLaneX = wrapLaneX ?? innerLeft;
                  const firstChunkStartX = lineLaneActive
                    ? Math.max(lineIndex === 0 ? firstLineStartX : innerLeft, lineLaneX)
                    : lineIndex === 0
                      ? firstLineStartX
                      : innerLeft;

                  if (!line) {
                    subChunks.push({ start: lineAbsStart, end: lineAbsStart });
                  } else {
                    let local = 0;
                    while (local < line.length) {
                      const availableWidth =
                        subChunks.length === 0
                          ? Math.max(12, innerRight - firstChunkStartX)
                          : Math.max(12, innerRight - innerLeft);
                      let bestEnd = local + 1;
                      let breakAt = -1;
                      for (let i = local + 1; i <= line.length; i += 1) {
                        const width = measureRunAwareWidth(lineAbsStart + local, lineAbsStart + i);
                        if (width <= availableWidth) {
                          bestEnd = i;
                          const ch = line[i - 1];
                          if (ch === ' ' || ch === '-') breakAt = i;
                        } else {
                          break;
                        }
                      }
                      if (bestEnd === local) bestEnd = local + 1;
                      if (bestEnd < line.length && breakAt > local + 1) bestEnd = breakAt;
                      subChunks.push({ start: lineAbsStart + local, end: lineAbsStart + bestEnd });
                      local = bestEnd;
                      while (local < line.length && line[local] === ' ') local += 1;
                    }
                  }

                  for (let i = 0; i < subChunks.length; i += 1) {
                    const chunk = subChunks[i];
                    const probeOffset =
                      chunk.end > chunk.start
                        ? Math.max(0, Math.min(cellValue.length, chunk.start + 1))
                        : chunk.start;
                    const lineFmt = { ...DEFAULT_RUN_FMT, ...getFormatAt(cellRuns, probeOffset) };
                    const lineHeight = computeLineHeight(lineFmt.fontSize, lineFmt.lineSpacing ?? 1.2);
                    const chunkWidth = measureRunAwareWidth(chunk.start, chunk.end);
                    const textAlign = lineFmt.textAlign ?? 'left';

                    const chunkLaneActive = wrapLaneX !== null && geomY < wrapLaneBottomY - 0.5;
                    const laneX = wrapLaneX ?? innerLeft;
                    const firstChunkBaseX = chunkLaneActive
                      ? Math.max(lineIndex === 0 ? firstLineStartX : innerLeft, laneX)
                      : lineIndex === 0
                        ? firstLineStartX
                        : innerLeft;
                    const laneXForChunk = chunkLaneActive ? Math.max(innerLeft, laneX) : innerLeft;
                    const isFirstChunkInLine = i === 0;
                    const canChunkUseLane = chunkLaneActive && (laneCoversAllChunks || isFirstChunkInLine);
                    const baseX = canChunkUseLane
                      ? (isFirstChunkInLine ? firstChunkBaseX : laneXForChunk)
                      : innerLeft;
                    let drawX = baseX;
                    if (!canChunkUseLane && baseX === innerLeft) {
                      const area = innerRight - innerLeft;
                      if (textAlign === 'center') {
                        drawX = innerLeft + Math.max(0, (area - chunkWidth) / 2);
                      } else if (textAlign === 'right') {
                        drawX = innerLeft + Math.max(0, area - chunkWidth);
                      }
                    }

                    wrappedChunks.push({
                      start: chunk.start,
                      end: chunk.end,
                      drawX,
                      baselineY: geomY,
                      fontSize: lineFmt.fontSize,
                      lineHeight,
                    });
                    geomY += lineHeight;
                  }

                  consumed += line.length + (lineIndex < lines.length - 1 ? 1 : 0);
                  if (wrapLaneX !== null && geomY >= wrapLaneBottomY - 0.5) {
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                  }
                }
                geomX = wrapLaneX !== null && geomY < wrapLaneBottomY - 0.5 ? wrapLaneX : innerLeft;
              };

              let geomCursor = 0;
              for (let i = 0; i < ranges.length; i += 1) {
                const range = ranges[i];
                const imageBox = findTableImageBox(i);
                if (range.start > geomCursor) {
                  appendWrappedText(cellValue.slice(geomCursor, range.start), geomCursor, geomX);
                }

                geomCursor = range.end;
                if (imageBox) {
                  const tokenMeta = parseImageToken(cellValue.slice(range.start, range.end));
                  // Always use drawHeight so geometry matches the draw path exactly.
                  const ibDH = imageBox.drawHeight;
                  if (tokenMeta?.wrap === 'break') {
                    geomY += ibDH + tableImageBelowGapY;
                    geomX = innerLeft;
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                  } else if (
                    tokenMeta &&
                    tokenMeta.align === 'left' &&
                    (isInlineWrap(tokenMeta.wrap) || isWrapTextWrap(tokenMeta.wrap))
                  ) {
                    const inlineSingleLineFlow = isInlineWrap(tokenMeta.wrap);
                    const wrapFullHeightFlow = isWrapTextWrap(tokenMeta.wrap);
                    const nextInlineX = Math.max(innerLeft, imageBox.x + imageBox.drawWidth + 4);
                    const minLaneWidth = wrapFullHeightFlow ? 4 : 12;
                    if (nextInlineX > innerRight - minLaneWidth) {
                      geomY += Math.max(cellBaseLineHeight, ibDH);
                      geomX = innerLeft;
                      wrapLaneX = null;
                      wrapLaneBottomY = 0;
                      laneCoversAllChunks = false;
                    } else {
                      if (wrapFullHeightFlow) {
                        geomY = imageBox.y;
                      } else {
                        geomY += Math.max(0, ibDH - cellBaseLineHeight);
                      }
                      geomX = nextInlineX;
                      wrapLaneX = nextInlineX;
                      laneCoversAllChunks = wrapFullHeightFlow;
                      // Inline mode: side lane only for the first auto-wrapped line.
                      wrapLaneBottomY = inlineSingleLineFlow ? geomY + 0.6 : imageBox.y + ibDH;
                    }
                  } else if (tokenMeta && isTextInFrontWrap(tokenMeta.wrap)) {
                    // Front mode: image is a visual overlay, text flow geometry is unchanged.
                  } else {
                    geomY += ibDH + tableImageBelowGapY;
                    geomX = innerLeft;
                    wrapLaneX = null;
                    wrapLaneBottomY = 0;
                    laneCoversAllChunks = false;
                  }
                }
              }

              if (geomCursor < cellValue.length) {
                appendWrappedText(cellValue.slice(geomCursor), geomCursor, geomX);
              }

              const chunkIndex = wrappedChunks.findIndex((chunk) => {
                if (cellOffset < chunk.start) return false;
                // Keep wrap-boundary offsets on the current visual line for table clicks.
                return cellOffset <= chunk.end;
              });
              if (chunkIndex >= 0) {
                const chunk = wrappedChunks[chunkIndex];
                const xOffset = measureRunAwareWidth(chunk.start, Math.min(cellOffset, chunk.end));
                caretX = Math.max(innerLeft, Math.min(innerRight, chunk.drawX + xOffset));
                caretY = chunk.baselineY;
                caretH = Math.max(16, chunk.fontSize);
                placedTableCaret = true;
              }

              if (placedTableCaret) {
                // Wrapped geometry solved in-cell caret placement.
              } else {

              // Anchor fallback from the nearest image in this cell when caret is after it.
              let lastImageIndex = -1;
              for (let i = 0; i < ranges.length; i++) {
                if (ranges[i].end <= cellOffset) lastImageIndex = i;
              }

              if (lastImageIndex >= 0) {
                const anchorBox = findTableImageBox(lastImageIndex);

                if (anchorBox) {
                  const anchorRange = ranges[lastImageIndex];
                  const trailingRaw = cellValue.slice(anchorRange.end, cellOffset);
                  const trailingPlain = trailingRaw.replace(/\[\[IMAGE\|[^\]]+\]\]/g, '');
                  const trailingLines = trailingPlain.split('\n');
                  const trailingLine = trailingLines[trailingLines.length - 1] ?? '';
                  const trailingLineIndex = Math.max(0, trailingLines.length - 1);
                  ctx.font = buildFont(fmt.fontSize, fmt.bold, fmt.italic, fmt.fontFamily);
                  const measured = ctx.measureText(trailingLine).width;

                  // drawHeight = full rendered height; height = clipped to cell.
                  const abDH = anchorBox.drawHeight;
                  let baseX = anchorBox.x + anchorBox.drawWidth;
                  let baseY = anchorBox.y + Math.max(0, abDH - Math.max(16, fmt.fontSize));
                  const isLeftSideLaneFlow =
                    anchorBox.meta.align === 'left' &&
                    (isInlineWrap(anchorBox.meta.wrap) || isWrapTextWrap(anchorBox.meta.wrap));
                  if (isBreakLineWrap(anchorBox.meta.wrap)) {
                    baseX = innerLeft;
                    baseY = anchorBox.y + abDH + tableImageBelowGapY;
                  } else if (isLeftSideLaneFlow) {
                    const nextLaneX = Math.max(innerLeft, anchorBox.x + anchorBox.drawWidth + 4);
                    const minLaneWidth =
                      isInlineWrap(anchorBox.meta.wrap) ? 12 : isWrapTextWrap(anchorBox.meta.wrap) ? 4 : 12;
                    if (nextLaneX > innerRight - minLaneWidth) {
                      baseX = innerLeft;
                      baseY = anchorBox.y + abDH + tableImageBelowGapY;
                    } else {
                      baseX = Math.max(innerLeft, Math.min(innerRight, nextLaneX));
                    }
                    // Table side-lane text starts from image bottom, not top.
                    const laneLineH = computeLineHeight(fmt.fontSize, fmt.lineSpacing ?? 1.2);
                    if (nextLaneX <= innerRight - 12) {
                      baseY = isInlineWrap(anchorBox.meta.wrap)
                        ? anchorBox.y + Math.max(0, abDH - laneLineH)
                        : anchorBox.y;
                    }
                  } else if (isTextInFrontWrap(anchorBox.meta.wrap)) {
                    // Front mode: image doesn't affect text flow, Y stays at image's own baseline.
                    baseX = innerLeft;
                    baseY = anchorBox.y;
                  } else {
                    // Non-left aligned flow modes in tables behave like break flow for caret placement.
                    baseX = innerLeft;
                    baseY = anchorBox.y + abDH + tableImageBelowGapY;
                  }

                  caretX = Math.max(innerLeft, Math.min(baseX + measured, innerRight));
                  let trailingYOffset = 0;
                  if (trailingLineIndex > 0) {
                    for (let i = 0; i < trailingLineIndex; i += 1) {
                      const probe = Math.max(
                        0,
                        Math.min(cellValue.length, anchorRange.end + trailingPlain.split('\n').slice(0, i).join('\n').length + i + 1),
                      );
                      const lf = { ...DEFAULT_RUN_FMT, ...getFormatAt(cellRuns, probe) };
                      trailingYOffset += computeLineHeight(lf.fontSize, lf.lineSpacing ?? 1.2);
                    }
                  }
                  caretY = baseY + trailingYOffset;
                  caretH = Math.max(16, fmt.fontSize);
                  placedTableCaret = true;
                }
              }

              if (placedTableCaret) {
                // image-anchored fallback solved placement for this table cell
              } else {
                const measureRunAwareWidth = (from: number, to: number) => {
                  const safeFrom = Math.max(0, Math.min(cellValue.length, from));
                  const safeTo = Math.max(safeFrom, Math.min(cellValue.length, to));
                  let width = 0;
                  let runPos = 0;
                  for (const run of cellRuns) {
                    const runEnd = runPos + run.text.length;
                    const segFrom = Math.max(safeFrom, runPos);
                    const segTo = Math.min(safeTo, runEnd);
                    if (segTo > segFrom) {
                      const segText = run.text.slice(segFrom - runPos, segTo - runPos);
                      ctx.font = buildFont(run.fontSize, run.bold, run.italic, run.fontFamily);
                      width += ctx.measureText(segText).width;
                    }
                    runPos = runEnd;
                    if (runPos >= safeTo) break;
                  }
                  return width;
                };

                // Walk every visual wrapped chunk to find the one containing cellOffset.
                // This correctly positions the caret across soft-wrapped lines, not just \n-separated ones.
                const textMaxWidthForCaret = Math.max(12, cellW - cellPadStartX - cellPadEndX);
                const allCellLines = cellValue.split('\n');
                let logStart = 0;
                let caretXOffset = 0;
                let lineYOffset = 0;
                let caretPlaced = false;

                for (const logLine of allCellLines) {
                  if (caretPlaced) break;

                  // Build visual chunks for this logical line (same algorithm as draw + ArrowDown handler).
                  const subChunks: Array<{ start: number; end: number }> = [];
                  if (!logLine) {
                    subChunks.push({ start: logStart, end: logStart });
                  } else {
                    let local = 0;
                    while (local < logLine.length) {
                      let bestEnd = local + 1;
                      let breakAt = -1;
                      for (let wi = local + 1; wi <= logLine.length; wi++) {
                        const w = measureRunAwareWidth(logStart + local, logStart + wi);
                        if (w <= textMaxWidthForCaret) {
                          bestEnd = wi;
                          const ch = logLine[wi - 1];
                          if (ch === ' ' || ch === '-') breakAt = wi;
                        } else break;
                      }
                      if (bestEnd === local) bestEnd = local + 1;
                      if (bestEnd < logLine.length && breakAt > local + 1) bestEnd = breakAt;
                      subChunks.push({ start: logStart + local, end: logStart + bestEnd });
                      local = bestEnd;
                      while (local < logLine.length && logLine[local] === ' ') local++;
                    }
                  }

                  for (let ci = 0; ci < subChunks.length; ci++) {
                    const chunk = subChunks[ci];
                    const probe = Math.max(0, Math.min(cellValue.length, chunk.start < chunk.end ? chunk.start + 1 : chunk.start));
                    const lf = { ...DEFAULT_RUN_FMT, ...getFormatAt(cellRuns, probe) };
                    const chunkH = computeLineHeight(lf.fontSize, lf.lineSpacing ?? 1.2);
                    // Keep wrap-boundary offsets on the current visual line for table clicks.
                    const chunkCoversOffset = cellOffset <= chunk.end;
                    if (chunkCoversOffset) {
                      caretXOffset = measureRunAwareWidth(chunk.start, Math.min(cellOffset, chunk.end));
                      caretPlaced = true;
                      break;
                    }
                    lineYOffset += chunkH;
                  }

                  logStart += logLine.length + 1; // +1 for the \n separator
                }

                caretX = Math.max(innerLeft, Math.min(innerLeft + caretXOffset, innerRight));
                caretY = cellY + cellPadY + lineYOffset;
                caretH = Math.max(16, fmt.fontSize);
                placedTableCaret = true;
              }
              }
            }
          }
        }
      }
      const getWrapLaneX = (imageX: number, imageW: number) => {
        const rightLaneX = imageX + imageW + 4;
        const maxLaneX = padLeft + textAreaWidth - 2;
        return rightLaneX <= maxLaneX ? rightLaneX : padLeft;
      };

      const hasInlineBoundaryTextNeighbor = (offset: number, boundary: 'start' | 'end') => {
        if (vls.length === 0) return false;
        for (const line of vls) {
          let lineOffset = line.startOffset;
          for (const seg of line.segs) {
            const segStart = lineOffset;
            const segEnd = segStart + seg.text.length;
            const tokenMeta = parseImageToken(seg.text);
            if (tokenMeta && isInlineWrap(tokenMeta.wrap)) {
              const isBoundaryMatch = boundary === 'start' ? offset === segStart : offset === segEnd;
              if (isBoundaryMatch) {
                const hasTextBefore = segStart > line.startOffset;
                const hasTextAfter = segEnd < line.endOffset;
                return boundary === 'start' ? hasTextBefore : hasTextAfter;
              }
            }
            lineOffset = segEnd;
          }
        }
        return false;
      };

      const lineStartsWithTextAtOffset = (offset: number) => {
        for (const line of vls) {
          if (line.startOffset !== offset || line.segs.length === 0) continue;
          const firstSeg = line.segs[0];
          if (parseImageToken(firstSeg.text) || parseTableToken(firstSeg.text)) continue;
          return true;
        }
        return false;
      };

      const imageAtStart = imageBoxesRef.current.find((box) => cursor === box.start) ?? null;
      const imageAtEnd = imageBoxesRef.current.find((box) => cursor === box.end) ?? null;
      const skipImageAtStartShortcut =
        imageAtStart !== null &&
        (isTextInFrontWrap(imageAtStart.meta.wrap) ||
          (isInlineWrap(imageAtStart.meta.wrap) && hasInlineBoundaryTextNeighbor(cursor, 'start')));
      const skipImageAtEndShortcut =
        imageAtEnd !== null &&
        (isTextInFrontWrap(imageAtEnd.meta.wrap) ||
          (isInlineWrap(imageAtEnd.meta.wrap) &&
            (hasInlineBoundaryTextNeighbor(cursor, 'end') || lineStartsWithTextAtOffset(cursor))));

      if (placedTableCaret) {
        // caret already placed from in-cell table cursor
      } else if (imageAtStart && !skipImageAtStartShortcut) {
        if (isBreakLineWrap(imageAtStart.meta.wrap)) {
          // Single stable anchor for break-wrap start: next line below image.
          caretX = padLeft;
          caretY = imageAtStart.y + imageAtStart.drawHeight + breakCaretGapY;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isWrapTextWrap(imageAtStart.meta.wrap)) {
          // Wrap-text writes from the lane beside the image.
          caretX = getWrapLaneX(imageAtStart.x, imageAtStart.drawWidth);
          caretY = imageAtStart.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isTextInFrontWrap(imageAtStart.meta.wrap)) {
          // Front mode caret should follow text line position, not image-height anchoring.
          caretX = imageAtStart.x;
          caretY = imageAtStart.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else {
          // Cursor at image bottom-left when at image start.
          caretX = imageAtStart.x;
          caretY = imageAtStart.y + Math.max(0, imageAtStart.drawHeight - imageCaretH);
          caretH = imageCaretH;
        }
      } else if (imageAtEnd && !skipImageAtEndShortcut) {
        if (isBreakLineWrap(imageAtEnd.meta.wrap)) {
          // Break-line mode: caret should continue below the image block.
          caretX = padLeft;
          caretY = imageAtEnd.y + imageAtEnd.drawHeight + breakCaretGapY;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isWrapTextWrap(imageAtEnd.meta.wrap)) {
          caretX = getWrapLaneX(imageAtEnd.x, imageAtEnd.drawWidth);
          caretY = imageAtEnd.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isTextInFrontWrap(imageAtEnd.meta.wrap)) {
          // Front mode caret should follow text line position, not image-height anchoring.
          caretX = imageAtEnd.x + imageAtEnd.drawWidth;
          caretY = imageAtEnd.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else {
          caretX = imageAtEnd.x + imageAtEnd.drawWidth;
          caretY = imageAtEnd.y + Math.max(0, imageAtEnd.drawHeight - imageCaretH);
          caretH = imageCaretH;
        }
      } else if (vls.length > 0) {
        const lastLine = vls[vls.length - 1];
        let placed = false;

        for (const vl of vls) {
          if (cursor < vl.startOffset || cursor > vl.endOffset) continue;
          const lineHasBreakImage = hasBreakOrWrapImageInLine(vl);
          const lineHasInlineImage = hasInlineImageInLine(vl);

          let lineOffset = vl.startOffset;
          if (vl.segs.length === 0) {
            caretX = padLeft;
            caretY = vl.y + Math.max(0, (vl.lineH - curFmtRef.current.fontSize) / 2);
            caretH = Math.max(16, curFmtRef.current.fontSize);
            placed = true;
            break;
          }

          for (const seg of vl.segs) {
            const segStart = lineOffset;
            const segEnd = segStart + seg.text.length;

            if (cursor >= segStart && cursor <= segEnd) {
              const inlineImage = parseImageToken(seg.text);
              const tableMeta = parseTableToken(seg.text);
              if (tableMeta) {
                const metrics = getTableRenderMetrics(tableMeta, textAreaWidth, imageDimsForLayout);
                const tableX = padLeft + seg.x;
                const tableY = vl.y + (vl.lineH - metrics.boxHeight) / 2;
                if (cursor <= segStart) {
                  caretX = tableX;
                } else {
                  caretX = tableX + metrics.boxWidth;
                }
                caretY = tableY;
                caretH = Math.max(16, metrics.boxHeight);
                placed = true;
                break;
              }
              if (inlineImage && (isFlowingImageWrap(inlineImage.wrap) || isTextInFrontWrap(inlineImage.wrap))) {
                const cached = imageCacheRef.current.get(inlineImage.src);
                const metrics = getImageRenderMetrics(
                  inlineImage,
                  textAreaWidth,
                  cached ? { w: cached.w, h: cached.h } : undefined,
                );
                const imgAlignedX =
                  vl.segs.length === 1
                    ? getAlignedXInTextArea(metrics.align, metrics.boxWidth, textAreaWidth)
                    : seg.x;
                const imgX = padLeft + imgAlignedX;
                const imgY = vl.y + (vl.lineH - metrics.boxHeight) / 2;
                const textCaretY = lineHasInlineImage
                  ? vl.y + Math.max(0, vl.lineH - seg.fmt.fontSize)
                  : vl.y + Math.max(0, (vl.lineH - seg.fmt.fontSize) / 2);
                const hasTextBefore = segStart > vl.startOffset;
                const hasTextAfter = segEnd < vl.endOffset;
                if (isInlineWrap(inlineImage.wrap) && cursor === segStart && hasTextBefore) {
                  caretX = imgX;
                  caretY = textCaretY;
                  caretH = Math.max(16, seg.fmt.fontSize);
                } else if (isInlineWrap(inlineImage.wrap) && cursor === segEnd && hasTextAfter) {
                  caretX = imgX + metrics.boxWidth;
                  caretY = textCaretY;
                  caretH = Math.max(16, seg.fmt.fontSize);
                } else if (cursor <= segStart) {
                  if (isBreakLineWrap(inlineImage.wrap)) {
                    caretX = padLeft;
                    caretY = imgY + metrics.boxHeight + breakCaretGapY;
                    caretH = Math.max(16, curFmtRef.current.fontSize);
                  } else if (isTextInFrontWrap(inlineImage.wrap)) {
                    caretX = imgX;
                    caretY = vl.y + Math.max(0, (vl.lineH - seg.fmt.fontSize) / 2);
                    caretH = Math.max(16, seg.fmt.fontSize);
                  } else if (isWrapTextWrap(inlineImage.wrap)) {
                    caretX = getWrapLaneX(imgX, metrics.boxWidth);
                    caretY = vl.y;
                    caretH = Math.max(16, seg.fmt.fontSize);
                  } else {
                    caretX = imgX;
                    caretY = imgY + Math.max(0, metrics.boxHeight - imageCaretH);
                    caretH = imageCaretH;
                  }
                } else {
                  if (isBreakLineWrap(inlineImage.wrap)) {
                    caretX = padLeft;
                    caretY = imgY + metrics.boxHeight + breakCaretGapY;
                    caretH = Math.max(16, curFmtRef.current.fontSize);
                  } else if (isTextInFrontWrap(inlineImage.wrap)) {
                    caretX = imgX + metrics.boxWidth;
                    caretY = vl.y + Math.max(0, (vl.lineH - seg.fmt.fontSize) / 2);
                    caretH = Math.max(16, curFmtRef.current.fontSize);
                  } else if (isWrapTextWrap(inlineImage.wrap)) {
                    caretX = getWrapLaneX(imgX, metrics.boxWidth);
                    caretY = vl.y;
                    caretH = Math.max(16, curFmtRef.current.fontSize);
                  } else {
                    caretX = imgX + metrics.boxWidth;
                    caretY = imgY + Math.max(0, metrics.boxHeight - imageCaretH);
                    caretH = imageCaretH;
                  }
                }
              } else {
                ctx.font = buildFont(
                  seg.fmt.fontSize,
                  seg.fmt.bold,
                  seg.fmt.italic,
                  seg.fmt.fontFamily,
                );
                const prefix = seg.text.slice(0, Math.max(0, cursor - segStart));
                // Leading wrap-spaces (seg.leading) are zero-advance: the caret
                // always sits at the left edge (seg.x) regardless of prefix width.
                const prefixW = seg.leading ? 0 : ctx.measureText(prefix).width;
                caretX = padLeft + seg.x + prefixW;
                caretY = lineHasBreakImage
                  ? vl.y
                  : lineHasInlineImage
                    ? vl.y + Math.max(0, vl.lineH - seg.fmt.fontSize)
                    : vl.y + Math.max(0, (vl.lineH - seg.fmt.fontSize) / 2);
                caretH = Math.max(16, seg.fmt.fontSize);
              }
              placed = true;
              break;
            }

            lineOffset = segEnd;
          }

          if (!placed && cursor === vl.endOffset) {
            const lastSeg = vl.segs[vl.segs.length - 1];
            const inlineImage = parseImageToken(lastSeg.text);
            const tableMeta = parseTableToken(lastSeg.text);
            if (tableMeta) {
              const metrics = getTableRenderMetrics(tableMeta, textAreaWidth, imageDimsForLayout);
              caretX = padLeft + lastSeg.x + metrics.boxWidth;
              caretY = vl.y + (vl.lineH - metrics.boxHeight) / 2;
              caretH = Math.max(16, metrics.boxHeight);
              placed = true;
            } else if (inlineImage && (isFlowingImageWrap(inlineImage.wrap) || isTextInFrontWrap(inlineImage.wrap))) {
              const cached = imageCacheRef.current.get(inlineImage.src);
              const metrics = getImageRenderMetrics(
                inlineImage,
                textAreaWidth,
                cached ? { w: cached.w, h: cached.h } : undefined,
              );
              const lastAlignedX =
                lastLine.segs.length === 1
                  ? getAlignedXInTextArea(metrics.align, metrics.boxWidth, textAreaWidth)
                  : lastSeg.x;
              caretX = padLeft + lastAlignedX + metrics.boxWidth;
              if (isBreakLineWrap(inlineImage.wrap)) {
                caretX = padLeft;
                caretY = vl.y + metrics.boxHeight + breakCaretGapY;
                caretH = Math.max(16, curFmtRef.current.fontSize);
              } else if (isTextInFrontWrap(inlineImage.wrap)) {
                caretX = padLeft + lastAlignedX + metrics.boxWidth;
                caretY = vl.y + Math.max(0, (vl.lineH - curFmtRef.current.fontSize) / 2);
                caretH = Math.max(16, curFmtRef.current.fontSize);
              } else if (isWrapTextWrap(inlineImage.wrap)) {
                caretX = getWrapLaneX(padLeft + lastAlignedX, metrics.boxWidth);
                caretY = vl.y;
                caretH = Math.max(16, curFmtRef.current.fontSize);
              } else {
                caretY =
                  vl.y +
                  (vl.lineH - metrics.boxHeight) / 2 +
                  Math.max(0, metrics.boxHeight - imageCaretH);
                caretH = imageCaretH;
              }
            } else {
              ctx.font = buildFont(
                lastSeg.fmt.fontSize,
                lastSeg.fmt.bold,
                lastSeg.fmt.italic,
                lastSeg.fmt.fontFamily,
              );
              caretX = padLeft + lastSeg.x + ctx.measureText(lastSeg.text).width;
              caretY = lineHasBreakImage
                ? vl.y
                : lineHasInlineImage
                  ? vl.y + Math.max(0, vl.lineH - lastSeg.fmt.fontSize)
                  : vl.y + Math.max(0, (vl.lineH - lastSeg.fmt.fontSize) / 2);
              caretH = Math.max(16, lastSeg.fmt.fontSize);
            }
            placed = true;
          }

          if (placed) break;
        }

        if (!placed) {
          const lastLineHasBreakImage = hasBreakOrWrapImageInLine(lastLine);
          const lastLineHasInlineImage = hasInlineImageInLine(lastLine);
          if (lastLine.segs.length > 0) {
            const lastSeg = lastLine.segs[lastLine.segs.length - 1];
            ctx.font = buildFont(
              lastSeg.fmt.fontSize,
              lastSeg.fmt.bold,
              lastSeg.fmt.italic,
              lastSeg.fmt.fontFamily,
            );
            caretX = padLeft + lastSeg.x + ctx.measureText(lastSeg.text).width;
            caretY = lastLineHasBreakImage
              ? lastLine.y
              : lastLineHasInlineImage
                ? lastLine.y + Math.max(0, lastLine.lineH - lastSeg.fmt.fontSize)
                : lastLine.y + Math.max(0, (lastLine.lineH - lastSeg.fmt.fontSize) / 2);
            caretH = Math.max(16, lastSeg.fmt.fontSize);
          } else {
            caretX = padLeft;
            caretY = lastLine.y + Math.max(0, (lastLine.lineH - curFmtRef.current.fontSize) / 2);
            caretH = Math.max(16, curFmtRef.current.fontSize);
          }
        }
      }

      const crispX = Math.round(caretX) + 0.5;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(crispX, caretY, 1, Math.max(8, caretH));
    }

    ctx.restore();

    // Draw right-side scrollbar overlay only in responsive mode.
    if (!isPaperMode && vls.length > 0) {
      const last = vls[vls.length - 1];
      const contentBottomAbs = last.y + last.lineH + scrollYRef.current;
      const trailingSafeSpacePx = Math.max(56, Math.round(baseLineH * 4));
      const viewportTop = padTop;
      const viewportH = Math.max(1, h - viewportTop - 4);
      const contentH = Math.max(viewportH, contentBottomAbs - padTop + trailingSafeSpacePx);
      const maxScroll = Math.max(0, contentH - viewportH);

      if (maxScroll > 0) {
        const trackW = 6;
        const trackX = w - 10;
        const trackY = viewportTop;
        const thumbH = Math.max(24, (viewportH * viewportH) / contentH);
        const t = Math.max(0, Math.min(1, scrollYRef.current / maxScroll));
        const thumbY = trackY + t * Math.max(0, viewportH - thumbH);

        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.fillRect(trackX, trackY, trackW, viewportH);
        ctx.fillStyle = 'rgba(100, 116, 139, 0.65)';
        ctx.fillRect(trackX, thumbY, trackW, thumbH);
      }
    }
  }, [
    canvasRef,
    runsRef,
    cursorRef,
    scrollYRef,
    curFmtRef,
    leftMargin,
    rightMargin,
    isPaperMode,
    paperHeightRatio,
    onPaperPaginationChange,
    getAlignedXInTextArea,
  ]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const resetBlink = useCallback(() => {
    blinkRef.current = true;
    if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    blinkTimerRef.current = window.setInterval(() => {
      blinkRef.current = !blinkRef.current;
      draw();
    }, 530);
  }, [blinkRef, blinkTimerRef, draw]);

  // Wire initial blink timer to draw
  useEffect(() => {
    blinkTimerRef.current = window.setInterval(() => {
      blinkRef.current = !blinkRef.current;
      draw();
    }, 530);
    return () => {
      if (blinkTimerRef.current) clearInterval(blinkTimerRef.current);
    };
  }, [draw, blinkRef, blinkTimerRef]);

  // Redraw on margin changes
  useEffect(() => {
    draw();
  }, [leftMargin, rightMargin, draw]);

  // ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw, canvasRef]);

  /** Hit-test: find the document offset corresponding to a client coordinate */
  const getOffsetFromClientXY = useCallback(
    (clientX: number, clientY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const paperTopPaddingPx =
        isPaperMode && paperWidthMm && paperWidthMm > 0
          ? (w * STANDARD_PAPER_TOP_MARGIN_MM) / paperWidthMm
          : undefined;
      const paperBottomPaddingPx =
        isPaperMode && paperWidthMm && paperWidthMm > 0
          ? (w * STANDARD_PAPER_BOTTOM_MARGIN_MM) / paperWidthMm
          : undefined;

      const { padLeft, textAreaWidth, padTop, baseLineH } = getLayoutMetrics(
        w,
        leftMargin,
        rightMargin,
        isPaperMode,
        curFmtRef.current.fontSize,
        paperTopPaddingPx,
      );
      const paperPageHeightPx =
        isPaperMode && paperHeightRatio && paperHeightRatio > 0 ? w * paperHeightRatio : null;
      const paperPageGapPx = isPaperMode ? 44 : 0;
      const clickX = clientX - rect.left - padLeft;
      const clickY = clientY - rect.top;

      const flatText = runsToText(runsRef.current);
      const imageDims = buildImageDimsMap();
      const { vls } = buildVisualLines(
        ctx,
        runsRef.current,
        flatText,
        curFmtRef.current,
        padLeft,
        textAreaWidth,
        padTop,
        baseLineH,
        scrollYRef.current,
        imageDims,
        paperPageHeightPx
          ? {
              pageHeightPx: paperPageHeightPx,
              pageGapPx: paperPageGapPx,
              bottomPaddingPx: paperBottomPaddingPx ?? padTop,
            }
          : undefined,
      );
      if (vls.length === 0) return 0;

      // Keep caret placement constrained to rendered content bounds.
      const firstLine = vls[0];
      const lastLine = vls[vls.length - 1];
      const contentTop = firstLine.y;
      const contentBottom = lastLine.y + lastLine.lineH;
      if (clickY < contentTop || clickY > contentBottom) return null;

      const best = getClosestVisualLine(vls, clickY);

      const imageMeta = best.imageMeta ?? null;
      if (imageMeta) {
        const dims = imageCacheRef.current.get(imageMeta.src);
        const metrics = getImageRenderMetrics(
          imageMeta,
          textAreaWidth,
          dims ? { w: dims.w, h: dims.h } : undefined,
        );
        const imageStartX = getAlignedXInTextArea(metrics.align, metrics.boxWidth, textAreaWidth);
        const imageMidX = imageStartX + metrics.boxWidth / 2;
        return resolveImageClickOffsetByWrap({
          wrap: imageMeta.wrap,
          text: flatText,
          imageStart: best.startOffset,
          imageEnd: best.endOffset,
          clickX,
          imageMidX,
        });
      }

      let lastOffset = best.startOffset;
      if (best.segs.length > 0 && clickX <= best.segs[0].x) {
        return best.startOffset;
      }

      for (let segIndex = 0; segIndex < best.segs.length; segIndex += 1) {
        const seg = best.segs[segIndex];
        const inlineImage = parseImageToken(seg.text);
          const tableMeta = parseTableToken(seg.text);
          if (tableMeta) {
            const metrics = getTableRenderMetrics(tableMeta, textAreaWidth, imageDims);
            const segStartX = seg.x;
            const segEndX = segStartX + metrics.boxWidth;
            if (clickX < segEndX) {
              const tokenStart = best.startOffset + (lastOffset - best.startOffset);
              const tokenEnd = tokenStart + seg.text.length;
              const tokenMidX = segStartX + metrics.boxWidth / 2;
              return clickX < tokenMidX ? tokenStart : tokenEnd;
            }
            lastOffset += seg.text.length;
            continue;
          }
        if (inlineImage && (isFlowingImageWrap(inlineImage.wrap) || isTextInFrontWrap(inlineImage.wrap))) {
          const dims = imageCacheRef.current.get(inlineImage.src);
          const metrics = getImageRenderMetrics(
            inlineImage,
            textAreaWidth,
            dims ? { w: dims.w, h: dims.h } : undefined,
          );
          const segStartX =
            best.segs.length === 1
              ? getAlignedXInTextArea(metrics.align, metrics.boxWidth, textAreaWidth)
              : seg.x;
          const segEndX = segStartX + metrics.boxWidth;
          let nextTextStartX: number | null = null;
          for (let nextIndex = segIndex + 1; nextIndex < best.segs.length; nextIndex += 1) {
            const nextSeg = best.segs[nextIndex];
            if (nextSeg.leading) continue;
            if (parseImageToken(nextSeg.text) || parseTableToken(nextSeg.text)) continue;
            nextTextStartX = nextSeg.x;
            break;
          }
          // If click is already near the first text segment to the right, do not
          // let the image token claim it. This keeps caret placement stable when
          // text sits at the bottom-right side of an inline image.
          const nearRightText = nextTextStartX !== null && clickX >= nextTextStartX - 2;
          if (clickX < segEndX && !nearRightText) {
            const imageStartOffset = best.startOffset + (lastOffset - best.startOffset);
            const imageEndOffset = imageStartOffset + seg.text.length;
            const imageMidX = segStartX + metrics.boxWidth / 2;
            return resolveImageClickOffsetByWrap({
              wrap: inlineImage.wrap,
              text: flatText,
              imageStart: imageStartOffset,
              imageEnd: imageEndOffset,
              clickX,
              imageMidX,
            });
          }
          lastOffset += seg.text.length;
          continue;
        }

        ctx.font = buildFont(seg.fmt.fontSize, seg.fmt.bold, seg.fmt.italic, seg.fmt.fontFamily);
        const segW = ctx.measureText(seg.text).width;
        const segStartX = seg.x;
        const segEndX = segStartX + segW;
        // Leading wrap-spaces are zero-advance: clicks anywhere within their
        // invisible zone fall through to the next visible segment rather than
        // landing in the invisible gap before the first word of the new line.
        if (seg.leading) {
          lastOffset += seg.text.length;
          continue;
        }
        if (clickX <= segEndX) {
          const clickXRelative = Math.max(0, Math.min(clickX - segStartX, segW));
          let nearestCol = 0;
          let nearestDistance = Number.POSITIVE_INFINITY;
          for (let ci = 0; ci <= seg.text.length; ci += 1) {
            const caretX = ctx.measureText(seg.text.slice(0, ci)).width;
            const distance = Math.abs(clickXRelative - caretX);
            if (distance < nearestDistance || (distance === nearestDistance && ci > nearestCol)) {
              nearestDistance = distance;
              nearestCol = ci;
            }
          }
          return best.startOffset + (lastOffset - best.startOffset) + nearestCol;
        }
        lastOffset += seg.text.length;
      }
      return best.endOffset;
    },
    [
      isPaperMode,
      leftMargin,
      rightMargin,
      canvasRef,
      runsRef,
      curFmtRef,
      scrollYRef,
      getAlignedXInTextArea,
      buildImageDimsMap,
      getClosestVisualLine,
    ],
  );

  const getImageBoxAtClientXY = useCallback(
    (clientX: number, clientY: number): ImageBox | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      return (
        imageBoxesRef.current.find(
          (box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height,
        ) ?? null
      );
    },
    [canvasRef],
  );

  const getImageBoxAtOffset = useCallback((offset: number): ImageBox | null => {
    return (
      imageBoxesRef.current.find(
        (box) =>
          offset === box.start || offset === box.end || (offset > box.start && offset < box.end),
      ) ?? null
    );
  }, []);

  const getTableHitAtClientXY = useCallback(
    (clientX: number, clientY: number): TableHit | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const box =
        tableBoxesRef.current.find(
          (item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height,
        ) ?? null;
      if (!box) return null;

      const localX = x - box.x;
      const localY = y - box.y;
      const column = getTrackIndexFromOffsets(box.columnOffsets, localX);
      const row = getTrackIndexFromOffsets(box.rowOffsets, localY);
      return { box, row, column };
    },
    [canvasRef, getTrackIndexFromOffsets],
  );

  const getTableBorderLineAtClientXY = useCallback(
    (clientX: number, clientY: number): TableLineHover | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const box =
        tableBoxesRef.current.find(
          (item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height,
        ) ?? null;
      if (!box) return null;

      const localX = x - box.x;
      const localY = y - box.y;
      const nearestRow = getNearestBorderIndex(box.rowOffsets, localY);
      const nearestColumn = getNearestBorderIndex(box.columnOffsets, localX);
      const rowDist = nearestRow.distance;
      const columnDist = nearestColumn.distance;
      // Keep resize hit area narrow so normal cell clicks enter edit mode reliably.
      const hoverThreshold = 3;

      if (rowDist > hoverThreshold && columnDist > hoverThreshold) return null;
      if (rowDist <= columnDist) {
        const segment = getTrackIndexFromOffsets(box.columnOffsets, localX);
        return { box, axis: 'row', index: nearestRow.index, segment };
      }
      const segment = getTrackIndexFromOffsets(box.rowOffsets, localY);
      return { box, axis: 'column', index: nearestColumn.index, segment };
    },
    [canvasRef, getNearestBorderIndex, getTrackIndexFromOffsets],
  );

  const getTableBoxAtOffset = useCallback((offset: number): TableBox | null => {
    return (
      tableBoxesRef.current.find(
        (box) =>
          offset === box.start || offset === box.end || (offset > box.start && offset < box.end),
      ) ?? null
    );
  }, []);

  const getResolvedImageBox = useCallback(
    (image: Pick<ImageBox, 'start' | 'end' | 'meta'> | null): ImageBox | null => {
      if (!image) return null;

      const boxes = imageBoxesRef.current;
      const byOffset = boxes.find(
        (box) =>
          box.start === image.start ||
          box.end === image.end ||
          (image.start >= box.start && image.start <= box.end),
      );
      if (byOffset) return byOffset;

      const targetMetaKey = imageMetaKey(image.meta);
      const metaMatches = boxes.filter((box) => imageMetaKey(box.meta) === targetMetaKey);
      if (metaMatches.length === 0) return null;

      return metaMatches.reduce((closest, box) => {
        const boxDistance = Math.abs(box.start - image.start);
        const closestDistance = Math.abs(closest.start - image.start);
        return boxDistance < closestDistance ? box : closest;
      });
    },
    [],
  );

  const getTableCellImageBox = useCallback(
    (tableStart: number, row: number, column: number, tokenRangeIndex = 0): ImageBox | null => {
      return (
        imageBoxesRef.current.find(
          (box) =>
            box.tableImage?.tableStart === tableStart &&
            box.tableImage?.row === row &&
            box.tableImage?.column === column &&
            box.tableImage?.tokenRangeIndex === tokenRangeIndex,
        ) ?? null
      );
    },
    [],
  );

  return {
    draw,
    resetBlink,
    getOffsetFromClientXY,
    getImageBoxAtClientXY,
    getImageBoxAtOffset,
    getResolvedImageBox,
    getTableHitAtClientXY,
    getTableBorderLineAtClientXY,
    getTableBoxAtOffset,
    getTableCellImageBox,
  };
}
