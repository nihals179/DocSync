import {
  buildFont,
  computeLineHeight,
  DEFAULT_RUN_FMT,
  getFormatAt,
  getImageTokenRanges,
  parseTableToken,
  runsToText,
  detectBulletPrefix,
  parseImageToken,
  parsePageBreakToken,
  makeRun,
  type ImageAlign,
  type ImageTokenMeta,
  type TableTokenMeta,
  type Run,
  type RunFmt,
} from './textModel';
import { toRunFmt } from './runFmt';
import {
  isBlockImageParagraphWrap,
  isFlowingImageWrap,
  isTextInFrontWrap,
  isWrapTextWrap,
} from './image/imageWrapMode';

// ── Visual layout types ───────────────────────────────────────────────────────
export type VisualSegment = {
  text: string;
  x: number;
  fmt: RunFmt;
  /** True for wrap-induced leading whitespace placed at x:0 with no curW advance.
   * Used by the draw/click paths to treat the segment as zero-width. */
  leading?: true;
};
export type VisualLine = {
  segs: VisualSegment[];
  y: number;
  startOffset: number;
  endOffset: number;
  lineH: number;
  imageMeta?: ImageTokenMeta;
};

export type ImageRenderMetrics = {
  align: ImageAlign;
  drawWidth: number;
  drawHeight: number;
  boxWidth: number;
  boxHeight: number;
};

export type TableRenderMetrics = {
  boxWidth: number;
  boxHeight: number;
  rowHeight: number;
  cellWidth: number;
  rowHeights: number[];
  columnWidths: number[];
  rowOffsets: number[];
  columnOffsets: number[];
};

export function getImageRenderMetrics(
  imageMeta: ImageTokenMeta,
  textAreaWidth: number,
  dims?: { w: number; h: number },
): ImageRenderMetrics {
  const effectiveAlign: ImageAlign = imageMeta.align;

  const maxW = textAreaWidth * (imageMeta.widthPct / 100);
  let drawWidth = maxW;
  let drawHeight = Math.max(32, Math.min(160, maxW * 0.75));
  if (dims && dims.w > 0 && dims.h > 0) {
    const scaleW = maxW / dims.w;
    drawWidth = Math.max(1, dims.w * scaleW);
    drawHeight = Math.max(1, dims.h * scaleW);
  }

  const rad = (imageMeta.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let boxWidth = Math.max(1, Math.abs(drawWidth * cos) + Math.abs(drawHeight * sin));
  let boxHeight = Math.max(1, Math.abs(drawWidth * sin) + Math.abs(drawHeight * cos));

  // Ensure rotated bounds still obey available width/margins.
  if (boxWidth > textAreaWidth) {
    const fitScale = textAreaWidth / boxWidth;
    drawWidth = Math.max(1, drawWidth * fitScale);
    drawHeight = Math.max(1, drawHeight * fitScale);
    boxWidth = Math.max(1, Math.abs(drawWidth * cos) + Math.abs(drawHeight * sin));
    boxHeight = Math.max(1, Math.abs(drawWidth * sin) + Math.abs(drawHeight * cos));
  }

  return { align: effectiveAlign, drawWidth, drawHeight, boxWidth, boxHeight };
}

export function getTableRenderMetrics(
  tableMeta: TableTokenMeta,
  textAreaWidth: number,
  imageSizes?: Map<string, { w: number; h: number }>,
): TableRenderMetrics {
  const cols = Math.max(1, tableMeta.columns);
  const rows = Math.max(1, tableMeta.rows);
  const horizontalPadding = 16;
  const available = Math.max(140, textAreaWidth - horizontalPadding);
  const fallbackColumnWidth = Math.max(72, Math.min(140, Math.floor(available / cols)));
  const legacyColumnWidth = tableMeta.widthPx === undefined ? fallbackColumnWidth : Math.floor(tableMeta.widthPx / cols);
  let columnWidths = Array.from({ length: cols }, (_, index) =>
    Math.max(48, Math.min(960, Math.round(tableMeta.columnWidthsPx?.[index] ?? legacyColumnWidth))),
  );
  const rowHeights = Array.from({ length: rows }, (_, index) =>
    Math.max(24, Math.round(tableMeta.rowHeightsPx?.[index] ?? tableMeta.rowHeightPx ?? 30)),
  );

  const columnContentMinWidths = Array.from({ length: cols }, () => 0);
  const rowContentMinHeights = Array.from({ length: rows }, () => 0);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < cols; column++) {
      const cellRuns = tableMeta.cells?.[row]?.[column] ?? [];
      const cellValue = runsToText(cellRuns);
      const fmt = cellRuns[0] ? { ...DEFAULT_RUN_FMT, ...cellRuns[0] } : { ...DEFAULT_RUN_FMT };
      const imageRanges = getImageTokenRanges(cellValue);
      let cursor = 0;
      let maxTextLineWidth = 0;
      let textLineCount = 0;
      let textHeightTotal = 0;
      // Break/inline images stack vertically with text (heights add).
      let stackedImageHeight = 0;
      // Wrap-text images sit beside text (height = max of image vs text, not sum).
      let wrapImageMaxHeight = 0;
      let hasAnyContent = false;

      const measureTextBlock = (value: string, blockStartOffset: number) => {
        const lines = value.split('\n');
        let consumed = 0;
        lines.forEach((line, lineIndex) => {
          if (line.length > 0) hasAnyContent = true;
          const lineStartOffset = blockStartOffset + consumed;
          const probeOffset =
            line.length > 0
              ? Math.max(0, Math.min(cellValue.length, lineStartOffset + 1))
              : lineStartOffset;
          const lineFmt = { ...DEFAULT_RUN_FMT, ...getFormatAt(cellRuns, probeOffset) };
          const charW = Math.max(6, lineFmt.fontSize * 0.55);
          const wrapWidth = Math.max(12, (columnWidths[column] ?? fallbackColumnWidth) - 12);
          const charsPerLine = Math.max(1, Math.floor(wrapWidth / charW));
          const visualLineCount = Math.max(1, Math.ceil(line.length / charsPerLine));
          const estimatedWidth = Math.ceil(Math.min(line.length, charsPerLine) * charW);
          maxTextLineWidth = Math.max(maxTextLineWidth, estimatedWidth);
          textLineCount += visualLineCount;
          textHeightTotal +=
            computeLineHeight(lineFmt.fontSize, lineFmt.lineSpacing ?? 1.5) * visualLineCount;
          consumed += line.length + (lineIndex < lines.length - 1 ? 1 : 0);
        });
      };

      for (const range of imageRanges) {
        if (range.start > cursor) {
          measureTextBlock(cellValue.slice(cursor, range.start), cursor);
        }

        const token = cellValue.slice(range.start, range.end);
        const imageMeta = parseImageToken(token);
        if (imageMeta) {
          hasAnyContent = true;
          const estimatedCellWidth = Math.max(12, (columnWidths[column] ?? fallbackColumnWidth) - 12);
          const dims = imageSizes?.get(imageMeta.src);
          const imageMetrics = getImageRenderMetrics(imageMeta, estimatedCellWidth, dims);
          maxTextLineWidth = Math.max(maxTextLineWidth, Math.ceil(imageMetrics.drawWidth));
          // Front-wrap images are visual overlays — no height contribution.
          // Wrap-text images sit beside text — height is max(imageH, textH), not their sum.
          // Break/inline images stack vertically with text — heights add.
          if (isWrapTextWrap(imageMeta.wrap)) {
            wrapImageMaxHeight = Math.max(wrapImageMaxHeight, Math.ceil(imageMetrics.drawHeight));
          } else if (!isTextInFrontWrap(imageMeta.wrap)) {
            stackedImageHeight += Math.ceil(imageMetrics.drawHeight) + 6;
          }
        }
        cursor = range.end;
      }

      if (cursor < cellValue.length) {
        measureTextBlock(cellValue.slice(cursor), cursor);
      }

      if (!hasAnyContent) {
        textLineCount = Math.max(1, textLineCount);
        if (textHeightTotal <= 0) {
          textHeightTotal = computeLineHeight(fmt.fontSize, fmt.lineSpacing ?? 1.5);
        }
      }

      const textHeight = textLineCount > 0 ? textHeightTotal : 0;
      const minCellWidth = Math.max(48, maxTextLineWidth + 12);
      // For wrap-text images: the image and text share vertical space (max, not sum).
      // For stacked images (break/inline): their heights add to text height.
      const minCellHeight = Math.max(24, Math.max(textHeight + stackedImageHeight, wrapImageMaxHeight) + 8);

      columnContentMinWidths[column] = Math.max(columnContentMinWidths[column], minCellWidth);
      rowContentMinHeights[row] = Math.max(rowContentMinHeights[row], minCellHeight);
    }
  }

  columnWidths = columnWidths.map((width, index) =>
    Math.max(width, columnContentMinWidths[index]),
  );

  const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  if (totalColumnWidth > available) {
    const scale = available / totalColumnWidth;
    columnWidths = columnWidths.map((width) => Math.max(48, Math.round(width * scale)));

    let overflow = columnWidths.reduce((sum, width) => sum + width, 0) - available;
    while (overflow > 0) {
      let maxIndex = -1;
      let maxWidth = 0;
      for (let i = 0; i < columnWidths.length; i++) {
        if (columnWidths[i] > maxWidth && columnWidths[i] > 48) {
          maxWidth = columnWidths[i];
          maxIndex = i;
        }
      }
      if (maxIndex === -1) break;
      columnWidths[maxIndex] -= 1;
      overflow -= 1;
    }
  }

  for (let index = 0; index < rowHeights.length; index++) {
    if (rowContentMinHeights[index] > 0) {
      rowHeights[index] = Math.max(rowHeights[index], rowContentMinHeights[index]);
    }
  }

  const columnOffsets = [0];
  for (const width of columnWidths) columnOffsets.push(columnOffsets[columnOffsets.length - 1] + width);
  const rowOffsets = [0];
  for (const height of rowHeights) rowOffsets.push(rowOffsets[rowOffsets.length - 1] + height);
  const boxWidth = columnOffsets[columnOffsets.length - 1] + 1;
  const boxHeight = rowOffsets[rowOffsets.length - 1] + 1;
  return {
    boxWidth,
    boxHeight,
    rowHeight: rowHeights[0] ?? 30,
    cellWidth: columnWidths[0] ?? fallbackColumnWidth,
    rowHeights,
    columnWidths,
    rowOffsets,
    columnOffsets,
  };
}

/**
 * Word-wrap the runs of a single paragraph into visual lines with
 * x-positioned segments. Purely functional — no side-effects.
 */
export function layoutParagraph(
  ctx: CanvasRenderingContext2D,
  paraRuns: Run[],
  maxWidth: number,
  /** Pixel offset continuation lines start at (hanging-indent for bullets) */
  hangIndentPx = 0,
  /** Pixel offset for the first line (standard indent for bullets) */
  firstLineIndentPx = 0,
  imageSizes?: Map<string, { w: number; h: number }>,
  breakFlow?: { leftEndPx: number; rightStartPx: number; remainingLines: number },
): VisualLine[] {
  type Tok = { w: string; space: boolean; fmt: RunFmt };
  const toks: Tok[] = [];
  const appendTextTokens = (text: string, fmt: RunFmt) => {
    if (!text) return;
    const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
    for (const part of parts) {
      toks.push({ w: part, space: /^\s+$/.test(part), fmt });
    }
  };

  for (const run of paraRuns) {
    const { text, ...fmt } = run;
    if (text === '') {
      toks.push({ w: '', space: false, fmt });
      continue;
    }
    let i = 0;
    while (i < text.length) {
      const nextToken = text.indexOf('[[', i);
      if (nextToken === -1) {
        appendTextTokens(text.slice(i), fmt);
        break;
      }

      if (nextToken > i) {
        appendTextTokens(text.slice(i, nextToken), fmt);
        i = nextToken;
      }

      const close = text.indexOf(']]', i);
      if (close === -1) {
        toks.push({ w: text.slice(i), space: false, fmt });
        break;
      }

      const token = text.slice(i, close + 2);
      if (parseImageToken(token) || parseTableToken(token)) {
        toks.push({ w: token, space: false, fmt });
        i = close + 2;
      } else {
        // Not a valid image token; advance by one char to avoid stalling.
        appendTextTokens(text.slice(i, i + 1), fmt);
        i += 1;
      }
    }
  }

  const lines: VisualLine[] = [];
  let curSegs: VisualSegment[] = [];
  let breakLeftEndPx = breakFlow?.leftEndPx ?? 0;
  let breakRightStartPx = breakFlow?.rightStartPx ?? maxWidth;
  let breakLinesRemaining = breakFlow?.remainingLines ?? 0;
  let isFirstVisualLine = true;
  let lineRegions: Array<{ start: number; end: number }> = [];
  let regionIndex = 0;
  let curW = 0;
  // True immediately after a pushLine() so leading spaces on a fresh wrapped
  // line are anchored at x:0 without advancing curW (avoids indent) while still
  // being counted in character offsets (needed for correct cursor placement).
  let atLineStart = false;

  const applyLineRegions = () => {
    const baseStart = isFirstVisualLine ? firstLineIndentPx : hangIndentPx;
    const nextRegions: Array<{ start: number; end: number }> = [];

    if (breakLinesRemaining > 0) {
      const leftStart = Math.max(0, baseStart);
      const leftEnd = Math.min(maxWidth, Math.max(leftStart, breakLeftEndPx));
      const rightStart = Math.min(maxWidth, Math.max(baseStart, breakRightStartPx));
      const rightEnd = maxWidth;

      if (leftEnd - leftStart >= 20) nextRegions.push({ start: leftStart, end: leftEnd });
      if (rightEnd - rightStart >= 20) nextRegions.push({ start: rightStart, end: rightEnd });
    }

    if (nextRegions.length === 0) {
      nextRegions.push({ start: Math.max(0, baseStart), end: maxWidth });
    }

    lineRegions = nextRegions;
    regionIndex = 0;
    curW = lineRegions[0].start;
  };

  applyLineRegions();

  const pushLine = () => {
    lines.push({ segs: curSegs, y: 0, startOffset: 0, endOffset: 0, lineH: 0 });
    curSegs = [];
    if (breakLinesRemaining > 0) breakLinesRemaining -= 1;
    isFirstVisualLine = false;
    applyLineRegions();
    atLineStart = true;
  };

  const getAlignedImageX = (align: ImageAlign, boxWidth: number) =>
    align === 'right'
      ? Math.max(0, maxWidth - boxWidth)
      : align === 'center'
        ? Math.max(0, (maxWidth - boxWidth) / 2)
        : 0;

  const placeBreakLineImage = (tokenText: string, fmt: RunFmt, imageMeta: ImageTokenMeta) => {
    const dims = imageSizes?.get(imageMeta.src);
    const metrics = getImageRenderMetrics(imageMeta, maxWidth, dims);
    if (curSegs.length > 0) pushLine();
    curSegs.push({ text: tokenText, x: getAlignedImageX(imageMeta.align, metrics.boxWidth), fmt });
    // Break-line mode is block-only: text continues only above and below.
    pushLine();
  };

  const placeWrapTextImage = (tokenText: string, fmt: RunFmt, imageMeta: ImageTokenMeta) => {
    const dims = imageSizes?.get(imageMeta.src);
    const metrics = getImageRenderMetrics(imageMeta, maxWidth, dims);
    if (curSegs.length > 0) pushLine();
    const imageX = getAlignedImageX(imageMeta.align, metrics.boxWidth);
    curSegs.push({ text: tokenText, x: imageX, fmt });

    // Wrap-text mode: text flows around image on both sides for image height.
    const approxLineH = computeLineHeight(fmt.fontSize, fmt.lineSpacing ?? 1.5);
    breakLinesRemaining = Math.max(1, Math.ceil(metrics.boxHeight / approxLineH));
    breakLeftEndPx = Math.max(0, imageX - 8);
    breakRightStartPx = Math.min(maxWidth, imageX + metrics.boxWidth + 8);
    applyLineRegions();
  };

  const placeFrontTextImage = (tokenText: string, fmt: RunFmt, imageMeta: ImageTokenMeta) => {
    // Keep image as a visual overlay and preserve normal text flow width.
    const dims = imageSizes?.get(imageMeta.src);
    const metrics = getImageRenderMetrics(imageMeta, maxWidth, dims);
    const imageX = getAlignedImageX(imageMeta.align, metrics.boxWidth);
    curSegs.push({ text: tokenText, x: imageX, fmt });
  };

  const placeTable = (tokenText: string, fmt: RunFmt, tableMeta: TableTokenMeta) => {
    const metrics = getTableRenderMetrics(tableMeta, maxWidth, imageSizes);
    if (curSegs.length > 0) pushLine();
    const tableX =
      (fmt.textAlign ?? 'left') === 'right'
        ? Math.max(0, maxWidth - metrics.boxWidth)
        : (fmt.textAlign ?? 'left') === 'center'
          ? Math.max(0, (maxWidth - metrics.boxWidth) / 2)
          : 0;
    curSegs.push({ text: tokenText, x: tableX, fmt });
    if (metrics.boxHeight > 0) {
      // Force table to occupy a dedicated visual line block.
      pushLine();
    }
  };

  for (const tok of toks) {
    const tableMeta = parseTableToken(tok.w);
    if (tableMeta) {
      placeTable(tok.w, tok.fmt, tableMeta);
      continue;
    }

    const imageMeta = parseImageToken(tok.w);
    if (imageMeta && isTextInFrontWrap(imageMeta.wrap)) {
      placeFrontTextImage(tok.w, tok.fmt, imageMeta);
      continue;
    }

    if (imageMeta && isFlowingImageWrap(imageMeta.wrap)) {
      // Inline image: measure width
      const dims = imageSizes?.get(imageMeta.src);
      const metrics = getImageRenderMetrics(imageMeta, maxWidth, dims);

      if (imageMeta.wrap === 'break') {
        placeBreakLineImage(tok.w, tok.fmt, imageMeta);
        continue;
      }

      if (imageMeta.wrap === 'wrap') {
        placeWrapTextImage(tok.w, tok.fmt, imageMeta);
        continue;
      }

      const isCenteredOrRight = imageMeta.align === 'center' || imageMeta.align === 'right';

      // When aligned center/right, place image on its own aligned line so
      // surrounding text flows above/below according to image alignment.
      if (isCenteredOrRight) {
        if (curSegs.length > 0) pushLine();
        const alignedX =
          imageMeta.align === 'right'
            ? Math.max(0, maxWidth - metrics.boxWidth)
            : Math.max(0, (maxWidth - metrics.boxWidth) / 2);
        curSegs.push({ text: tok.w, x: alignedX, fmt: tok.fmt });
        pushLine();
        continue;
      }

      let currentRegion = lineRegions[regionIndex];
      while (
        curW + metrics.boxWidth > currentRegion.end &&
        curSegs.length > 0 &&
        regionIndex < lineRegions.length - 1
      ) {
        regionIndex += 1;
        currentRegion = lineRegions[regionIndex];
        curW = currentRegion.start;
      }
      if (curW + metrics.boxWidth > currentRegion.end && curSegs.length > 0) {
        pushLine();
      }
      curSegs.push({ text: tok.w, x: curW, fmt: tok.fmt });
      curW += metrics.boxWidth;
    } else {
      // Normal text
      ctx.font = buildFont(tok.fmt.fontSize, tok.fmt.bold, tok.fmt.italic, tok.fmt.fontFamily);
      const w = ctx.measureText(tok.w).width;
      let currentRegion = lineRegions[regionIndex];
      while (curW + w > currentRegion.end && curSegs.length > 0 && regionIndex < lineRegions.length - 1) {
        regionIndex += 1;
        currentRegion = lineRegions[regionIndex];
        curW = currentRegion.start;
      }
      if (curW + w > currentRegion.end && curSegs.length > 0) {
        pushLine(); // atLineStart = true
        if (tok.space) {
          // Space was the wrap trigger; anchor it at position 0 of the new line
          // so it is counted in character offsets (correct cursor mapping) but
          // does NOT advance curW. Mark as leading so caret/click treat it as
          // zero-width and never visually indent the next word.
          curSegs.push({ text: tok.w, x: 0, fmt: tok.fmt, leading: true });
          continue;
        }
      }
      if (tok.space && atLineStart) {
        // Additional leading space(s) at the start of a fresh wrapped line.
        // Include for offset tracking but keep at x:0 without advancing curW.
        curSegs.push({ text: tok.w, x: 0, fmt: tok.fmt, leading: true });
        continue; // atLineStart remains true for any further leading spaces
      }
      atLineStart = false;
      curSegs.push({ text: tok.w, x: curW, fmt: tok.fmt });
      curW += w;
    }
  }
  if (curSegs.length > 0 || lines.length === 0) pushLine();

  // For center/right inline images, align the entire line content block
  // (image + adjacent text), not just the image rectangle.
  for (const line of lines) {
    const fixedInlineAlign = line.segs.reduce<'center' | 'right' | null>((acc, seg) => {
      if (acc) return acc;
      const meta = parseImageToken(seg.text);
      if (!meta || meta.wrap !== 'inline') {
        return null;
      }
      if (meta.align === 'center' || meta.align === 'right') return meta.align;
      return null;
    }, null);
    if (!fixedInlineAlign || line.segs.length === 0) continue;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    for (const seg of line.segs) {
      const imageMeta = parseImageToken(seg.text);
      if (imageMeta && imageMeta.wrap === 'inline') {
        const dims = imageSizes?.get(imageMeta.src);
        const metrics = getImageRenderMetrics(imageMeta, maxWidth, dims);
        minX = Math.min(minX, seg.x);
        maxX = Math.max(maxX, seg.x + metrics.boxWidth);
        continue;
      }

      ctx.font = buildFont(seg.fmt.fontSize, seg.fmt.bold, seg.fmt.italic, seg.fmt.fontFamily);
      const width = ctx.measureText(seg.text).width;
      minX = Math.min(minX, seg.x);
      maxX = Math.max(maxX, seg.x + width);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) continue;
    const contentW = maxX - minX;
    if (contentW >= maxWidth) continue;

    const targetMinX =
      fixedInlineAlign === 'center' ? (maxWidth - contentW) / 2 : maxWidth - contentW;
    const shift = targetMinX - minX;
    if (Math.abs(shift) < 0.5) continue;
    for (const seg of line.segs) {
      seg.x += shift;
    }
  }

  return lines;
}

/** Slice runs covering [offset, offset+len) and return as a fresh array */
export function extractParaRuns(
  runs: Run[],
  offset: number,
  len: number,
  fallbackFmt: RunFmt,
): Run[] {
  if (len === 0) return [makeRun('', fallbackFmt)];
  const result: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const rEnd = pos + r.text.length;
    if (rEnd <= offset) {
      pos = rEnd;
      continue;
    }
    if (pos >= offset + len) break;
    const sliceStart = Math.max(0, offset - pos);
    const sliceEnd = Math.min(r.text.length, offset + len - pos);
    result.push({ ...r, text: r.text.slice(sliceStart, sliceEnd) });
    pos = rEnd;
  }
  return result.length > 0 ? result : [makeRun('', fallbackFmt)];
}

/** Build all visual lines for the entire document. Shared by draw() and hit-testing. */
export function buildVisualLines(
  ctx: CanvasRenderingContext2D,
  runs: Run[],
  flatText: string,
  curFmt: RunFmt,
  _padLeft: number,
  textAreaWidth: number,
  padTop: number,
  baseLineH: number,
  scrollY: number,
  imageSizes?: Map<string, { w: number; h: number }>,
  pagination?: { pageHeightPx: number; pageGapPx: number; bottomPaddingPx: number },
): {
  vls: VisualLine[];
  baseLineH: number;
  pageCount: number;
  totalHeightPx: number;
  pageHeightPx: number | null;
  pageGapPx: number;
} {
  const paragraphs = flatText.split('\n');
  const vls: VisualLine[] = [];
  let flatOffset = 0;
  let yPos = padTop - scrollY;
  const pageHeightPx = pagination?.pageHeightPx ?? 0;
  const pageGapPx = pagination?.pageGapPx ?? 0;
  const bottomPaddingPx = pagination?.bottomPaddingPx ?? padTop;
  const hasPagination = pageHeightPx > 0;

  const pageStride = pageHeightPx + pageGapPx;
  const getPageTopY = (pageIndex: number) => padTop - scrollY + pageStride * pageIndex;
  const getPageIndexForY = (y: number) => {
    if (!hasPagination || pageStride <= 0) return 0;
    return Math.max(0, Math.floor((y - (padTop - scrollY)) / pageStride));
  };
  const getPageContentBottomY = (pageIndex: number) => {
    if (!hasPagination) return Number.POSITIVE_INFINITY;
    return getPageTopY(pageIndex) + pageHeightPx - bottomPaddingPx;
  };
  const moveToNextPage = () => {
    if (!hasPagination) return;
    const pageIndex = getPageIndexForY(yPos);
    yPos = getPageTopY(pageIndex + 1);
  };
  const ensureBlockFitsCurrentPage = (blockHeight: number) => {
    if (!hasPagination) return;
    const pageIndex = getPageIndexForY(yPos);
    const pageTopY = getPageTopY(pageIndex);
    const pageBottomY = getPageContentBottomY(pageIndex);
    // Allow oversized blocks at page start; otherwise push to next page.
    if (yPos + blockHeight > pageBottomY && yPos > pageTopY + 0.5) {
      yPos = getPageTopY(pageIndex + 1);
    }
  };
  let activeBreakFlow: {
    leftEndPx: number;
    rightStartPx: number;
    remainingLines: number;
  } | null = null;
  // Keep a small breathing room at the bottom so Enter/new lines do not hug page edge.
  const linePaginationReservePx = Math.max(8, Math.round(baseLineH * 0.55));

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const paraLen = paragraphs[pi].length;
    if (parsePageBreakToken(paragraphs[pi])) {
      moveToNextPage();
      flatOffset += paraLen + 1;
      activeBreakFlow = null;
      continue;
    }
    const pRuns = extractParaRuns(runs, flatOffset, paraLen, curFmt);
    const tableMeta = parseTableToken(paragraphs[pi]);
    if (tableMeta) {
      activeBreakFlow = null;
      const metrics = getTableRenderMetrics(tableMeta, textAreaWidth, imageSizes);
      const tableLineH = Math.ceil(metrics.boxHeight) + 16;
      ensureBlockFitsCurrentPage(tableLineH + 8);
      let firstFmt: RunFmt = curFmt;
      if (pRuns[0]) {
        firstFmt = toRunFmt(pRuns[0]);
      }
      vls.push({
        segs: [{ text: paragraphs[pi], x: 0, fmt: firstFmt }],
        y: yPos,
        startOffset: flatOffset,
        endOffset: flatOffset + paraLen,
        lineH: tableLineH,
      });
      yPos += tableLineH + 8;
      flatOffset += paraLen + 1;
      continue;
    }
    // Treat as block for non-flow wrap.
    const imageMeta = parseImageToken(paragraphs[pi]);
    if (imageMeta && isBlockImageParagraphWrap(imageMeta.wrap)) {
      activeBreakFlow = null;
      const dims = imageSizes?.get(imageMeta.src);
      const metrics = getImageRenderMetrics(imageMeta, textAreaWidth, dims);
      const imageLineH = Math.ceil(metrics.boxHeight) + 16;
      ensureBlockFitsCurrentPage(imageLineH + 8);
      let firstFmt: RunFmt = curFmt;
      if (pRuns[0]) {
        firstFmt = toRunFmt(pRuns[0]);
      }
      vls.push({
        segs: [{ text: paragraphs[pi], x: 0, fmt: firstFmt }],
        y: yPos,
        startOffset: flatOffset,
        endOffset: flatOffset + paraLen,
        lineH: imageLineH,
        imageMeta,
      });
      yPos += imageLineH + 8;
      flatOffset += paraLen + 1;
      continue;
    }
    // Compute standard indentation for bullet paragraphs.
    // Each nesting level shifts the paragraph rightward by a fixed amount.
    // Continuation lines wrap-align to where the text starts (after bullet char).
    let hangIndentPx = 0;
    let firstLineIndentPx = 0;
    let paraWrapWidth = textAreaWidth;
    const INDENT_PX = Math.max(20, textAreaWidth * 0.05); // 5% indent per nesting level
    const BULLET_GAP_PX = 12; // Extra visual gap between bullet marker and text
    const BULLET_RIGHT_PAD_PX = 8; // Extra right breathing room for bullet paragraphs
    let bulletPrefixLen = 0;
    let appliedBulletGapPx = 0;
    {
      const paraStr = paragraphs[pi];
      let indentEnd = 0;
      while (indentEnd < paraStr.length && paraStr[indentEnd] === ' ') indentEnd++;
      const indentLevel = Math.floor(indentEnd / 2); // 2 spaces = 1 indent level
      const detectedPrefix = detectBulletPrefix(paraStr);
      if (detectedPrefix.hasBullet) {
        // Target position where text (after bullet) should start
        const baseTextStart = INDENT_PX * (indentLevel + 1);
        // Measure the natural pixel width of the full prefix (indent spaces + bullet + space)
        const fr = pRuns[0];
        ctx.font = buildFont(fr.fontSize, fr.bold, fr.italic, fr.fontFamily);
        const prefixLen = detectedPrefix.prefixLen;
        bulletPrefixLen = prefixLen;
        appliedBulletGapPx = BULLET_GAP_PX;
        const naturalPrefixWidth = ctx.measureText(paraStr.slice(0, prefixLen)).width;
        // Shift all first-line content so the text after the prefix lands at targetTextStart
        firstLineIndentPx = baseTextStart - naturalPrefixWidth;
        // Continuation lines align with first-line text after bullet gap
        hangIndentPx = baseTextStart + appliedBulletGapPx;
        paraWrapWidth = Math.max(40, textAreaWidth - BULLET_RIGHT_PAD_PX);
      }
    }

    const lines = layoutParagraph(
      ctx,
      pRuns,
      paraWrapWidth,
      hangIndentPx,
      firstLineIndentPx,
      imageSizes,
      activeBreakFlow ?? undefined,
    );
    // Add explicit visual gap after bullet prefix on the first visual line.
    if (bulletPrefixLen > 0 && lines.length > 0) {
      let charsAcc = 0;
      for (const seg of lines[0].segs) {
        const segStart = charsAcc;
        const segEnd = charsAcc + seg.text.length;
        if (segStart >= bulletPrefixLen) seg.x += appliedBulletGapPx;
        charsAcc = segEnd;
      }
    }
    let charsSoFar = 0;
    for (const line of lines) {
      const lineLen = line.segs.reduce((s, sg) => s + sg.text.length, 0);
      let maxInlineImageHeight = 0;
      for (const sg of line.segs) {
        const inlineMeta = parseImageToken(sg.text);
        if (!inlineMeta || inlineMeta.wrap !== 'inline') continue;
        const dims = imageSizes?.get(inlineMeta.src);
        const metrics = getImageRenderMetrics(inlineMeta, textAreaWidth, dims);
        maxInlineImageHeight = Math.max(maxInlineImageHeight, metrics.boxHeight);
      }
      let maxTableHeight = 0;
      for (const sg of line.segs) {
        const table = parseTableToken(sg.text);
        if (!table) continue;
        const metrics = getTableRenderMetrics(table, textAreaWidth, imageSizes);
        maxTableHeight = Math.max(maxTableHeight, metrics.boxHeight);
      }
      line.lineH = Math.ceil(
        Math.max(
          12,
          ...line.segs.map((sg) => computeLineHeight(sg.fmt.fontSize, sg.fmt.lineSpacing ?? 1.5)),
          maxInlineImageHeight,
          maxTableHeight,
        ),
      );
      ensureBlockFitsCurrentPage(line.lineH + linePaginationReservePx);
      line.y = yPos;
      line.startOffset = flatOffset + charsSoFar;
      line.endOffset = flatOffset + charsSoFar + lineLen;
      vls.push(line);
      charsSoFar += lineLen;
      yPos += line.lineH;
    }

    let wrapPlacement: { meta: ImageTokenMeta; x: number } | null = null;
    for (const line of lines) {
      for (const seg of line.segs) {
        const meta = parseImageToken(seg.text);
        if (meta && meta.wrap === 'wrap') {
          wrapPlacement = { meta, x: seg.x };
          break;
        }
      }
      if (wrapPlacement) break;
    }

    if (wrapPlacement) {
      const dims = imageSizes?.get(wrapPlacement.meta.src);
      const metrics = getImageRenderMetrics(wrapPlacement.meta, textAreaWidth, dims);
      const refLineH = Math.max(1, lines[0]?.lineH ?? baseLineH);
      const totalWrapLines = Math.max(1, Math.ceil(metrics.boxHeight / refLineH));
      const remainingLines = Math.max(0, totalWrapLines - lines.length);
      activeBreakFlow =
        remainingLines > 0
          ? {
              leftEndPx: Math.max(0, wrapPlacement.x - 8),
              rightStartPx: Math.min(textAreaWidth, wrapPlacement.x + metrics.boxWidth + 8),
              remainingLines,
            }
          : null;
    } else if (activeBreakFlow && activeBreakFlow.remainingLines > 0) {
      const nextRemaining = Math.max(0, activeBreakFlow.remainingLines - lines.length);
      activeBreakFlow = {
        leftEndPx: activeBreakFlow.leftEndPx,
        rightStartPx: activeBreakFlow.rightStartPx,
        remainingLines: nextRemaining,
      };
      if (activeBreakFlow.remainingLines === 0) activeBreakFlow = null;
    } else {
      activeBreakFlow = null;
    }

    flatOffset += paraLen + 1; // +1 for \n
  }

  const lastBottomY =
    vls.length > 0 ? vls[vls.length - 1].y + vls[vls.length - 1].lineH : padTop - scrollY;
  if (hasPagination && pageStride > 0) {
    const relativeBottom = Math.max(0, lastBottomY - (padTop - scrollY));
    const pageCount = Math.max(1, Math.floor(relativeBottom / pageStride) + 1);
    const totalHeightPx = pageCount * pageHeightPx + Math.max(0, pageCount - 1) * pageGapPx;
    return { vls, baseLineH, pageCount, totalHeightPx, pageHeightPx, pageGapPx };
  }

  const totalHeightPx = Math.max(0, lastBottomY - (padTop - scrollY));
  return { vls, baseLineH, pageCount: 1, totalHeightPx, pageHeightPx: null, pageGapPx: 0 };
}
