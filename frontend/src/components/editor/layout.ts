import {
  buildFont,
  detectBulletPrefix,
  parseImageToken,
  makeRun,
  type ImageAlign,
  type ImageTokenMeta,
  type Run,
  type RunFmt,
} from './textModel';
import { toRunFmt } from './runFmt';

// ── Visual layout types ───────────────────────────────────────────────────────
export type VisualSegment = { text: string; x: number; fmt: RunFmt };
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

export function getImageRenderMetrics(
  imageMeta: ImageTokenMeta,
  textAreaWidth: number,
  dims?: { w: number; h: number },
): ImageRenderMetrics {
  const effectiveAlign: ImageAlign = imageMeta.align;

  const maxW = textAreaWidth * (imageMeta.widthPct / 100);
  let drawWidth = maxW;
  let drawHeight = 200;
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
      const nextImg = text.indexOf('[[IMAGE', i);
      if (nextImg === -1) {
        appendTextTokens(text.slice(i), fmt);
        break;
      }

      if (nextImg > i) {
        appendTextTokens(text.slice(i, nextImg), fmt);
        i = nextImg;
      }

      const close = text.indexOf(']]', i);
      if (close === -1) {
        toks.push({ w: text.slice(i), space: false, fmt });
        break;
      }

      const token = text.slice(i, close + 2);
      if (parseImageToken(token)) {
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
  let curW = firstLineIndentPx;
  let curMaxW = maxWidth;

  const pushLine = () => {
    lines.push({ segs: curSegs, y: 0, startOffset: 0, endOffset: 0, lineH: 0 });
    curSegs = [];
    curW = hangIndentPx;
    curMaxW = maxWidth;
  };

  for (const tok of toks) {
    const imageMeta = parseImageToken(tok.w);
    if (imageMeta && (imageMeta.wrap === 'inline' || imageMeta.wrap === 'break')) {
      // Inline image: measure width
      const dims = imageSizes?.get(imageMeta.src);
      const metrics = getImageRenderMetrics(imageMeta, maxWidth, dims);

      if (imageMeta.position === 'fixed') {
        if (imageMeta.align === 'center') {
          // Keep image and surrounding text on the same line so the whole
          // inline group can be centered as one block.
          if (curW + metrics.boxWidth > curMaxW && curSegs.length > 0) pushLine();
          curSegs.push({ text: tok.w, x: curW, fmt: tok.fmt });
          curW += metrics.boxWidth;
          continue;
        }

        if (imageMeta.align === 'right') {
          // Keep image and surrounding text on the same line so the whole
          // inline group can be right-aligned as one block.
          if (curW + metrics.boxWidth > curMaxW && curSegs.length > 0) pushLine();
          curSegs.push({ text: tok.w, x: curW, fmt: tok.fmt });
          curW += metrics.boxWidth;
          continue;
        }

        // Fixed left: text continues on the right side.
        if (curSegs.length > 0) pushLine();
        curSegs.push({ text: tok.w, x: 0, fmt: tok.fmt });
        // Left-fixed image: text should start immediately to the right of the image.
        curW = metrics.boxWidth;
        curMaxW = maxWidth;
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

      if (curW + metrics.boxWidth > curMaxW && curSegs.length > 0) pushLine();
      curSegs.push({ text: tok.w, x: curW, fmt: tok.fmt });
      curW += metrics.boxWidth;
    } else {
      // Normal text
      ctx.font = buildFont(tok.fmt.fontSize, tok.fmt.bold, tok.fmt.italic, tok.fmt.fontFamily);
      const w = ctx.measureText(tok.w).width;
      if (curW + w > curMaxW && curSegs.length > 0) pushLine();
      curSegs.push({ text: tok.w, x: curW, fmt: tok.fmt });
      curW += w;
    }
  }
  if (curSegs.length > 0 || lines.length === 0) pushLine();

  // For fixed+center/right inline images, align the entire line content block
  // (image + adjacent text), not just the image rectangle.
  for (const line of lines) {
    const fixedInlineAlign = line.segs.reduce<'center' | 'right' | null>((acc, seg) => {
      if (acc) return acc;
      const meta = parseImageToken(seg.text);
      if (!meta || meta.position !== 'fixed' || (meta.wrap !== 'inline' && meta.wrap !== 'break')) {
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
      if (imageMeta && (imageMeta.wrap === 'inline' || imageMeta.wrap === 'break')) {
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
): { vls: VisualLine[]; baseLineH: number } {
  const paragraphs = flatText.split('\n');
  const vls: VisualLine[] = [];
  let flatOffset = 0;
  let yPos = padTop - scrollY;

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const paraLen = paragraphs[pi].length;
    const pRuns = extractParaRuns(runs, flatOffset, paraLen, curFmt);
    // Treat as block when image is fixed-position, or non-flow wrap.
    const imageMeta = parseImageToken(paragraphs[pi]);
    if (
      imageMeta &&
      (imageMeta.position === 'fixed' ||
        (imageMeta.wrap !== 'inline' && imageMeta.wrap !== 'break'))
    ) {
      const dims = imageSizes?.get(imageMeta.src);
      const metrics = getImageRenderMetrics(imageMeta, textAreaWidth, dims);
      const imageLineH = Math.ceil(metrics.boxHeight) + 16;
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
        if (!inlineMeta || (inlineMeta.wrap !== 'inline' && inlineMeta.wrap !== 'break')) continue;
        const dims = imageSizes?.get(inlineMeta.src);
        const metrics = getImageRenderMetrics(inlineMeta, textAreaWidth, dims);
        maxInlineImageHeight = Math.max(maxInlineImageHeight, metrics.boxHeight);
      }
      line.y = yPos;
      line.startOffset = flatOffset + charsSoFar;
      line.endOffset = flatOffset + charsSoFar + lineLen;
      line.lineH = Math.ceil(
        Math.max(
          12,
          ...line.segs.map((sg) => sg.fmt.fontSize * (sg.fmt.lineSpacing ?? 1.5)),
          maxInlineImageHeight,
        ),
      );
      vls.push(line);
      charsSoFar += lineLen;
      yPos += line.lineH;
    }
    flatOffset += paraLen + 1; // +1 for \n
  }

  return { vls, baseLineH };
}
