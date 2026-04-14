import { useCallback, useRef } from 'react';
import {
  applyFormatToRange,
  buildImageToken,
  detectBulletPrefix,
  deleteRange,
  getBulletCharForLevel,
  getFormatAt,
  getImageTokenAtOffset,
  getOrderedMarkerForLevel,
  insertRun,
  isFormatUniform,
  makeRun,
  getImageTokenRanges,
  offsetToParaCol,
  paraColToOffset,
  runsToText,
  toggleBulletRange,
  type ImageWrap,
  type Run,
  type RunFmt,
} from './textModel';
import { resolveInsertOffsetForWrapMode } from './image/imageWrapMode';

export interface InputRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  runsRef: React.MutableRefObject<Run[]>;
  cursorRef: React.MutableRefObject<number>;
  selStartRef: React.MutableRefObject<number | null>;
  curFmtRef: React.MutableRefObject<RunFmt>;
  isDraggingRef: React.MutableRefObject<boolean>;
}

export interface InputCallbacks {
  draw: () => void;
  resetBlink: () => void;
  emitChange: () => void;
  notifyFmt: () => void;
  getOffsetFromClientXY: (x: number, y: number) => number | null;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

export function useEditorInput(
  refs: InputRefs,
  callbacks: InputCallbacks & { onImageInserted?: (offset: number) => void },
) {
  const { runsRef, cursorRef, selStartRef, curFmtRef, isDraggingRef, canvasRef } = refs;
  const resetFmtOnNextCursorMoveRef = useRef(false);
  const {
    draw,
    resetBlink,
    emitChange,
    notifyFmt,
    getOffsetFromClientXY,
    pushHistory,
    undo,
    redo,
  } = callbacks;

  const getSelRange = useCallback(() => {
    const cursor = cursorRef.current;
    const hasSel = selStartRef.current !== null && selStartRef.current !== cursor;
    const selF = hasSel ? Math.min(selStartRef.current!, cursor) : cursor;
    const selT = hasSel ? Math.max(selStartRef.current!, cursor) : cursor;
    return { selF, selT, hasSel };
  }, [cursorRef, selStartRef]);

  const resolveInsertOffset = useCallback(
    (offset: number) => {
      const text = runsToText(runsRef.current);
      const image = getImageTokenAtOffset(text, offset);
      return resolveInsertOffsetForWrapMode(text, image, offset);
    },
    [runsRef],
  );

  const applyOrSetFmt = useCallback(
    (patch: Partial<RunFmt>) => {
      const { selF, selT, hasSel } = getSelRange();
      if (hasSel) {
        pushHistory();
        runsRef.current = applyFormatToRange(runsRef.current, selF, selT, patch);
        emitChange();
        // Selection formatting should reset to underlying text format after next cursor move.
        resetFmtOnNextCursorMoveRef.current = true;
        notifyFmt();
        draw();
        return;
      }
      // No-selection formatting should persist for subsequent typing.
      resetFmtOnNextCursorMoveRef.current = false;
      curFmtRef.current = { ...curFmtRef.current, ...patch };
      notifyFmt();
      draw();
    },
    [getSelRange, runsRef, curFmtRef, emitChange, notifyFmt, draw, pushHistory, cursorRef],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const text = runsToText(runsRef.current);
      let cursor = cursorRef.current;
      let handled = true;
      let didNavigation = false;
      const { selF, selT, hasSel } = getSelRange();

      const snapCursorOutsideImage = (next: number, direction?: 'left' | 'right') => {
        const currentText = runsToText(runsRef.current);
        for (const r of getImageTokenRanges(currentText)) {
          if (next > r.start && next < r.end) {
            if (direction === 'left') return r.start;
            if (direction === 'right') return r.end;
            return Math.abs(next - r.start) <= Math.abs(r.end - next) ? r.start : r.end;
          }
        }
        return next;
      };

      const getImageRangeAtBoundary = (at: number, boundary: 'start' | 'end') => {
        const currentText = runsToText(runsRef.current);
        const ranges = getImageTokenRanges(currentText);
        return ranges.find((r) => (boundary === 'start' ? r.start === at : r.end === at)) ?? null;
      };

      const imageRangeEndingAt = (at: number) => {
        return getImageRangeAtBoundary(at, 'end');
      };

      const imageRangeStartingAt = (at: number) => {
        return getImageRangeAtBoundary(at, 'start');
      };

      const deleteSelection = () => {
        runsRef.current = deleteRange(runsRef.current, selF, selT);
        cursor = selF;
        selStartRef.current = null;
      };

      const getBulletLevel = (indentLen: number) => Math.max(0, Math.floor(indentLen / 2));

      const getPrevLineBulletLevel = (lineStart: number): number | null => {
        if (lineStart <= 0) return null;
        const prevLineEnd = lineStart - 1;
        const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
        const prevPara = text.slice(prevLineStart, prevLineEnd);
        const prevBullet = detectBulletPrefix(prevPara);
        if (!prevBullet.hasBullet) return null;
        return getBulletLevel(prevBullet.indentLen);
      };

      const canIndentBulletLine = (
        lineStart: number,
        bullet: { hasBullet: boolean; indentLen: number },
      ) => {
        if (!bullet.hasBullet) return false;
        const currentLevel = getBulletLevel(bullet.indentLen);
        // Max supported bullet nesting is 3 levels (0,1,2)
        if (currentLevel >= 2) return false;
        // Next level is allowed only when previous line is the same current level.
        const prevLevel = getPrevLineBulletLevel(lineStart);
        return prevLevel === currentLevel;
      };

      // Snapshot history before any content-mutating key so undo restores correctly
      const tabLineStartForHistory = e.key === 'Tab' ? text.lastIndexOf('\n', cursor - 1) + 1 : -1;
      const tabLineEndForHistory =
        e.key === 'Tab' ? text.indexOf('\n', tabLineStartForHistory) : -1;
      const tabParaForHistory =
        e.key === 'Tab'
          ? tabLineEndForHistory === -1
            ? text.slice(tabLineStartForHistory)
            : text.slice(tabLineStartForHistory, tabLineEndForHistory)
          : '';
      const tabBulletForHistory = e.key === 'Tab' ? detectBulletPrefix(tabParaForHistory) : null;
      const isBlockedTabByBulletLevelRule =
        e.key === 'Tab' &&
        !e.shiftKey &&
        !!tabBulletForHistory?.hasBullet &&
        !canIndentBulletLine(tabLineStartForHistory, tabBulletForHistory);

      const willMutate =
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === 'Enter' ||
        (e.key === 'Tab' && !isBlockedTabByBulletLevelRule) ||
        (e.key.length === 1 && !e.metaKey && !e.ctrlKey);
      if (willMutate) pushHistory();

      if (e.key === 'Backspace') {
        if (hasSel) {
          deleteSelection();
        } else if (cursor > 0) {
          const currentText = runsToText(runsRef.current);
          // Keep image tokens isolated on their own line: do not delete the line break
          // right before an image token, otherwise token/text merge can cause artifacts.
          if (currentText[cursor - 1] === '\n' && imageRangeStartingAt(cursor)) {
            // no-op
          } else {
            const imgAtLeft = imageRangeEndingAt(cursor);
            if (imgAtLeft) {
              runsRef.current = deleteRange(runsRef.current, imgAtLeft.start, imgAtLeft.end);
              cursor = imgAtLeft.start;
            } else {
              // Detect bullet prefix at current line
              const bsLineStart = text.lastIndexOf('\n', cursor - 1) + 1;
              const bsLineEnd = text.indexOf('\n', bsLineStart);
              const bsPara =
                bsLineEnd === -1 ? text.slice(bsLineStart) : text.slice(bsLineStart, bsLineEnd);
              const bsBullet = detectBulletPrefix(bsPara);

              if (bsBullet.hasBullet && cursor === bsLineStart + bsBullet.prefixLen) {
                const isEmptyBulletLine = bsPara.length <= bsBullet.prefixLen;
                // Cursor is right after the bullet prefix
                if (isEmptyBulletLine && bsBullet.indentLen >= 2) {
                  // Empty nested bullet (level 2/3): remove full prefix and jump to line start.
                  runsRef.current = deleteRange(
                    runsRef.current,
                    bsLineStart,
                    bsLineStart + bsBullet.prefixLen,
                  );
                  cursor = bsLineStart;
                } else if (bsBullet.indentLen >= 2) {
                  // Indented bullet: outdent by removing one indent level (2 spaces)
                  runsRef.current = deleteRange(runsRef.current, bsLineStart, bsLineStart + 2);
                  cursor -= 2;
                } else {
                  // Level 0 bullet: remove the bullet entirely
                  runsRef.current = deleteRange(
                    runsRef.current,
                    bsLineStart,
                    bsLineStart + bsBullet.prefixLen,
                  );
                  cursor = bsLineStart;
                }
              } else {
                runsRef.current = deleteRange(runsRef.current, cursor - 1, cursor);
                cursor--;
              }
            }
          }
        }
        // Only derive format from content when the document is non-empty.
        // On an empty document getFormatAt returns DEFAULT_RUN_FMT which would
        // wipe any toolbar selections the user configured.
        const postBackspaceText = runsToText(runsRef.current);
        if (postBackspaceText.length > 0) {
          curFmtRef.current = getFormatAt(
            runsRef.current,
            Math.min(cursor, postBackspaceText.length - 1),
          );
        }
      } else if (e.key === 'Delete') {
        if (hasSel) {
          deleteSelection();
        } else if (cursor < text.length) {
          // Keep image tokens isolated on their own line: do not delete the line break
          // right before an image token via Delete.
          if (text[cursor] === '\n' && imageRangeStartingAt(cursor + 1)) {
            // no-op
          } else {
            const imgAtRight = imageRangeStartingAt(cursor);
            if (imgAtRight)
              runsRef.current = deleteRange(runsRef.current, imgAtRight.start, imgAtRight.end);
            else runsRef.current = deleteRange(runsRef.current, cursor, cursor + 1);
          }
        }
      } else if (e.key === 'Enter') {
        if (hasSel) deleteSelection();
        const enterText = runsToText(runsRef.current);
        // Only treat cursor at image-end as an image boundary — image-start is
        // handled like a normal line: insert \n, image shifts down, cursor stays above.
        const imageBoundary = getImageTokenRanges(enterText).find((r) => r.end === cursor) ?? null;
        // Also check if cursor is at image-start so we can keep cursor on the blank line.
        const atImageStart = getImageTokenRanges(enterText).some((r) => r.start === cursor);
        if (imageBoundary) {
          // Cursor at image end: insert newline after image, cursor goes to line below.
          runsRef.current = insertRun(
            runsRef.current,
            cursor,
            makeRun('\n', { ...curFmtRef.current }),
          );
          cursor += 1;
        } else if (atImageStart) {
          // Cursor at image start: insert newline, image shifts down, cursor stays on blank line.
          runsRef.current = insertRun(
            runsRef.current,
            cursor,
            makeRun('\n', { ...curFmtRef.current }),
          );
          // Don't advance cursor — it stays on the new empty line above the image.
        } else {
          // After a possible selection delete, derive bullet state from current text.
          const lineStart = enterText.lastIndexOf('\n', cursor - 1) + 1;
          const lineEnd = enterText.indexOf('\n', lineStart);
          const paraContent =
            lineEnd === -1 ? enterText.slice(lineStart) : enterText.slice(lineStart, lineEnd);
          const enterBullet = detectBulletPrefix(paraContent);

          if (enterBullet.hasBullet) {
            if (paraContent.length <= enterBullet.prefixLen) {
              // Empty bullet line → exit bullet mode
              if (enterBullet.indentLen >= 2) {
                // Outdent one level, keep bullet
                runsRef.current = deleteRange(runsRef.current, lineStart, lineStart + 2);
                cursor = lineStart + enterBullet.prefixLen - 2;
              } else {
                // Remove bullet entirely
                runsRef.current = deleteRange(
                  runsRef.current,
                  lineStart,
                  lineStart + enterBullet.prefixLen,
                );
                cursor = lineStart;
              }
            } else {
              // Non-empty bullet line → continue the list with same prefix
              const prefix = paraContent.slice(0, enterBullet.prefixLen);
              runsRef.current = insertRun(
                runsRef.current,
                cursor,
                makeRun('\n', { ...curFmtRef.current }),
              );
              cursor++;
              runsRef.current = insertRun(
                runsRef.current,
                cursor,
                makeRun(prefix, { ...curFmtRef.current }),
              );
              cursor += prefix.length;
            }
          } else {
            runsRef.current = insertRun(
              runsRef.current,
              cursor,
              makeRun('\n', { ...curFmtRef.current }),
            );
            cursor++;
          }
        }
      } else if (e.key === 'Tab') {
        const tabLineStart = text.lastIndexOf('\n', cursor - 1) + 1;
        const tabLineEnd = text.indexOf('\n', tabLineStart);
        const tabPara =
          tabLineEnd === -1 ? text.slice(tabLineStart) : text.slice(tabLineStart, tabLineEnd);
        const tabBullet = detectBulletPrefix(tabPara);

        // Disable plain Tab indentation only when bullet level rules are not met.
        if (!e.shiftKey && tabBullet.hasBullet && !canIndentBulletLine(tabLineStart, tabBullet)) {
          // No-op: keep cursor and content unchanged.
        } else {
          const rewriteBulletCharAt = (
            bulletCharPos: number,
            level: number,
            listType: 'bullet' | 'number' | 'letter' | '',
          ) => {
            const newBulletChar =
              listType === 'number' || listType === 'letter'
                ? getOrderedMarkerForLevel(level)
                : getBulletCharForLevel(level);
            const currentText = runsToText(runsRef.current);
            if (bulletCharPos < 0 || bulletCharPos >= currentText.length) return;
            if (currentText[bulletCharPos] === newBulletChar) return;
            const fmt = getFormatAt(runsRef.current, Math.max(0, bulletCharPos));
            runsRef.current = deleteRange(runsRef.current, bulletCharPos, bulletCharPos + 1);
            runsRef.current = insertRun(
              runsRef.current,
              bulletCharPos,
              makeRun(newBulletChar, { ...fmt }),
            );
          };

          if (e.shiftKey) {
            // Shift+Tab: outdent by removing 2 spaces from line start if they exist
            if (text.substr(tabLineStart, 2) === '  ') {
              runsRef.current = deleteRange(runsRef.current, tabLineStart, tabLineStart + 2);
              cursor = Math.max(tabLineStart, cursor - 2);
              if (tabBullet.hasBullet && tabBullet.indentLen >= 2) {
                const newIndentLen = tabBullet.indentLen - 2;
                const newLevel = Math.max(0, Math.floor(newIndentLen / 2));
                const newBulletPos = tabLineStart + newIndentLen;
                rewriteBulletCharAt(newBulletPos, newLevel, tabBullet.listType);
              }
            }
          } else {
            if (tabBullet.hasBullet) {
              // Bullet line: indent by adding 2 spaces at line start
              runsRef.current = insertRun(
                runsRef.current,
                tabLineStart,
                makeRun('  ', { ...curFmtRef.current }),
              );
              cursor += 2;
              const newIndentLen = tabBullet.indentLen + 2;
              const newLevel = Math.floor(newIndentLen / 2);
              const newBulletPos = tabLineStart + newIndentLen;
              rewriteBulletCharAt(newBulletPos, newLevel, tabBullet.listType);
            } else {
              // Normal paragraph: add 4 spaces for tab
              runsRef.current = insertRun(
                runsRef.current,
                cursor,
                makeRun('    ', { ...curFmtRef.current }),
              );
              cursor += 4;
            }
          }
        }
      } else if (e.key === 'ArrowLeft') {
        if (e.shiftKey) {
          if (selStartRef.current === null) selStartRef.current = cursor;
        } else selStartRef.current = null;
        if (cursor > 0) {
          const currentText = runsToText(runsRef.current);
          const imageAtCursor = imageRangeStartingAt(cursor);
          if (imageAtCursor && currentText[cursor - 1] === '\n') {
            // Keep caret at image start; don't jump to previous line automatically.
          } else {
            cursor--;
          }
        }
        cursor = snapCursorOutsideImage(cursor, 'left');
        didNavigation = true;
      } else if (e.key === 'ArrowRight') {
        if (e.shiftKey) {
          if (selStartRef.current === null) selStartRef.current = cursor;
        } else selStartRef.current = null;
        if (cursor < text.length) {
          const currentText = runsToText(runsRef.current);
          const imageAtCursor = imageRangeEndingAt(cursor);
          if (imageAtCursor && currentText[cursor] === '\n') {
            // Keep caret at image end; don't jump to next line automatically.
          } else {
            cursor++;
          }
        }
        cursor = snapCursorOutsideImage(cursor, 'right');
        didNavigation = true;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const { para, col } = offsetToParaCol(text, cursor);
        const paras = text.split('\n');
        const newPara =
          e.key === 'ArrowUp' ? Math.max(0, para - 1) : Math.min(paras.length - 1, para + 1);
        cursor = paraColToOffset(text, newPara, col);
        if (e.shiftKey) {
          if (selStartRef.current === null) selStartRef.current = cursorRef.current;
        } else selStartRef.current = null;
        didNavigation = true;
      } else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        selStartRef.current = 0;
        cursor = text.length;
        didNavigation = true;
      } else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
        const allBold = hasSel && isFormatUniform(runsRef.current, selF, selT, 'bold', true);
        applyOrSetFmt({ bold: hasSel ? !allBold : !curFmtRef.current.bold });
      } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
        const allItalic = hasSel && isFormatUniform(runsRef.current, selF, selT, 'italic', true);
        applyOrSetFmt({
          italic: hasSel ? !allItalic : !curFmtRef.current.italic,
        });
      } else if (e.key === 'u' && (e.metaKey || e.ctrlKey)) {
        const allUnder = hasSel && isFormatUniform(runsRef.current, selF, selT, 'underline', true);
        applyOrSetFmt({
          underline: hasSel ? !allUnder : !curFmtRef.current.underline,
        });
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      } else if (
        (e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
        (e.key === 'y' && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        redo();
        return;
      } else if (e.key === 'Home') {
        cursor = text.lastIndexOf('\n', cursor - 1) + 1;
        selStartRef.current = null;
        didNavigation = true;
      } else if (e.key === 'End') {
        const next = text.indexOf('\n', cursor);
        cursor = next === -1 ? text.length : next;
        selStartRef.current = null;
        didNavigation = true;
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        if (hasSel) deleteSelection();
        const insertAt = resolveInsertOffset(cursor);
        // Inline typing keeps image tokens in document flow.
        runsRef.current = insertRun(
          runsRef.current,
          insertAt,
          makeRun(e.key, { ...curFmtRef.current }),
        );
        cursor = insertAt + 1;
      } else {
        handled = false;
      }

      if (handled) {
        e.preventDefault();
        cursor = snapCursorOutsideImage(cursor);
        cursorRef.current = cursor;
        if (didNavigation) {
          const flatText = runsToText(runsRef.current);
          if (flatText.length > 0) {
            curFmtRef.current = getFormatAt(runsRef.current, Math.min(cursor, flatText.length - 1));
          }
        }
        notifyFmt();
        emitChange();
        resetBlink();
        draw();
      }
    },
    [
      getSelRange,
      applyOrSetFmt,
      resolveInsertOffset,
      runsRef,
      cursorRef,
      selStartRef,
      curFmtRef,
      draw,
      emitChange,
      notifyFmt,
      resetBlink,
      pushHistory,
      undo,
      redo,
    ],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const paste = e.clipboardData?.getData('text') || '';
      if (!paste) return;
      pushHistory();
      const { selF, selT, hasSel } = getSelRange();
      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);
      const insertPos = resolveInsertOffset(selF);
      // Inline paste should preserve token flow so images move with surrounding edits.
      runsRef.current = insertRun(
        runsRef.current,
        insertPos,
        makeRun(paste, { ...curFmtRef.current }),
      );
      cursorRef.current = insertPos + paste.length;
      selStartRef.current = null;
      emitChange();
      resetBlink();
      draw();
    },
    [
      getSelRange,
      runsRef,
      curFmtRef,
      cursorRef,
      selStartRef,
      emitChange,
      resetBlink,
      draw,
      pushHistory,
      resolveInsertOffset,
    ],
  );

  const patchImageAtCursor = useCallback(
    (
      patch: Partial<{
        align: 'left' | 'center' | 'right';
        widthPct: number;
        rotationDeg: number;
        wrap: ImageWrap;
        alt: string;
      }>,
      withHistory = true,
    ) => {
      const text = runsToText(runsRef.current);
      const cursor = cursorRef.current;
      const image = getImageTokenAtOffset(text, cursor);
      if (!image) return;

      const nextToken = buildImageToken({
        src: image.src,
        align: patch.align ?? image.align,
        widthPct: patch.widthPct ?? image.widthPct,
        rotationDeg: patch.rotationDeg ?? image.rotationDeg,
        wrap: patch.wrap ?? image.wrap,
        alt: patch.alt ?? image.alt,
      });
      const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
      const atStart = cursor <= image.start;

      if (withHistory) pushHistory();
      runsRef.current = deleteRange(runsRef.current, image.start, image.end);
      runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));
      cursorRef.current = atStart ? image.start : image.start + nextToken.length;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    },
    [runsRef, cursorRef, selStartRef, pushHistory, emitChange, notifyFmt, resetBlink, draw],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const offset = getOffsetFromClientXY(e.clientX, e.clientY);
      if (offset === null) return;
      const text = runsToText(runsRef.current);
      const snappedOffset = (() => {
        for (const r of getImageTokenRanges(text)) {
          if (offset > r.start && offset < r.end) {
            return Math.abs(offset - r.start) <= Math.abs(r.end - offset) ? r.start : r.end;
          }
        }
        return offset;
      })();
      isDraggingRef.current = true;
      cursorRef.current = snappedOffset;
      selStartRef.current = snappedOffset;
      if (resetFmtOnNextCursorMoveRef.current) {
        const nextText = runsToText(runsRef.current);
        if (nextText.length > 0) {
          curFmtRef.current = getFormatAt(
            runsRef.current,
            Math.min(snappedOffset, nextText.length - 1),
          );
        }
        resetFmtOnNextCursorMoveRef.current = false;
      }
      notifyFmt();
      resetBlink();
      draw();
      canvasRef.current?.focus();

      const onMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const off = getOffsetFromClientXY(ev.clientX, ev.clientY);
        if (off === null) return;
        const currentText = runsToText(runsRef.current);
        let nextOffset = off;
        for (const r of getImageTokenRanges(currentText)) {
          if (nextOffset > r.start && nextOffset < r.end) {
            nextOffset =
              Math.abs(nextOffset - r.start) <= Math.abs(r.end - nextOffset) ? r.start : r.end;
            break;
          }
        }
        cursorRef.current = nextOffset;
        resetBlink();
        draw();
      };
      const onUp = () => {
        isDraggingRef.current = false;
        if (selStartRef.current === cursorRef.current) selStartRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [
      getOffsetFromClientXY,
      isDraggingRef,
      cursorRef,
      selStartRef,
      notifyFmt,
      resetBlink,
      draw,
      canvasRef,
      runsRef,
    ],
  );

  const handleMouseMove = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = 'text';
  }, [canvasRef]);

  const handleWheel = useCallback(
    (e: React.WheelEvent, scrollYRef: React.MutableRefObject<number>) => {
      e.preventDefault();
      scrollYRef.current = Math.max(0, scrollYRef.current + e.deltaY);
      draw();
    },
    [draw],
  );

  const toggleBullet = useCallback(() => {
    pushHistory();
    const { selF, selT } = getSelRange();
    const { newRuns, cursorDelta } = toggleBulletRange(
      runsRef.current,
      selF,
      selT,
      curFmtRef.current,
    );
    runsRef.current = newRuns;
    cursorRef.current = Math.max(0, cursorRef.current + cursorDelta(cursorRef.current));
    selStartRef.current = null;
    emitChange();
    notifyFmt();
    resetBlink();
    draw();
  }, [
    getSelRange,
    runsRef,
    cursorRef,
    selStartRef,
    curFmtRef,
    pushHistory,
    emitChange,
    notifyFmt,
    resetBlink,
    draw,
  ]);

  const toggleNumberList = useCallback(() => {
    pushHistory();
    const { selF, selT } = getSelRange();
    const { newRuns, cursorDelta } = toggleBulletRange(
      runsRef.current,
      selF,
      selT,
      curFmtRef.current,
      'number',
    );
    runsRef.current = newRuns;
    cursorRef.current = Math.max(0, cursorRef.current + cursorDelta(cursorRef.current));
    selStartRef.current = null;
    emitChange();
    notifyFmt();
    resetBlink();
    draw();
  }, [
    getSelRange,
    runsRef,
    cursorRef,
    selStartRef,
    curFmtRef,
    pushHistory,
    emitChange,
    notifyFmt,
    resetBlink,
    draw,
  ]);

  const indentBy = useCallback(
    (delta: -1 | 1) => {
      const text = runsToText(runsRef.current);
      const cursor = cursorRef.current;
      const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
      const lineEnd = text.indexOf('\n', lineStart);
      const lineText = lineEnd === -1 ? text.slice(lineStart) : text.slice(lineStart, lineEnd);
      const lineBullet = detectBulletPrefix(lineText);

      const getBulletLevel = (indentLen: number) => Math.max(0, Math.floor(indentLen / 2));
      const getPrevLineBulletLevel = (): number | null => {
        if (lineStart <= 0) return null;
        const prevLineEnd = lineStart - 1;
        const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
        const prevPara = text.slice(prevLineStart, prevLineEnd);
        const prevBullet = detectBulletPrefix(prevPara);
        if (!prevBullet.hasBullet) return null;
        return getBulletLevel(prevBullet.indentLen);
      };

      const rewriteListMarkerAt = (
        markerPos: number,
        level: number,
        listType: 'bullet' | 'number' | 'letter' | '',
      ) => {
        if (listType === '') return;
        const newMarker =
          listType === 'number' || listType === 'letter'
            ? getOrderedMarkerForLevel(level)
            : getBulletCharForLevel(level);
        const currentText = runsToText(runsRef.current);
        if (markerPos < 0 || markerPos >= currentText.length) return;
        if (currentText[markerPos] === newMarker) return;
        const fmt = getFormatAt(runsRef.current, Math.max(0, markerPos));
        runsRef.current = deleteRange(runsRef.current, markerPos, markerPos + 1);
        runsRef.current = insertRun(runsRef.current, markerPos, makeRun(newMarker, { ...fmt }));
      };

      let changed = false;
      let nextCursor = cursor;
      const NON_LIST_INDENT = '               ';
      const LIST_INDENT = '  ';

      if (delta > 0) {
        if (lineBullet.hasBullet) {
          const currentLevel = getBulletLevel(lineBullet.indentLen);
          const prevLevel = getPrevLineBulletLevel();
          if (currentLevel < 2 && prevLevel === currentLevel) {
            runsRef.current = insertRun(
              runsRef.current,
              lineStart,
              makeRun(LIST_INDENT, { ...curFmtRef.current }),
            );
            nextCursor += LIST_INDENT.length;
            const newIndentLen = lineBullet.indentLen + LIST_INDENT.length;
            const newLevel = getBulletLevel(newIndentLen);
            rewriteListMarkerAt(lineStart + newIndentLen, newLevel, lineBullet.listType);
            changed = true;
          }
        } else {
          runsRef.current = insertRun(
            runsRef.current,
            lineStart,
            makeRun(NON_LIST_INDENT, { ...curFmtRef.current }),
          );
          nextCursor += NON_LIST_INDENT.length;
          changed = true;
        }
      } else {
        const removeLen = lineBullet.hasBullet
          ? text.substr(lineStart, LIST_INDENT.length) === LIST_INDENT
            ? LIST_INDENT.length
            : 0
          : text.substr(lineStart, NON_LIST_INDENT.length) === NON_LIST_INDENT
            ? NON_LIST_INDENT.length
            : text.substr(lineStart, LIST_INDENT.length) === LIST_INDENT
              ? LIST_INDENT.length
              : 0;

        if (removeLen > 0) {
          runsRef.current = deleteRange(runsRef.current, lineStart, lineStart + removeLen);
          nextCursor = Math.max(lineStart, cursor - removeLen);
          if (lineBullet.hasBullet && lineBullet.indentLen >= LIST_INDENT.length) {
            const newIndentLen = lineBullet.indentLen - LIST_INDENT.length;
            const newLevel = getBulletLevel(newIndentLen);
            rewriteListMarkerAt(lineStart + newIndentLen, newLevel, lineBullet.listType);
          }
          changed = true;
        }
      }

      if (!changed) return;
      pushHistory();
      cursorRef.current = nextCursor;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    },
    [
      runsRef,
      cursorRef,
      selStartRef,
      curFmtRef,
      pushHistory,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
    ],
  );

  const indentLeft = useCallback(() => indentBy(-1), [indentBy]);
  const indentRight = useCallback(() => indentBy(1), [indentBy]);

  const setLineSpacing = useCallback(
    (value: number) => {
      const normalized = [1, 1.5, 2].includes(value) ? value : 1.5;
      const { selF, selT, hasSel } = getSelRange();
      const text = runsToText(runsRef.current);

      let blockStart = -1;
      let blockEnd = -1;
      const paras = text.split('\n');
      let off = 0;
      for (let pi = 0; pi < paras.length; pi++) {
        const pStart = off;
        const pEnd = off + paras[pi].length;
        const overlaps = hasSel
          ? pEnd >= selF && pStart < selT
          : cursorRef.current >= pStart && cursorRef.current <= pEnd;
        if (overlaps) {
          if (blockStart === -1) blockStart = pStart;
          blockEnd = pEnd;
        }
        off += paras[pi].length + 1;
      }

      if (blockStart !== -1 && blockEnd > blockStart) {
        pushHistory();
        runsRef.current = applyFormatToRange(runsRef.current, blockStart, blockEnd, {
          lineSpacing: normalized,
        });
        emitChange();
      }

      // Keep insertion format synced so Enter/new typing continues with same spacing.
      curFmtRef.current = { ...curFmtRef.current, lineSpacing: normalized };
      notifyFmt();
      resetBlink();
      draw();
    },
    [
      getSelRange,
      runsRef,
      cursorRef,
      curFmtRef,
      pushHistory,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
    ],
  );

  const toggleHighlight = useCallback(() => {
    const next = curFmtRef.current.highlightColor ? null : '#fde047';
    applyOrSetFmt({ highlightColor: next });
    resetBlink();
  }, [curFmtRef, applyOrSetFmt, resetBlink]);

  const setHighlightColor = useCallback(
    (color: string | null) => {
      applyOrSetFmt({ highlightColor: color });
      resetBlink();
    },
    [applyOrSetFmt, resetBlink],
  );

  const toggleSpaceBeforeLine = useCallback(() => {
    const text = runsToText(runsRef.current);
    const cursor = cursorRef.current;
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    if (lineStart === 0) return;

    const prevLineEnd = lineStart - 1;
    const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
    const hasBlankBefore = text.slice(prevLineStart, prevLineEnd).length === 0;

    pushHistory();
    if (hasBlankBefore) {
      runsRef.current = deleteRange(runsRef.current, lineStart - 1, lineStart);
      cursorRef.current = Math.max(0, cursor - 1);
    } else {
      runsRef.current = insertRun(
        runsRef.current,
        lineStart,
        makeRun('\n', { ...curFmtRef.current }),
      );
      cursorRef.current = cursor + 1;
    }

    selStartRef.current = null;
    emitChange();
    notifyFmt();
    resetBlink();
    draw();
  }, [
    runsRef,
    cursorRef,
    selStartRef,
    curFmtRef,
    pushHistory,
    emitChange,
    notifyFmt,
    resetBlink,
    draw,
  ]);

  const toggleSpaceAfterLine = useCallback(() => {
    const text = runsToText(runsRef.current);
    const cursor = cursorRef.current;
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    const lineEnd = text.indexOf('\n', lineStart);
    const endPos = lineEnd === -1 ? text.length : lineEnd;

    let hasBlankAfter = false;
    if (lineEnd !== -1) {
      const nextLineStart = lineEnd + 1;
      const nextLineEnd = text.indexOf('\n', nextLineStart);
      hasBlankAfter =
        text.slice(nextLineStart, nextLineEnd === -1 ? text.length : nextLineEnd).length === 0;
    }

    pushHistory();
    if (hasBlankAfter) {
      runsRef.current = deleteRange(runsRef.current, endPos, endPos + 1);
      if (cursor > endPos) cursorRef.current = Math.max(endPos, cursor - 1);
    } else {
      runsRef.current = insertRun(runsRef.current, endPos, makeRun('\n', { ...curFmtRef.current }));
      if (cursor > endPos) cursorRef.current = cursor + 1;
    }

    selStartRef.current = null;
    emitChange();
    notifyFmt();
    resetBlink();
    draw();
  }, [
    runsRef,
    cursorRef,
    selStartRef,
    curFmtRef,
    pushHistory,
    emitChange,
    notifyFmt,
    resetBlink,
    draw,
  ]);

  const insertLink = useCallback(
    (url: string) => {
      const normalized = url.trim();
      if (!normalized) return;
      const { selF, selT, hasSel } = getSelRange();

      pushHistory();
      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

      const insertPos = resolveInsertOffset(selF);

      const linkFmt: RunFmt = {
        ...curFmtRef.current,
        color: '#2563eb',
        underline: true,
      };
      runsRef.current = insertRun(runsRef.current, insertPos, makeRun(normalized, linkFmt));
      cursorRef.current = insertPos + normalized.length;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    },
    [
      getSelRange,
      runsRef,
      cursorRef,
      selStartRef,
      curFmtRef,
      pushHistory,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
      resolveInsertOffset,
    ],
  );

  const insertImage = useCallback(
    (url: string) => {
      const normalized = url.trim();
      if (!normalized) return;
      const { selF, selT, hasSel } = getSelRange();
      const token = buildImageToken({
        src: normalized,
        widthPct: 10, // Smaller default width for inline images
        align: 'left',
        rotationDeg: 0,
        wrap: 'break', // Default new images to break text mode
        alt: '',
      });

      pushHistory();
      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

      let insertPos = resolveInsertOffset(selF);
      const textAfterSelection = runsToText(runsRef.current);
      const needsLeadingNewline = insertPos > 0 && textAfterSelection[insertPos - 1] !== '\n';
      const needsTrailingNewline =
        insertPos >= textAfterSelection.length || textAfterSelection[insertPos] !== '\n';
      const insertedText = `${needsLeadingNewline ? '\n' : ''}${token}${needsTrailingNewline ? '\n' : ''}`;

      // Keep break images on their own line even when inserted between existing text.
      runsRef.current = insertRun(
        runsRef.current,
        insertPos,
        makeRun(insertedText, { ...curFmtRef.current }),
      );
      const imageStart = insertPos + (needsLeadingNewline ? 1 : 0);
      insertPos = imageStart + token.length + 1;

      cursorRef.current = insertPos;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();

      // Notify parent/editor to select the image and show overlays
      if (callbacks.onImageInserted) {
        callbacks.onImageInserted(imageStart);
      }
    },
    [
      getSelRange,
      runsRef,
      cursorRef,
      selStartRef,
      curFmtRef,
      pushHistory,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
      callbacks,
      resolveInsertOffset,
    ],
  );

  const setImageAlign = useCallback(
    (align: 'left' | 'center' | 'right') => {
      const text = runsToText(runsRef.current);
      const image = getImageTokenAtOffset(text, cursorRef.current);
      if (image?.wrap === 'break') {
        patchImageAtCursor({ align }, true);
        return;
      }
      patchImageAtCursor({ align }, true);
    },
    [patchImageAtCursor, runsRef, cursorRef],
  );

  const setImageWidthPct = useCallback(
    (widthPct: number, withHistory = true) => {
      patchImageAtCursor({ widthPct }, withHistory);
    },
    [patchImageAtCursor],
  );

  const setImageRotationDeg = useCallback(
    (rotationDeg: number, withHistory = true) => {
      patchImageAtCursor({ rotationDeg }, withHistory);
    },
    [patchImageAtCursor],
  );

  const setImageWrap = useCallback(
    (wrap: ImageWrap) => {
      const text = runsToText(runsRef.current);
      const image = getImageTokenAtOffset(text, cursorRef.current);

      if (wrap === 'break' && image?.wrap === 'front') {
        const nextAlign = image.align === 'right' || image.align === 'center' ? image.align : 'left';
        const nextToken = buildImageToken({
          src: image.src,
          align: nextAlign,
          widthPct: image.widthPct,
          rotationDeg: image.rotationDeg,
          wrap,
          alt: image.alt,
        });
        const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
        const atStart = cursorRef.current <= image.start;

        pushHistory();
        runsRef.current = deleteRange(runsRef.current, image.start, image.end);
        runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));

        const trailingOffset = image.start + nextToken.length;
        const nextText = runsToText(runsRef.current);
        if (nextText[trailingOffset] !== '\n') {
          runsRef.current = insertRun(
            runsRef.current,
            trailingOffset,
            makeRun('\n', { ...fmt }),
          );
        }

        cursorRef.current = atStart ? image.start : image.start + nextToken.length + 1;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        resetBlink();
        draw();
        return;
      }

      if (wrap === 'break' && image?.wrap === 'wrap') {
        const nextAlign = image.align === 'right' || image.align === 'center' ? image.align : 'left';
        const nextToken = buildImageToken({
          src: image.src,
          align: nextAlign,
          widthPct: image.widthPct,
          rotationDeg: image.rotationDeg,
          wrap,
          alt: image.alt,
        });
        const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
        const atStart = cursorRef.current <= image.start;

        pushHistory();
        runsRef.current = deleteRange(runsRef.current, image.start, image.end);
        runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));

        const trailingOffset = image.start + nextToken.length;
        const nextText = runsToText(runsRef.current);
        if (nextText[trailingOffset] !== '\n') {
          runsRef.current = insertRun(
            runsRef.current,
            trailingOffset,
            makeRun('\n', { ...fmt }),
          );
        }

        // Keep start-anchor behavior; otherwise land below the image line in break mode.
        cursorRef.current = atStart ? image.start : image.start + nextToken.length + 1;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        resetBlink();
        draw();
        return;
      }

      if (wrap === 'break' && image?.wrap === 'inline') {
        const nextAlign = image.align === 'right' || image.align === 'center' ? image.align : 'left';
        const nextToken = buildImageToken({
          src: image.src,
          align: nextAlign,
          widthPct: image.widthPct,
          rotationDeg: image.rotationDeg,
          wrap,
          alt: image.alt,
        });
        const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
        const atStart = cursorRef.current <= image.start;

        pushHistory();
        runsRef.current = deleteRange(runsRef.current, image.start, image.end);
        runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));

        const trailingOffset = image.start + nextToken.length;
        const nextText = runsToText(runsRef.current);
        if (nextText[trailingOffset] !== '\n') {
          runsRef.current = insertRun(
            runsRef.current,
            trailingOffset,
            makeRun('\n', { ...fmt }),
          );
        }

        // Keep start-anchor behavior, otherwise land below image in break-line mode.
        cursorRef.current = atStart ? image.start : image.start + nextToken.length + 1;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        resetBlink();
        draw();
        return;
      }

      if (wrap === 'break') {
        const nextAlign = image?.align === 'right' || image?.align === 'center' ? image.align : 'left';
        patchImageAtCursor({ wrap, align: nextAlign }, true);
        return;
      }

      if (wrap === 'inline' && image?.wrap === 'break') {
        const nextToken = buildImageToken({
          src: image.src,
          align: image.align,
          widthPct: image.widthPct,
          rotationDeg: image.rotationDeg,
          wrap,
          alt: image.alt,
        });
        const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
        const atStart = cursorRef.current <= image.start;

        pushHistory();
        runsRef.current = deleteRange(runsRef.current, image.start, image.end);
        runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));

        let nextCursor = atStart ? image.start : image.start + nextToken.length;
        const trailingOffset = image.start + nextToken.length;
        const nextText = runsToText(runsRef.current);
        if (nextText[trailingOffset] === '\n') {
          runsRef.current = deleteRange(runsRef.current, trailingOffset, trailingOffset + 1);
          if (nextCursor > trailingOffset) nextCursor -= 1;
        }

        cursorRef.current = nextCursor;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        resetBlink();
        draw();
        return;
      }

      if (wrap === 'front' && image?.wrap === 'break') {
        const nextToken = buildImageToken({
          src: image.src,
          align: image.align,
          widthPct: image.widthPct,
          rotationDeg: image.rotationDeg,
          wrap,
          alt: image.alt,
        });
        const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
        const atStart = cursorRef.current <= image.start;

        pushHistory();
        runsRef.current = deleteRange(runsRef.current, image.start, image.end);
        runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));

        let nextCursor = atStart ? image.start : image.start + nextToken.length;
        const trailingOffset = image.start + nextToken.length;
        const nextText = runsToText(runsRef.current);
        if (nextText[trailingOffset] === '\n') {
          runsRef.current = deleteRange(runsRef.current, trailingOffset, trailingOffset + 1);
          if (nextCursor > trailingOffset) nextCursor -= 1;
        }

        cursorRef.current = nextCursor;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        resetBlink();
        draw();
        return;
      }

      if (wrap === 'wrap' && image?.wrap === 'break') {
        const nextAlign = image.align === 'right' || image.align === 'left' ? image.align : 'left';
        const nextToken = buildImageToken({
          src: image.src,
          align: nextAlign,
          widthPct: image.widthPct,
          rotationDeg: image.rotationDeg,
          wrap,
          alt: image.alt,
        });
        const fmt = getFormatAt(runsRef.current, Math.max(0, image.start));
        const atStart = cursorRef.current <= image.start;

        pushHistory();
        runsRef.current = deleteRange(runsRef.current, image.start, image.end);
        runsRef.current = insertRun(runsRef.current, image.start, makeRun(nextToken, { ...fmt }));

        let nextCursor = atStart ? image.start : image.start + nextToken.length;
        const trailingOffset = image.start + nextToken.length;
        const nextText = runsToText(runsRef.current);
        if (nextText[trailingOffset] === '\n') {
          runsRef.current = deleteRange(runsRef.current, trailingOffset, trailingOffset + 1);
          if (nextCursor > trailingOffset) nextCursor -= 1;
        }

        cursorRef.current = nextCursor;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        resetBlink();
        draw();
        return;
      }

      if (wrap === 'wrap') {
        const nextAlign = image?.align === 'right' || image?.align === 'left' ? image.align : 'left';
        patchImageAtCursor({ wrap, align: nextAlign }, true);
        return;
      }

      patchImageAtCursor({ wrap }, true);
    },
    [
      patchImageAtCursor,
      runsRef,
      cursorRef,
      pushHistory,
      selStartRef,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
    ],
  );

  const setImageAltText = useCallback(
    (alt: string) => {
      patchImageAtCursor({ alt }, true);
    },
    [patchImageAtCursor],
  );

  const setCursorOffset = useCallback(
    (offset: number) => {
      cursorRef.current = Math.max(0, offset);
      selStartRef.current = null;
      if (resetFmtOnNextCursorMoveRef.current) {
        const text = runsToText(runsRef.current);
        if (text.length > 0) {
          curFmtRef.current = getFormatAt(
            runsRef.current,
            Math.min(cursorRef.current, text.length - 1),
          );
        }
        resetFmtOnNextCursorMoveRef.current = false;
      }
      notifyFmt();
      resetBlink();
      draw();
      canvasRef.current?.focus();
    },
    [cursorRef, selStartRef, runsRef, curFmtRef, notifyFmt, resetBlink, draw, canvasRef],
  );

  return {
    handleKeyDown,
    handlePaste,
    handleMouseDown,
    handleMouseMove,
    handleWheel,
    applyOrSetFmt,
    getSelRange,
    toggleBullet,
    toggleNumberList,
    indentLeft,
    indentRight,
    setLineSpacing,
    toggleHighlight,
    setHighlightColor,
    toggleSpaceBeforeLine,
    toggleSpaceAfterLine,
    insertLink,
    insertImage,
    setImageAlign,
    setImageWidthPct,
    setImageRotationDeg,
    setImageWrap,
    setImageAltText,
    setCursorOffset,
  };
}
