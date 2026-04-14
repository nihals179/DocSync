import { useCallback, useEffect, useRef } from 'react';
import {
  buildFont,
  runsToText,
  type Run,
  type RunFmt,
  getImageTokenRanges,
  parseImageToken,
} from './textModel';
import { buildVisualLines, getImageRenderMetrics, type VisualLine } from './layout';
import { getLayoutMetrics, imageMetaKey } from './drawHelpers';
import {
  isBreakLineWrap,
  isFlowingImageWrap,
  isInlineWrap,
  isTextInFrontWrap,
  resolveImageClickOffsetByWrap,
  isWrapTextWrap,
} from './image/imageWrapMode';

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
};

export interface DrawRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  runsRef: React.MutableRefObject<Run[]>;
  cursorRef: React.MutableRefObject<number>;
  selStartRef: React.MutableRefObject<number | null>;
  scrollYRef: React.MutableRefObject<number>;
  blinkRef: React.MutableRefObject<boolean>;
  blinkTimerRef: React.MutableRefObject<number | null>;
  curFmtRef: React.MutableRefObject<RunFmt>;
}

/** Returns the `draw` callback and a `resetBlink` helper */
export function useEditorDraw(
  refs: DrawRefs,
  leftMargin: number,
  rightMargin: number,
  isPaperMode: boolean,
) {
  type CachedImage = { drawable: CanvasImageSource; w: number; h: number };
  const imageCacheRef = useRef<Map<string, CachedImage>>(new Map());
  const imagePendingRef = useRef<Set<string>>(new Set());
  const imageBoxesRef = useRef<ImageBox[]>([]);

  const {
    canvasRef,
    runsRef,
    cursorRef,
    selStartRef,
    scrollYRef,
    blinkRef,
    blinkTimerRef,
    curFmtRef,
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

    const { padLeft, textAreaWidth, padTop, baseLineH } = getLayoutMetrics(
      w,
      leftMargin,
      rightMargin,
      isPaperMode,
      curFmtRef.current.fontSize,
    );

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
          draw();
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
    );
    const hasSelection = selStartRef.current !== null && selStartRef.current !== cursorRef.current;
    const selFrom = hasSelection ? Math.min(selStartRef.current!, cursorRef.current) : 0;
    const selTo = hasSelection ? Math.max(selStartRef.current!, cursorRef.current) : 0;
    imageBoxesRef.current = [];

    if (vls.length > 0) {
      const last = vls[vls.length - 1];
      const contentBottomY = last.y + last.lineH;
      const maxScroll = Math.max(0, contentBottomY + scrollYRef.current - h + 8);
      if (scrollYRef.current > maxScroll) {
        scrollYRef.current = maxScroll;
        ctx.restore();
        return draw();
      }
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
              ctx.globalAlpha = 0.45;
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
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(boxX, imgY, metrics.boxWidth, metrics.boxHeight);
            ctx.strokeStyle = '#e2e8f0';
            ctx.strokeRect(boxX + 0.5, imgY + 0.5, metrics.boxWidth - 1, metrics.boxHeight - 1);
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
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(boxX, boxY, metrics.boxWidth, metrics.boxHeight);
          ctx.strokeStyle = '#e2e8f0';
          ctx.strokeRect(boxX + 0.5, boxY + 0.5, metrics.boxWidth - 1, metrics.boxHeight - 1);
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

    // Draw insertion caret (cursor) with image-aware anchors.
    if (blinkRef.current && !hasSelection) {
      const cursor = cursorRef.current;
      let caretX = padLeft;
      let caretY = padTop;
      let caretH = Math.max(16, curFmtRef.current.fontSize);
      const imageCaretH = Math.max(16, curFmtRef.current.fontSize);
      const breakCaretGapY = 6;

      const imageAtStart = imageBoxesRef.current.find((box) => cursor === box.start) ?? null;
      const imageAtEnd = imageBoxesRef.current.find((box) => cursor === box.end) ?? null;

      if (imageAtStart) {
        if (isBreakLineWrap(imageAtStart.meta.wrap)) {
          // If text exists immediately before break image, anchor caret at the end
          // of that rendered text line so caret follows typed characters.
          let prevTextLine: VisualLine | null = null;
          for (let i = vls.length - 1; i >= 0; i--) {
            const vl = vls[i];
            if (vl.endOffset > cursor) continue;
            const hasBreakImageSeg = vl.segs.some((sg) => {
              const meta = parseImageToken(sg.text);
              return Boolean(meta && isBreakLineWrap(meta.wrap));
            });
            if (!hasBreakImageSeg && vl.segs.length > 0) {
              prevTextLine = vl;
              break;
            }
          }

          if (prevTextLine && prevTextLine.segs.length > 0) {
            const reverseTextSegs = [...prevTextLine.segs].reverse();
            const lastTextSeg =
              reverseTextSegs.find(
                (sg) => !parseImageToken(sg.text) && /\S/.test(sg.text),
              ) ?? reverseTextSegs.find((sg) => !parseImageToken(sg.text) && sg.text.length > 0);
            if (!lastTextSeg) {
              caretX = imageAtStart.x;
              caretY = imageAtStart.y;
              caretH = Math.max(16, curFmtRef.current.fontSize);
            } else {
              ctx.font = buildFont(
                lastTextSeg.fmt.fontSize,
                lastTextSeg.fmt.bold,
                lastTextSeg.fmt.italic,
                lastTextSeg.fmt.fontFamily,
              );
              const anchorText =
                /\S/.test(lastTextSeg.text) ? lastTextSeg.text.replace(/\s+$/, '') : lastTextSeg.text;
              caretX = padLeft + lastTextSeg.x + ctx.measureText(anchorText).width;
              const prevLineHasInlineImage = prevTextLine.segs.some((sg) => {
                const meta = parseImageToken(sg.text);
                return Boolean(meta && isInlineWrap(meta.wrap));
              });
              caretY = prevLineHasInlineImage
                ? prevTextLine.y + Math.max(0, prevTextLine.lineH - lastTextSeg.fmt.fontSize)
                : prevTextLine.y + Math.max(0, (prevTextLine.lineH - lastTextSeg.fmt.fontSize) / 2);
              caretH = Math.max(16, lastTextSeg.fmt.fontSize);
            }
          } else {
            // Break-line start anchor: show caret on the same top line as image.
            caretX = imageAtStart.x;
            caretY = imageAtStart.y;
            caretH = Math.max(16, curFmtRef.current.fontSize);
          }
        } else if (isWrapTextWrap(imageAtStart.meta.wrap)) {
          // Wrap-text writes from the post-image lane to keep image stable.
          caretX = padLeft;
          caretY = imageAtStart.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isTextInFrontWrap(imageAtStart.meta.wrap)) {
          caretX = padLeft;
          caretY = imageAtStart.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else {
          // Cursor at image bottom-left when at image start.
          caretX = imageAtStart.x;
          caretY = imageAtStart.y + Math.max(0, imageAtStart.height - imageCaretH);
          caretH = imageCaretH;
        }
      } else if (imageAtEnd) {
        if (isBreakLineWrap(imageAtEnd.meta.wrap)) {
          // Break-line mode: caret should continue below the image block.
          caretX = padLeft;
          caretY = imageAtEnd.y + imageAtEnd.height + breakCaretGapY;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isWrapTextWrap(imageAtEnd.meta.wrap)) {
          caretX = padLeft;
          caretY = imageAtEnd.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else if (isTextInFrontWrap(imageAtEnd.meta.wrap)) {
          caretX = padLeft;
          caretY = imageAtEnd.y;
          caretH = Math.max(16, curFmtRef.current.fontSize);
        } else {
          caretX = imageAtEnd.x + imageAtEnd.width;
          caretY = imageAtEnd.y + Math.max(0, imageAtEnd.height - imageCaretH);
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
              if (inlineImage && isFlowingImageWrap(inlineImage.wrap)) {
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
                if (cursor <= segStart) {
                  if (isBreakLineWrap(inlineImage.wrap)) {
                    caretX = imgX;
                    caretY = imgY;
                    caretH = Math.max(16, curFmtRef.current.fontSize);
                  } else if (isTextInFrontWrap(inlineImage.wrap)) {
                    caretX = padLeft;
                    caretY = vl.y;
                    caretH = Math.max(16, seg.fmt.fontSize);
                  } else if (isWrapTextWrap(inlineImage.wrap)) {
                    caretX = padLeft;
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
                    caretX = padLeft;
                    caretY = vl.y;
                    caretH = Math.max(16, curFmtRef.current.fontSize);
                  } else if (isWrapTextWrap(inlineImage.wrap)) {
                    caretX = padLeft;
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
                caretX = padLeft + seg.x + ctx.measureText(prefix).width;
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
            if (inlineImage && (isFlowingImageWrap(inlineImage.wrap) || isTextInFrontWrap(inlineImage.wrap))) {
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
                caretX = padLeft;
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

    // Draw right-side scrollbar overlay for custom canvas scrolling.
    if (vls.length > 0) {
      const last = vls[vls.length - 1];
      const contentBottomAbs = last.y + last.lineH + scrollYRef.current;
      const viewportTop = padTop;
      const viewportH = Math.max(1, h - viewportTop - 4);
      const contentH = Math.max(viewportH, contentBottomAbs - padTop + 8);
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
    getAlignedXInTextArea,
  ]);

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
      const { padLeft, textAreaWidth, padTop, baseLineH } = getLayoutMetrics(
        w,
        leftMargin,
        rightMargin,
        isPaperMode,
        curFmtRef.current.fontSize,
      );
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

      for (const seg of best.segs) {
        const inlineImage = parseImageToken(seg.text);
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
          if (clickX <= segEndX) {
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
        if (clickX <= segEndX) {
          for (let ci = 0; ci <= seg.text.length; ci++) {
            const cw = ctx.measureText(seg.text.slice(0, ci)).width;
            if (segStartX + cw >= clickX) {
              const prev = ci > 0 ? ctx.measureText(seg.text.slice(0, ci - 1)).width : 0;
              const col = clickX - (segStartX + prev) < segStartX + cw - clickX ? ci - 1 : ci;
              return best.startOffset + (lastOffset - best.startOffset) + Math.max(0, col);
            }
          }
          return best.startOffset + seg.text.length;
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

  return {
    draw,
    resetBlink,
    getOffsetFromClientXY,
    getImageBoxAtClientXY,
    getImageBoxAtOffset,
    getResolvedImageBox,
  };
}
