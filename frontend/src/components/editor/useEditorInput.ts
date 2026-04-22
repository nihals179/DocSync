import { useCallback, useRef } from 'react';
import {
  applyFormatToRange,
  buildTableToken,
  buildImageToken,
  buildPageBreakToken,
  DEFAULT_RUN_FMT,
  detectBulletPrefix,
  deleteRange,
  getBulletCharForLevel,
  clipboardHtmlToRuns,
  getAtomicTokenRanges,
  getFormatAt,
  getImageTokenAtOffset,
  getTableTokenAtOffset,
  getOrderedMarkerForLevel,
  insertRun,
  isFormatUniform,
  makeRun,
  offsetToParaCol,
  paraColToOffset,
  replaceRangeWithRuns,
  runsToText,
  toggleBulletRange,
  updateCellRunsFromText,
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
  requestCursorAutoScroll?: () => void;
  getOffsetFromClientXY: (x: number, y: number) => number | null;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

const HIDDEN_TABLE_BORDER_COLOR = '#ffffff';

export type TableCellRange = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
};

export type TableBorderSegment = {
  axis: 'row' | 'column';
  index: number;
  segment: number;
};

export type TableBorderSegmentRange = {
  axis: 'row' | 'column';
  indexStart: number;
  indexEnd: number;
  segmentStart: number;
  segmentEnd: number;
};

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
    requestCursorAutoScroll,
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
        // Keep toolbar state responsive for repeated actions (e.g. font +/-)
        // while still allowing cursor movement to re-resolve the active format.
        curFmtRef.current = { ...curFmtRef.current, ...patch };
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
    [getSelRange, runsRef, curFmtRef, emitChange, notifyFmt, draw, pushHistory],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const text = runsToText(runsRef.current);
      let cursor = cursorRef.current;
      let handled = true;
      let didNavigation = false;
      let shouldAutoScrollCursor = false;
      const { selF, selT, hasSel } = getSelRange();

      const snapCursorOutsideImage = (next: number, direction?: 'left' | 'right') => {
        const currentText = runsToText(runsRef.current);
        for (const r of getAtomicTokenRanges(currentText)) {
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
        const ranges = getAtomicTokenRanges(currentText);
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
        shouldAutoScrollCursor = true;
        if (hasSel) deleteSelection();
        const enterText = runsToText(runsRef.current);
        // Only treat cursor at image-end as an image boundary — image-start is
        // handled like a normal line: insert \n, image shifts down, cursor stays above.
        const imageBoundary = getAtomicTokenRanges(enterText).find((r) => r.end === cursor) ?? null;
        // Also check if cursor is at image-start so we can keep cursor on the blank line.
        const atImageStart = getAtomicTokenRanges(enterText).some((r) => r.start === cursor);
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
              // Non-empty bullet line → continue the list with same/next prefix
              let prefix: string;
              if (enterBullet.listType === 'number') {
                const nextNum = parseInt(enterBullet.bulletChar, 10) + 1;
                prefix = paraContent.slice(0, enterBullet.indentLen) + `${nextNum}. `;
              } else if (enterBullet.listType === 'letter') {
                const nextLetter = String.fromCharCode(
                  Math.min('z'.charCodeAt(0), enterBullet.bulletChar.charCodeAt(0) + 1),
                );
                prefix = paraContent.slice(0, enterBullet.indentLen) + `${nextLetter}. `;
              } else {
                prefix = paraContent.slice(0, enterBullet.prefixLen);
              }
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
        shouldAutoScrollCursor = true;
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
        if (shouldAutoScrollCursor) requestCursorAutoScroll?.();
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
      requestCursorAutoScroll,
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
      const pasteHtml = e.clipboardData?.getData('text/html') || '';
      pushHistory();
      const { selF, selT, hasSel } = getSelRange();
      const insertPos = hasSel ? selF : resolveInsertOffset(selF);

      const htmlRuns = clipboardHtmlToRuns(pasteHtml, curFmtRef.current);
      if (htmlRuns && htmlRuns.length > 0) {
        runsRef.current = replaceRangeWithRuns(
          runsRef.current,
          insertPos,
          hasSel ? selT : insertPos,
          htmlRuns,
        );
        cursorRef.current = insertPos + runsToText(htmlRuns).length;
        selStartRef.current = null;
        emitChange();
        resetBlink();
        draw();
        return;
      }

      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

      // Auto-detect URLs and paste them as links (blue + underlined)
      const isUrl = /^https?:\/\/[^\s]+$/.test(paste.trim());
      const pasteFmt = isUrl
        ? { ...curFmtRef.current, color: '#2563eb', underline: true, href: paste.trim() }
        : { ...curFmtRef.current };

      // Inline paste should preserve token flow so images move with surrounding edits.
      runsRef.current = insertRun(
        runsRef.current,
        insertPos,
        makeRun(paste, pasteFmt),
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
        frontOpacityPct: number;
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
        frontOpacityPct: patch.frontOpacityPct ?? image.frontOpacityPct,
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
        for (const r of getAtomicTokenRanges(text)) {
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
        for (const r of getAtomicTokenRanges(currentText)) {
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
      curFmtRef,
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
      const normalized = Number.isFinite(value)
        ? Math.max(0, Math.min(7, Math.round(value * 100) / 100))
        : 1.5;
      const { selF, selT, hasSel } = getSelRange();

      if (hasSel) {
        const text = runsToText(runsRef.current);
        const lineStart = text.lastIndexOf('\n', Math.max(0, selF - 1)) + 1;
        const endAnchor = Math.max(selF, selT - 1);
        const lineEndBreak = text.indexOf('\n', endAnchor);
        const lineEnd = lineEndBreak === -1 ? text.length : lineEndBreak + 1;
        pushHistory();
        runsRef.current = applyFormatToRange(runsRef.current, lineStart, lineEnd, {
          lineSpacing: normalized,
        });
        emitChange();
      }

      // Keep insertion format synced so new typing uses the selected spacing.
      curFmtRef.current = { ...curFmtRef.current, lineSpacing: normalized };
      notifyFmt();
      resetBlink();
      draw();
    },
    [
      getSelRange,
      runsRef,
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
    (label: string, url: string) => {
      const normalizedUrl = url.trim();
      if (!normalizedUrl) return;
      const displayText = label.trim() || normalizedUrl;
      const { selF, selT, hasSel } = getSelRange();

      pushHistory();
      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

      const insertPos = resolveInsertOffset(selF);

      const linkFmt: RunFmt = {
        ...curFmtRef.current,
        color: '#2563eb',
        underline: true,
        href: normalizedUrl,
      };
      runsRef.current = insertRun(runsRef.current, insertPos, makeRun(displayText, linkFmt));
      cursorRef.current = insertPos + displayText.length;
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
        wrap: 'inline',
        alt: '',
        frontOpacityPct: 45,
      });

      pushHistory();
      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

      let insertPos = resolveInsertOffset(selF);
      const imageFmt = { ...curFmtRef.current };

      // If there is text directly before the cursor on the same line, split it first.
      const textBeforeInsert = runsToText(runsRef.current);
      if (insertPos > 0 && textBeforeInsert[insertPos - 1] !== '\n') {
        runsRef.current = insertRun(runsRef.current, insertPos, makeRun('\n', imageFmt));
        insertPos += 1;
      }

      runsRef.current = insertRun(runsRef.current, insertPos, makeRun(token, imageFmt));
      const imageStart = insertPos;
      cursorRef.current = insertPos + token.length;
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

  const insertTable = useCallback(
    (rows: number, columns: number) => {
      const safeRows = Math.max(1, Math.min(20, Math.floor(rows)));
      const safeColumns = Math.max(1, Math.min(10, Math.floor(columns)));
      const { selF, selT, hasSel } = getSelRange();
      const token = buildTableToken({
        rows: safeRows,
        columns: safeColumns,
        cells: Array.from({ length: safeRows }, () =>
          Array.from({ length: safeColumns }, () => [] as Run[]),
        ),
        cellPaddingPx: 8,
        widthPx: undefined,
        rowHeightPx: 36,
        columnWidthsPx: Array.from({ length: safeColumns }, () => 200),
        rowHeightsPx: Array.from({ length: safeRows }, () => 36),
        borderWidth: 1,
        borderColor: '#cbd5e1',
        cellBorders: {},
        rowBorders: {},
        columnBorders: {},
        borderSegments: {},
      });

      pushHistory();
      if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

      const insertPos = resolveInsertOffset(selF);
      const textAfterSelection = runsToText(runsRef.current);
      const needsLeadingNewline = insertPos > 0 && textAfterSelection[insertPos - 1] !== '\n';
      const needsTrailingNewline =
        insertPos >= textAfterSelection.length || textAfterSelection[insertPos] !== '\n';
      const insertedText = `${needsLeadingNewline ? '\n' : ''}${token}${needsTrailingNewline ? '\n' : ''}`;

      runsRef.current = insertRun(
        runsRef.current,
        insertPos,
        makeRun(insertedText, { ...curFmtRef.current }),
      );
      cursorRef.current = insertPos + insertedText.length;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    },
    [
      getSelRange,
      runsRef,
      curFmtRef,
      cursorRef,
      selStartRef,
      pushHistory,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
      resolveInsertOffset,
    ],
  );

  const insertPageBreak = useCallback(() => {
    const { selF, selT, hasSel } = getSelRange();
    const token = buildPageBreakToken();

    pushHistory();
    if (hasSel) runsRef.current = deleteRange(runsRef.current, selF, selT);

    const insertPos = resolveInsertOffset(selF);
    const textAfterSelection = runsToText(runsRef.current);
    const needsLeadingNewline = insertPos > 0 && textAfterSelection[insertPos - 1] !== '\n';
    const needsTrailingNewline =
      insertPos >= textAfterSelection.length || textAfterSelection[insertPos] !== '\n';
    const insertedText = `${needsLeadingNewline ? '\n' : ''}${token}${needsTrailingNewline ? '\n' : ''}`;

    runsRef.current = insertRun(
      runsRef.current,
      insertPos,
      makeRun(insertedText, { ...curFmtRef.current }),
    );
    cursorRef.current = insertPos + insertedText.length;
    selStartRef.current = null;
    emitChange();
    notifyFmt();
    resetBlink();
    draw();
  }, [
    getSelRange,
    runsRef,
    curFmtRef,
    cursorRef,
    selStartRef,
    pushHistory,
    emitChange,
    notifyFmt,
    resetBlink,
    draw,
    resolveInsertOffset,
  ]);

  const patchTableAtOffset = useCallback(
    (
      tableOffset: number,
      mutate: (
        table: ReturnType<typeof getTableTokenAtOffset> extends infer T
          ? T extends null
            ? never
            : Omit<Exclude<T, null>, 'start' | 'end'>
          : never,
      ) => {
        rows: number;
        columns: number;
        cells: Run[][][];
        cellPaddingPx?: number;
        columnStartPaddingPx?: number[];
        widthPx?: number;
        rowHeightPx?: number;
        columnWidthsPx?: number[];
        rowHeightsPx?: number[];
        borderWidth: number;
        borderColor: string | null;
        cellBorders: Record<string, { width: number; color: string | null }>;
        rowBorders: Record<string, { width: number; color: string | null }>;
        columnBorders: Record<string, { width: number; color: string | null }>;
        borderSegments: Record<string, { width: number; color: string | null }>;
      } | null,
      options?: { withHistory?: boolean },
    ) => {
      const text = runsToText(runsRef.current);
      const table = getTableTokenAtOffset(text, tableOffset);
      if (!table) return false;

      const next = mutate({
        rows: table.rows,
        columns: table.columns,
        cells: table.cells,
        cellPaddingPx: table.cellPaddingPx,
        columnStartPaddingPx: table.columnStartPaddingPx,
        widthPx: table.widthPx,
        rowHeightPx: table.rowHeightPx,
        columnWidthsPx: table.columnWidthsPx,
        rowHeightsPx: table.rowHeightsPx,
        borderWidth: table.borderWidth,
        borderColor: table.borderColor,
        cellBorders: table.cellBorders,
        rowBorders: table.rowBorders,
        columnBorders: table.columnBorders,
        borderSegments: table.borderSegments,
      });
      if (!next) return false;

      const nextToken = buildTableToken({
        ...next,
        widthPx: next.widthPx ?? table.widthPx,
        rowHeightPx: next.rowHeightPx ?? table.rowHeightPx,
        columnWidthsPx: next.columnWidthsPx ?? table.columnWidthsPx,
        rowHeightsPx: next.rowHeightsPx ?? table.rowHeightsPx,
      });
      const fmt = getFormatAt(runsRef.current, Math.max(0, table.start));
      const atStart = cursorRef.current <= table.start;

      if (options?.withHistory !== false) pushHistory();
      runsRef.current = deleteRange(runsRef.current, table.start, table.end);
      runsRef.current = insertRun(runsRef.current, table.start, makeRun(nextToken, { ...fmt }));
      cursorRef.current = atStart ? table.start : table.start + nextToken.length;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
      return true;
    },
    [runsRef, cursorRef, selStartRef, pushHistory, emitChange, notifyFmt, resetBlink, draw],
  );

  const patchTableAtCursor = useCallback(
    (
      mutate: (
        table: ReturnType<typeof getTableTokenAtOffset> extends infer T
          ? T extends null
            ? never
            : Omit<Exclude<T, null>, 'start' | 'end'>
          : never,
      ) => {
        rows: number;
        columns: number;
        cells: Run[][][];
        cellPaddingPx?: number;
        columnStartPaddingPx?: number[];
        borderWidth: number;
        borderColor: string | null;
        cellBorders: Record<string, { width: number; color: string | null }>;
        rowBorders: Record<string, { width: number; color: string | null }>;
        columnBorders: Record<string, { width: number; color: string | null }>;
        borderSegments: Record<string, { width: number; color: string | null }>;
      } | null,
    ) => {
      return patchTableAtOffset(cursorRef.current, mutate);
    },
    [patchTableAtOffset, cursorRef],
  );

  const setTableCell = useCallback(
    (
      row: number,
      column: number,
      value: string,
      tableOffset?: number,
      withHistory = true,
    ) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      patchTableAtOffset(
        targetOffset,
        (table) => {
          if (row < 0 || row >= table.rows || column < 0 || column >= table.columns) return null;
          const cells = table.cells.map((r) => [...r]);
          const currentRuns = cells[row]?.[column] ?? [];
          cells[row][column] = updateCellRunsFromText(currentRuns, value);
          return { ...table, cells };
        },
        { withHistory },
      );
    },
    [patchTableAtOffset, cursorRef],
  );

  const setTableCellRuns = useCallback(
    (
      row: number,
      column: number,
      value: Run[],
      tableOffset?: number,
      withHistory = true,
    ) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      patchTableAtOffset(
        targetOffset,
        (table) => {
          if (row < 0 || row >= table.rows || column < 0 || column >= table.columns) return null;
          const cells = table.cells.map((r) => [...r]);
          cells[row][column] = value.length > 0 ? value.map((run) => ({ ...run })) : [makeRun('', { ...DEFAULT_RUN_FMT })];
          return { ...table, cells };
        },
        { withHistory },
      );
    },
    [patchTableAtOffset, cursorRef],
  );

  const setTableCellFormat = useCallback(
    (
      row: number,
      column: number,
      patch: Partial<RunFmt>,
      from?: number,
      to?: number,
      tableOffset?: number,
      withHistory = true,
    ) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      patchTableAtOffset(
        targetOffset,
        (table) => {
          if (row < 0 || row >= table.rows || column < 0 || column >= table.columns) return null;
          const currentRuns = table.cells[row]?.[column] ?? [];
          const cellText = runsToText(currentRuns);
          const safeFrom = Math.max(0, from ?? 0);
          const safeTo = Math.min(cellText.length, to ?? cellText.length);
          const newRuns = applyFormatToRange(
            currentRuns.length > 0 ? currentRuns : [makeRun('', { ...DEFAULT_RUN_FMT })],
            safeFrom,
            safeTo,
            patch,
          );
          const cells = table.cells.map((r) => [...r]);
          cells[row][column] = newRuns;
          return { ...table, cells };
        },
        { withHistory },
      );
    },
    [patchTableAtOffset, cursorRef],
  );

  const setTableTrackSize = useCallback(
    (
      patch: { axis: 'row' | 'column'; index: number; sizePx: number },
      tableOffset?: number,
      withHistory = true,
    ) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      patchTableAtOffset(
        targetOffset,
        (table) => {
          if (patch.axis === 'column') {
            if (patch.index < 0 || patch.index >= table.columns) return null;
            const columnWidthsPx = Array.from({ length: table.columns }, (_, index) =>
              Math.max(48, Math.min(960, Math.round(table.columnWidthsPx?.[index] ?? 96))),
            );
            columnWidthsPx[patch.index] = Math.max(48, Math.min(960, Math.round(patch.sizePx)));
            return {
              ...table,
              widthPx: undefined,
              columnWidthsPx,
            };
          }
          if (patch.index < 0 || patch.index >= table.rows) return null;
          const rowHeightsPx = Array.from({ length: table.rows }, (_, index) =>
            Math.max(24, Math.round(table.rowHeightsPx?.[index] ?? table.rowHeightPx ?? 30)),
          );
          rowHeightsPx[patch.index] = Math.max(24, Math.round(patch.sizePx));
          return {
            ...table,
            rowHeightPx: undefined,
            rowHeightsPx,
          };
        },
        { withHistory },
      );
    },
    [patchTableAtOffset, cursorRef],
  );

  const setTableCellPadding = useCallback(
    (paddingPx: number, tableOffset?: number, withHistory = true) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      patchTableAtOffset(
        targetOffset,
        (table) => ({
          ...table,
          cellPaddingPx: Math.max(2, Math.min(32, Math.round(paddingPx))),
        }),
        { withHistory },
      );
    },
    [patchTableAtOffset, cursorRef],
  );

  const setTableColumnStartPadding = useCallback(
    (columnIndex: number, paddingPx: number, tableOffset?: number, withHistory = true) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      const boundedPadding = Math.max(2, Math.min(480, Math.round(paddingPx)));
      patchTableAtOffset(
        targetOffset,
        (table) => {
          if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= table.columns) {
            return null;
          }
          const fallback = table.cellPaddingPx ?? 8;
          const next = Array.isArray(table.columnStartPaddingPx)
            ? [...table.columnStartPaddingPx]
            : new Array(table.columns).fill(fallback);
          while (next.length < table.columns) {
            next.push(fallback);
          }
          if ((next[columnIndex] ?? fallback) === boundedPadding) {
            return null;
          }
          next[columnIndex] = boundedPadding;
          return {
            ...table,
            columnStartPaddingPx: next,
          };
        },
        { withHistory },
      );
    },
    [patchTableAtOffset, cursorRef],
  );

  const addTableRowAbove = useCallback(
    (row: number) => {
      patchTableAtCursor((table) => {
        const at = Math.max(0, Math.min(table.rows, row));
        const cells = table.cells.map((r) => [...r]);
        cells.splice(at, 0, Array.from({ length: table.columns }, () => [] as Run[]));
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.cellBorders ?? {})) {
          const match = key.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          const srcRow = Number.parseInt(match[1], 10);
          const srcColumn = Number.parseInt(match[2], 10);
          const nextRow = srcRow >= at ? srcRow + 1 : srcRow;
          cellBorders[`${nextRow}:${srcColumn}`] = { ...style };
        }
        const rowBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.rowBorders ?? {})) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index)) continue;
          const nextIndex = index >= at + 1 ? index + 1 : index;
          rowBorders[String(nextIndex)] = { ...style };
        }
        return {
          rows: table.rows + 1,
          columns: table.columns,
          cells,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: Array.from({ length: table.columns }, (_, index) => table.columnWidthsPx?.[index] ?? 96),
          rowHeightsPx: [
            ...Array.from({ length: at }, (_, index) => table.rowHeightsPx?.[index] ?? table.rowHeightPx ?? 30),
            table.rowHeightsPx?.[Math.max(0, Math.min(table.rows - 1, at - 1))] ?? table.rowHeightPx ?? 30,
            ...Array.from({ length: Math.max(0, table.rows - at) }, (_, index) =>
              table.rowHeightsPx?.[at + index] ?? table.rowHeightPx ?? 30,
            ),
          ],
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders,
          columnBorders: { ...table.columnBorders },
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const addTableRowBelow = useCallback(
    (row: number) => {
      patchTableAtCursor((table) => {
        const at = Math.max(0, Math.min(table.rows, row + 1));
        const cells = table.cells.map((r) => [...r]);
        cells.splice(at, 0, Array.from({ length: table.columns }, () => [] as Run[]));
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.cellBorders ?? {})) {
          const match = key.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          const srcRow = Number.parseInt(match[1], 10);
          const srcColumn = Number.parseInt(match[2], 10);
          const nextRow = srcRow >= at ? srcRow + 1 : srcRow;
          cellBorders[`${nextRow}:${srcColumn}`] = { ...style };
        }
        const rowBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.rowBorders ?? {})) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index)) continue;
          const nextIndex = index >= at + 1 ? index + 1 : index;
          rowBorders[String(nextIndex)] = { ...style };
        }
        return {
          rows: table.rows + 1,
          columns: table.columns,
          cells,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: Array.from({ length: table.columns }, (_, index) => table.columnWidthsPx?.[index] ?? 96),
          rowHeightsPx: [
            ...Array.from({ length: at }, (_, index) => table.rowHeightsPx?.[index] ?? table.rowHeightPx ?? 30),
            table.rowHeightsPx?.[Math.max(0, Math.min(table.rows - 1, at - 1))] ?? table.rowHeightPx ?? 30,
            ...Array.from({ length: Math.max(0, table.rows - at) }, (_, index) =>
              table.rowHeightsPx?.[at + index] ?? table.rowHeightPx ?? 30,
            ),
          ],
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders,
          columnBorders: { ...table.columnBorders },
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const deleteTableRow = useCallback(
    (row: number) => {
      patchTableAtCursor((table) => {
        if (table.rows <= 1) return null;
        const at = Math.max(0, Math.min(table.rows - 1, row));
        const cells = table.cells.map((r) => [...r]);
        cells.splice(at, 1);
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.cellBorders ?? {})) {
          const match = key.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          const srcRow = Number.parseInt(match[1], 10);
          const srcColumn = Number.parseInt(match[2], 10);
          if (srcRow === at) continue;
          const nextRow = srcRow > at ? srcRow - 1 : srcRow;
          cellBorders[`${nextRow}:${srcColumn}`] = { ...style };
        }
        const rowBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.rowBorders ?? {})) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index)) continue;
          if (index === at + 1) continue;
          const nextIndex = index > at + 1 ? index - 1 : index;
          rowBorders[String(nextIndex)] = { ...style };
        }
        return {
          rows: table.rows - 1,
          columns: table.columns,
          cells,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: Array.from({ length: table.columns }, (_, index) => table.columnWidthsPx?.[index] ?? 96),
          rowHeightsPx: Array.from({ length: table.rows - 1 }, (_, index) => {
            const srcIndex = index >= at ? index + 1 : index;
            return table.rowHeightsPx?.[srcIndex] ?? table.rowHeightPx ?? 30;
          }),
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders,
          columnBorders: { ...table.columnBorders },
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const addTableColumnLeft = useCallback(
    (column: number) => {
      patchTableAtCursor((table) => {
        const at = Math.max(0, Math.min(table.columns, column));
        const cells = table.cells.map((r) => {
          const next = [...r];
          next.splice(at, 0, [] as Run[]);
          return next;
        });
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.cellBorders ?? {})) {
          const match = key.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          const srcRow = Number.parseInt(match[1], 10);
          const srcColumn = Number.parseInt(match[2], 10);
          const nextColumn = srcColumn >= at ? srcColumn + 1 : srcColumn;
          cellBorders[`${srcRow}:${nextColumn}`] = { ...style };
        }
        const columnBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.columnBorders ?? {})) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index)) continue;
          const nextIndex = index >= at + 1 ? index + 1 : index;
          columnBorders[String(nextIndex)] = { ...style };
        }
        return {
          rows: table.rows,
          columns: table.columns + 1,
          cells,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: [
            ...Array.from({ length: at }, (_, index) => table.columnWidthsPx?.[index] ?? 96),
            table.columnWidthsPx?.[Math.max(0, Math.min(table.columns - 1, at - 1))] ?? 96,
            ...Array.from({ length: Math.max(0, table.columns - at) }, (_, index) =>
              table.columnWidthsPx?.[at + index] ?? 96,
            ),
          ],
          rowHeightsPx: Array.from({ length: table.rows }, (_, index) => table.rowHeightsPx?.[index] ?? table.rowHeightPx ?? 30),
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders: { ...table.rowBorders },
          columnBorders,
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const addTableColumnRight = useCallback(
    (column: number) => {
      patchTableAtCursor((table) => {
        const at = Math.max(0, Math.min(table.columns, column + 1));
        const cells = table.cells.map((r) => {
          const next = [...r];
          next.splice(at, 0, [] as Run[]);
          return next;
        });
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.cellBorders ?? {})) {
          const match = key.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          const srcRow = Number.parseInt(match[1], 10);
          const srcColumn = Number.parseInt(match[2], 10);
          const nextColumn = srcColumn >= at ? srcColumn + 1 : srcColumn;
          cellBorders[`${srcRow}:${nextColumn}`] = { ...style };
        }
        const columnBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.columnBorders ?? {})) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index)) continue;
          const nextIndex = index >= at + 1 ? index + 1 : index;
          columnBorders[String(nextIndex)] = { ...style };
        }
        return {
          rows: table.rows,
          columns: table.columns + 1,
          cells,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: [
            ...Array.from({ length: at }, (_, index) => table.columnWidthsPx?.[index] ?? 96),
            table.columnWidthsPx?.[Math.max(0, Math.min(table.columns - 1, at - 1))] ?? 96,
            ...Array.from({ length: Math.max(0, table.columns - at) }, (_, index) =>
              table.columnWidthsPx?.[at + index] ?? 96,
            ),
          ],
          rowHeightsPx: Array.from({ length: table.rows }, (_, index) => table.rowHeightsPx?.[index] ?? table.rowHeightPx ?? 30),
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders: { ...table.rowBorders },
          columnBorders,
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const deleteTableColumn = useCallback(
    (column: number) => {
      patchTableAtCursor((table) => {
        if (table.columns <= 1) return null;
        const at = Math.max(0, Math.min(table.columns - 1, column));
        const cells = table.cells.map((r) => {
          const next = [...r];
          next.splice(at, 1);
          return next;
        });
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.cellBorders ?? {})) {
          const match = key.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          const srcRow = Number.parseInt(match[1], 10);
          const srcColumn = Number.parseInt(match[2], 10);
          if (srcColumn === at) continue;
          const nextColumn = srcColumn > at ? srcColumn - 1 : srcColumn;
          cellBorders[`${srcRow}:${nextColumn}`] = { ...style };
        }
        const columnBorders: Record<string, { width: number; color: string | null }> = {};
        for (const [key, style] of Object.entries(table.columnBorders ?? {})) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index)) continue;
          if (index === at + 1) continue;
          const nextIndex = index > at + 1 ? index - 1 : index;
          columnBorders[String(nextIndex)] = { ...style };
        }
        return {
          rows: table.rows,
          columns: table.columns - 1,
          cells,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: Array.from({ length: table.columns - 1 }, (_, index) => {
            const srcIndex = index >= at ? index + 1 : index;
            return table.columnWidthsPx?.[srcIndex] ?? 96;
          }),
          rowHeightsPx: Array.from({ length: table.rows }, (_, index) => table.rowHeightsPx?.[index] ?? table.rowHeightPx ?? 30),
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders: { ...table.rowBorders },
          columnBorders,
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const deleteTable = useCallback(() => {
    const text = runsToText(runsRef.current);
    const table = getTableTokenAtOffset(text, cursorRef.current);
    if (!table) return;
    pushHistory();
    runsRef.current = deleteRange(runsRef.current, table.start, table.end);
    cursorRef.current = table.start;
    selStartRef.current = null;
    emitChange();
    notifyFmt();
    resetBlink();
    draw();
  }, [runsRef, cursorRef, selStartRef, pushHistory, emitChange, notifyFmt, resetBlink, draw]);

  const sortTableByColumn = useCallback(
    (column: number, direction: 'asc' | 'desc') => {
      patchTableAtCursor((table) => {
        if (column < 0 || column >= table.columns || table.rows <= 1) return null;
        const indexedRows = table.cells.map((rowCells, rowIndex) => ({
          rowIndex,
          cells: [...rowCells],
        }));
        indexedRows.sort((a, b) => {
          const av = runsToText(a.cells[column] ?? []).toLowerCase();
          const bv = runsToText(b.cells[column] ?? []).toLowerCase();
          if (av === bv) return 0;
          if (direction === 'asc') return av < bv ? -1 : 1;
          return av > bv ? -1 : 1;
        });

        const rows = indexedRows.map((entry) => entry.cells);
        const cellBorders: Record<string, { width: number; color: string | null }> = {};
        indexedRows.forEach((entry, newRowIndex) => {
          for (let c = 0; c < table.columns; c++) {
            const style = table.cellBorders[`${entry.rowIndex}:${c}`];
            if (!style) continue;
            cellBorders[`${newRowIndex}:${c}`] = { ...style };
          }
        });
        return {
          rows: table.rows,
          columns: table.columns,
          cells: rows,
          widthPx: table.widthPx,
          rowHeightPx: table.rowHeightPx,
          columnWidthsPx: Array.from({ length: table.columns }, (_, index) => table.columnWidthsPx?.[index] ?? 96),
          rowHeightsPx: indexedRows.map(
            (entry) => table.rowHeightsPx?.[entry.rowIndex] ?? table.rowHeightPx ?? 30,
          ),
          borderWidth: table.borderWidth,
          borderColor: table.borderColor,
          cellBorders,
          rowBorders: { ...table.rowBorders },
          columnBorders: { ...table.columnBorders },
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtCursor],
  );

  const setTableBorders = useCallback(
    (
      patch: { width?: number; color?: string | null; colorless?: boolean },
      range: TableCellRange | null,
      tableOffset?: number,
      selectedSegment?: TableBorderSegment | null,
      selectedSegmentRange?: TableBorderSegmentRange | null,
    ) => {
      const targetOffset = Number.isFinite(tableOffset) ? Number(tableOffset) : cursorRef.current;
      patchTableAtOffset(targetOffset, (table) => {
        const normalizeWidth = (value: number) => Math.max(0, Math.min(8, Math.round(value)));
        const nextDefaultWidth =
          patch.width === undefined ? table.borderWidth : normalizeWidth(patch.width);
        const explicitColor = patch.color === undefined ? table.borderColor : patch.color;
        const nextDefaultColor = patch.colorless ? HIDDEN_TABLE_BORDER_COLOR : explicitColor;

        if (selectedSegmentRange) {
          const nextWidth =
            patch.width === undefined ? table.borderWidth : normalizeWidth(patch.width);
          const baseColor = patch.color === undefined ? table.borderColor : patch.color;
          const nextColor = patch.colorless ? HIDDEN_TABLE_BORDER_COLOR : baseColor;
          const borderSegments = { ...table.borderSegments };
          for (let index = selectedSegmentRange.indexStart; index <= selectedSegmentRange.indexEnd; index++) {
            for (
              let segment = selectedSegmentRange.segmentStart;
              segment <= selectedSegmentRange.segmentEnd;
              segment++
            ) {
              const key =
                selectedSegmentRange.axis === 'row'
                  ? `h:${index}:${segment}`
                  : `v:${index}:${segment}`;
              borderSegments[key] = { width: nextWidth, color: nextColor };
            }
          }
          return {
            ...table,
            borderSegments,
          };
        }

        if (selectedSegment) {
          const nextWidth =
            patch.width === undefined ? table.borderWidth : normalizeWidth(patch.width);
          const baseColor = patch.color === undefined ? table.borderColor : patch.color;
          const nextColor = patch.colorless ? HIDDEN_TABLE_BORDER_COLOR : baseColor;
          const borderSegments = { ...table.borderSegments };
          const key =
            selectedSegment.axis === 'row'
              ? `h:${selectedSegment.index}:${selectedSegment.segment}`
              : `v:${selectedSegment.index}:${selectedSegment.segment}`;
          borderSegments[key] = { width: nextWidth, color: nextColor };
          return {
            ...table,
            borderSegments,
          };
        }

        if (!range) {
          return {
            ...table,
            borderWidth: nextDefaultWidth,
            borderColor: nextDefaultColor,
            // Whole-table styling should override any prior per-cell border overrides.
            cellBorders: {},
            rowBorders: {},
            columnBorders: {},
            borderSegments: {},
          };
        }

        const rowStart = Math.max(0, Math.min(table.rows - 1, Math.min(range.rowStart, range.rowEnd)));
        const rowEnd = Math.max(0, Math.min(table.rows - 1, Math.max(range.rowStart, range.rowEnd)));
        const columnStart = Math.max(
          0,
          Math.min(table.columns - 1, Math.min(range.columnStart, range.columnEnd)),
        );
        const columnEnd = Math.max(
          0,
          Math.min(table.columns - 1, Math.max(range.columnStart, range.columnEnd)),
        );

        const nextWidth = patch.width === undefined ? table.borderWidth : normalizeWidth(patch.width);
        const baseColor = patch.color === undefined ? table.borderColor : patch.color;
        const nextColor = patch.colorless ? HIDDEN_TABLE_BORDER_COLOR : baseColor;

        const rowBorders = { ...table.rowBorders };
        const columnBorders = { ...table.columnBorders };
        rowBorders[String(rowStart)] = { width: nextWidth, color: nextColor };
        rowBorders[String(rowEnd + 1)] = { width: nextWidth, color: nextColor };
        columnBorders[String(columnStart)] = { width: nextWidth, color: nextColor };
        columnBorders[String(columnEnd + 1)] = { width: nextWidth, color: nextColor };

        return {
          ...table,
          rowBorders,
          columnBorders,
          borderSegments: { ...table.borderSegments },
        };
      });
    },
    [patchTableAtOffset, cursorRef],
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
          frontOpacityPct: image.frontOpacityPct,
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
          frontOpacityPct: image.frontOpacityPct,
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
          frontOpacityPct: image.frontOpacityPct,
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
          frontOpacityPct: image.frontOpacityPct,
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
          frontOpacityPct: image.frontOpacityPct,
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
          frontOpacityPct: image.frontOpacityPct,
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

  const setImageFrontOpacityPct = useCallback(
    (frontOpacityPct: number, withHistory = true) => {
      patchImageAtCursor({ frontOpacityPct }, withHistory);
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
    insertTable,
    insertPageBreak,
    setTableCell,
    setTableCellRuns,
    setTableCellFormat,
    setTableTrackSize,
    setTableCellPadding,
    setTableColumnStartPadding,
    addTableRowAbove,
    addTableRowBelow,
    deleteTableRow,
    addTableColumnLeft,
    addTableColumnRight,
    deleteTableColumn,
    deleteTable,
    sortTableByColumn,
    setTableBorders,
    setImageAlign,
    setImageWidthPct,
    setImageRotationDeg,
    setImageWrap,
    setImageAltText,
    setImageFrontOpacityPct,
    setCursorOffset,
  };
}
