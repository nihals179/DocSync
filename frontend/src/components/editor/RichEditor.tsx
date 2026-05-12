// RichEditor — canvas-only rich text editor (thin orchestration shell)
import { useRef, useImperativeHandle, forwardRef, useState, useEffect, useCallback } from 'react';
import MarginRuler from './MarginRuler';
import {
  applyFormatToRange,
  buildImageToken,
  clipboardHtmlToRuns,
  DEFAULT_RUN_FMT,
  deleteRange,
  getFormatAt,
  getImageTokenRanges,
  parseImageToken,
  getTableTokenAtOffset,
  isBulletAtOffset,
  isFormatUniform,
  isNumberListAtOffset,
  isSpaceAfterLineAtOffset,
  isSpaceBeforeLineAtOffset,
  makeRun,
  replaceRangeWithRuns,
  runsToText,
  type ImageTokenMeta,
  type ImageWrap,
  type Run,
  type RunFmt,
} from './textModel';
import type { CursorFormat, ResizeHandle, RichEditorHandle } from './types';
import { IMAGE_RESIZE_HANDLES } from './image/imageUiConfig';
import { BreakLayoutControls, WrapModeControls } from './image/imageWrapControls';
import { CanvasContextMenu, type CanvasMenuAction } from './CanvasContextMenu';
import { getWrapAnchorOffset, resolveImageClickOffsetByWrap } from './image/imageWrapMode';
import { DEFAULT_MARGINS, PAGE_DIMENSIONS, type PageSize } from './pageConfig';
import {
  useEditorDraw,
  type ImageBox,
  type TableHit,
  type TableLineHover,
  type TableLineSelectionRange,
  type TableSelectionRange,
} from './useEditorDraw';
import { useEditorInput } from './useEditorInput';

type RichEditorProps = {
  initialContent?: string;
  onContentChange?: (html: string) => void;
  onRunsChange?: (runs: Run[]) => void;
  /** Called whenever the cursor position or formatting changes */
  onCursorFormatChange?: (fmt: CursorFormat) => void;
  pageSize: PageSize;
};

const PAPER_MODE_DEFAULT_FONT_SIZE = 11;
const PAPER_MODE_DEFAULT_LINE_SPACING = 1;
const PAPER_MODE_PAGE_GAP_PX = 44;
const getDefaultFontSizeForPageSize = (size: PageSize) =>
  size === 'responsive' ? DEFAULT_RUN_FMT.fontSize : PAPER_MODE_DEFAULT_FONT_SIZE;
const getDefaultLineSpacingForPageSize = (size: PageSize) =>
  size === 'responsive' ? DEFAULT_RUN_FMT.lineSpacing : PAPER_MODE_DEFAULT_LINE_SPACING;

// ── Component ────────────────────────────────────────────────────────────────
const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(
  ({ initialContent, onContentChange, onRunsChange, onCursorFormatChange, pageSize }, ref) => {
    const IMAGE_ALIGN_OPTIONS: Array<{
      key: 'left' | 'center' | 'right';
      icon: 'format_align_left' | 'format_align_center' | 'format_align_right';
      title: string;
      order: '1' | '2' | '3';
    }> = [
      { key: 'left', icon: 'format_align_left', title: 'Align left', order: '1' },
      { key: 'center', icon: 'format_align_center', title: 'Align center', order: '2' },
      { key: 'right', icon: 'format_align_right', title: 'Align right', order: '3' },
    ];

    const renderWrapAlignIcon = useCallback(
      (align: 'left' | 'center' | 'right', className: string) => {
        if (align === 'left') {
          return (
            <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
              <path d="M120-280v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm480 160v-80h240v80H600Zm0 160v-80h240v80H600Zm0 160v-80h240v80H600ZM120-120v-80h720v80H120Zm200-360Z" />
            </svg>
          );
        }
        if (align === 'center') {
          return (
            <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
              <path d="M120-120v-80h720v80H120Zm0-160v-80h100v80H120Zm160 0v-400h400v400H280Zm460 0v-80h100v80H740Zm-380-80h240v-240H360v240Zm-240-80v-80h100v80H120Zm620 0v-80h100v80H740ZM120-600v-80h100v80H120Zm620 0v-80h100v80H740ZM120-760v-80h720v80H120Zm360 280Z" />
            </svg>
          );
        }
        return (
          <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
            <path d="M440-280v-400h400v400H440Zm80-80h240v-240H520v240ZM120-120v-80h720v80H120Zm0-160v-80h240v80H120Zm0-160v-80h240v80H120Zm0-160v-80h240v80H120Zm0-160v-80h720v80H120Zm520 280Z" />
          </svg>
        );
      },
      [],
    );

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pageElRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    const [leftMargin, setLeftMargin] = useState(DEFAULT_MARGINS[pageSize].left);
    const [rightMargin, setRightMargin] = useState(DEFAULT_MARGINS[pageSize].right);
    const [hoveredImage, setHoveredImage] = useState<ImageBox | null>(null);
    const [selectedImage, setSelectedImage] = useState<ImageBox | null>(null);
    const [isImagePanelOpen, setIsImagePanelOpen] = useState(false);
    const syncOverlayRafRef = useRef<number | null>(null);
    const [altDraft, setAltDraft] = useState('');
    const [contentVersion, setContentVersion] = useState(0);
    const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [showQuickFormatting, setShowQuickFormatting] = useState(false);
    const [paperPagination, setPaperPagination] = useState<{ pageCount: number; pageHeightPx: number }>(
      {
        pageCount: 1,
        pageHeightPx: 0,
      },
    );
    const [quickFormattingState, setQuickFormattingState] = useState({
      bold: false,
      italic: false,
      underline: false,
      fontFamily: DEFAULT_RUN_FMT.fontFamily,
      fontSize: getDefaultFontSizeForPageSize(pageSize),
      color: DEFAULT_RUN_FMT.color,
      highlightColor: DEFAULT_RUN_FMT.highlightColor as string | null,
    });
    const prevPageSize = useRef(pageSize);
    const isPaperMode = pageSize !== 'responsive';
    const paperSize = isPaperMode
      ? PAGE_DIMENSIONS[pageSize as Exclude<PageSize, 'responsive'>]
      : null;
    const paperHeightRatio = paperSize ? paperSize.heightMm / paperSize.widthMm : null;
    const paperWidthMm = paperSize?.widthMm ?? null;
    const paperCanvasHeight =
      isPaperMode && paperSize
        ? paperPagination.pageHeightPx > 0
          ? paperPagination.pageCount * paperPagination.pageHeightPx +
            Math.max(0, paperPagination.pageCount - 1) * PAPER_MODE_PAGE_GAP_PX
          : paperSize.height
        : '100%';

    // ── Document refs ─────────────────────────────────────────────────────────
    const runsRef = useRef<Run[]>([
      makeRun(initialContent ?? '', {
        ...DEFAULT_RUN_FMT,
        fontSize: getDefaultFontSizeForPageSize(pageSize),
        lineSpacing: getDefaultLineSpacingForPageSize(pageSize),
      }),
    ]);
    const cursorRef = useRef(initialContent?.length ?? 0);
    const scrollYRef = useRef(0);
    const blinkRef = useRef(true);
    const blinkTimerRef = useRef<number | null>(null);
    const formatPainterRef = useRef<RunFmt | null>(null);
    const selStartRef = useRef<number | null>(null);
    const curFmtRef = useRef<RunFmt>({
      ...DEFAULT_RUN_FMT,
      fontSize: getDefaultFontSizeForPageSize(pageSize),
      lineSpacing: getDefaultLineSpacingForPageSize(pageSize),
    });
    const isDraggingRef = useRef(false);
    const tableInputRef = useRef<HTMLTextAreaElement | null>(null);
    const selectedTableHitRef = useRef<TableHit | null>(null);
    const tableSelectionRangeRef = useRef<TableSelectionRange | null>(null);
    const hoveredTableLineRef = useRef<TableLineHover | null>(null);
    const selectedTableLineRef = useRef<TableLineHover | null>(null);
    const selectedTableLineRangeRef = useRef<TableLineSelectionRange | null>(null);
    const isTableCellEditingRef = useRef(false);
    const activeTableEditingCellRef = useRef<{
      tableStart: number;
      row: number;
      column: number;
    } | null>(null);
    const tableCellCursorRef = useRef<{
      tableStart: number;
      row: number;
      column: number;
      offset: number;
    } | null>(null);
    const tableTextSelectionRef = useRef<{
      tableStart: number;
      row: number;
      column: number;
      start: number;
      end: number;
    } | null>(null);
    const tableTextSelectionAnchorRef = useRef<{
      tableStart: number;
      row: number;
      column: number;
      offset: number;
    } | null>(null);
    const isTableTextSelectingRef = useRef(false);
    const autoScrollCursorIntoViewRef = useRef(false);
    const undoStackRef = useRef<Array<{ runs: Run[]; cursor: number }>>([]);
    const redoStackRef = useRef<Array<{ runs: Run[]; cursor: number }>>([]);

    const emitChange = useCallback(() => {
      onContentChange?.(runsToText(runsRef.current));
      onRunsChange?.(runsRef.current.map((run) => ({ ...run })));
      setContentVersion((value) => value + 1);
    }, [onContentChange, onRunsChange]);
    const notifyFmt = useCallback(() => {
      const activeCell = activeTableEditingCellRef.current;
      if (isTableCellEditingRef.current && activeCell) {
        const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), activeCell.tableStart);
        if (tableMeta) {
          const cellRuns = tableMeta.cells?.[activeCell.row]?.[activeCell.column] ?? [];
          const cellText = runsToText(cellRuns);
          const cursorOffset =
            tableCellCursorRef.current?.tableStart === activeCell.tableStart &&
            tableCellCursorRef.current?.row === activeCell.row &&
            tableCellCursorRef.current?.column === activeCell.column
              ? tableCellCursorRef.current.offset
              : cellText.length;
          const safeCursor = Math.max(0, Math.min(cellText.length, cursorOffset));
          const tableSelection = tableTextSelectionRef.current;
          const hasTableSelection =
            Boolean(tableSelection) &&
            tableSelection?.tableStart === activeCell.tableStart &&
            tableSelection?.row === activeCell.row &&
            tableSelection?.column === activeCell.column &&
            tableSelection.end > tableSelection.start;
          const tableSelF = hasTableSelection ? tableSelection!.start : safeCursor;
          const tableSelT = hasTableSelection ? tableSelection!.end : safeCursor;

          const getUniformCellField = <K extends keyof RunFmt>(key: K): RunFmt[K] | null => {
            if (!hasTableSelection || tableSelF >= tableSelT) return null;
            let pos = 0;
            let value: RunFmt[K] | null = null;
            for (const run of cellRuns) {
              const end = pos + run.text.length;
              if (end > tableSelF && pos < tableSelT) {
                const runValue = run[key] as RunFmt[K];
                if (value === null) value = runValue;
                else if (value !== runValue) return null;
              }
              pos = end;
            }
            return value;
          };

          const anchorOffset = hasTableSelection
            ? Math.max(0, Math.min(tableSelF, Math.max(0, cellText.length - 1)))
            : Math.max(0, Math.min(Math.max(0, safeCursor - 1), Math.max(0, cellText.length - 1)));
          const anchorFmt = cellRuns.length > 0
            ? getFormatAt(cellRuns, Math.max(0, Math.min(anchorOffset, cellText.length)))
            : curFmtRef.current;
          const tableEffectiveFmt: RunFmt = hasTableSelection
            ? {
                ...anchorFmt,
                bold: isFormatUniform(cellRuns, tableSelF, tableSelT, 'bold', true),
                italic: isFormatUniform(cellRuns, tableSelF, tableSelT, 'italic', true),
                underline: isFormatUniform(cellRuns, tableSelF, tableSelT, 'underline', true),
                fontFamily: getUniformCellField('fontFamily') ?? anchorFmt.fontFamily,
                fontSize: getUniformCellField('fontSize') ?? anchorFmt.fontSize,
                color: getUniformCellField('color') ?? anchorFmt.color,
                highlightColor: getUniformCellField('highlightColor') ?? anchorFmt.highlightColor,
              }
            : anchorFmt;

          onCursorFormatChange?.({
            ...tableEffectiveFmt,
            bullet: false,
            numberList: false,
            hasSpaceBeforeLine: false,
            hasSpaceAfterLine: false,
            imageSelected: Boolean(selectedImage),
            imagePanelOpen: Boolean(selectedImage) && isImagePanelOpen,
            imageAlign: (selectedImage?.meta.align as 'left' | 'center' | 'right') ?? 'center',
            imageWidthPct: selectedImage?.meta.widthPct ?? 100,
            tableSelected: true,
            tablePanelOpen: true,
            tablePartialTextSelection: hasTableSelection,
            tableRoundedBorders: Boolean((tableMeta.tableBorderRadiusPx ?? 0) > 0),
            tableBorderRadiusPx: Math.max(0, Math.min(24, Math.round(tableMeta.tableBorderRadiusPx ?? 0))),
          });
          return;
        }
      }

      const text = runsToText(runsRef.current);
      const hasSel =
        selStartRef.current !== null && selStartRef.current !== cursorRef.current;
      const selF = hasSel ? Math.min(selStartRef.current!, cursorRef.current) : cursorRef.current;
      const selT = hasSel ? Math.max(selStartRef.current!, cursorRef.current) : cursorRef.current;

      const getUniformField = <K extends keyof RunFmt>(key: K): RunFmt[K] | null => {
        if (!hasSel || selF >= selT) return null;
        let pos = 0;
        let value: RunFmt[K] | null = null;
        for (const run of runsRef.current) {
          const end = pos + run.text.length;
          if (end > selF && pos < selT) {
            const runValue = run[key] as RunFmt[K];
            if (value === null) value = runValue;
            else if (value !== runValue) return null;
          }
          pos = end;
        }
        return value;
      };

      const anchorOffset = Math.max(0, Math.min(selF, Math.max(0, text.length - 1)));
      const anchorFmt = text.length > 0 ? getFormatAt(runsRef.current, anchorOffset) : curFmtRef.current;
      const effectiveFmt: RunFmt = hasSel
        ? {
            ...anchorFmt,
            bold: isFormatUniform(runsRef.current, selF, selT, 'bold', true),
            italic: isFormatUniform(runsRef.current, selF, selT, 'italic', true),
            underline: isFormatUniform(runsRef.current, selF, selT, 'underline', true),
            fontFamily: getUniformField('fontFamily') ?? anchorFmt.fontFamily,
            fontSize: getUniformField('fontSize') ?? anchorFmt.fontSize,
            color: getUniformField('color') ?? anchorFmt.color,
            highlightColor: getUniformField('highlightColor') ?? anchorFmt.highlightColor,
          }
        : curFmtRef.current;

      const bullet = isBulletAtOffset(text, cursorRef.current);
      const numberList = isNumberListAtOffset(text, cursorRef.current);
      const hasSpaceBeforeLine = isSpaceBeforeLineAtOffset(text, cursorRef.current);
      const hasSpaceAfterLine = isSpaceAfterLineAtOffset(text, cursorRef.current);
      const hasTableBorderSelection =
        Boolean(selectedTableLineRef.current) || Boolean(selectedTableLineRangeRef.current);
      const hasTableSelection = Boolean(selectedTableHitRef.current) || hasTableBorderSelection;
      onCursorFormatChange?.({
        ...effectiveFmt,
        bullet,
        numberList,
        hasSpaceBeforeLine,
        hasSpaceAfterLine,
        imageSelected: Boolean(selectedImage),
        imagePanelOpen: Boolean(selectedImage) && isImagePanelOpen,
        imageAlign: (selectedImage?.meta.align as 'left' | 'center' | 'right') ?? 'center',
        imageWidthPct: selectedImage?.meta.widthPct ?? 100,
        tableSelected: hasTableSelection,
        tablePanelOpen: hasTableSelection,
        tablePartialTextSelection: false,
        tableRoundedBorders: false,
        tableBorderRadiusPx: 0,
      });
    }, [onCursorFormatChange, selectedImage, isImagePanelOpen]);

    // ── Drawing hook ──────────────────────────────────────────────────────────
    const drawRefs = {
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
    };
    const {
      draw,
      resetBlink,
      getOffsetFromClientXY,
      getImageBoxAtClientXY,
      getImageBoxAtOffset,
      getResolvedImageBox,
      getTableHitAtClientXY,
      getTableTextHitAtClientXY,
      getTableBorderLineAtClientXY,
      getTableCellImageBox,
    } = useEditorDraw(
      drawRefs,
      leftMargin,
      rightMargin,
      isPaperMode,
      paperHeightRatio,
      paperWidthMm,
      (pageCount, pageHeightPx) => {
        setPaperPagination((prev) => {
          if (prev.pageCount === pageCount && prev.pageHeightPx === pageHeightPx) return prev;
          return { pageCount, pageHeightPx };
        });
      },
    );

    // ── History ───────────────────────────────────────────────────────────────
    const pushHistory = useCallback(() => {
      undoStackRef.current.push({
        runs: runsRef.current.map((r) => ({ ...r })),
        cursor: cursorRef.current,
      });
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      redoStackRef.current = [];
    }, []);

    const undoFn = useCallback(() => {
      const entry = undoStackRef.current.pop();
      if (!entry) return;
      redoStackRef.current.push({
        runs: runsRef.current.map((r) => ({ ...r })),
        cursor: cursorRef.current,
      });
      runsRef.current = entry.runs;
      cursorRef.current = entry.cursor;
      selStartRef.current = null;
      const flatText = runsToText(entry.runs);
      if (flatText.length > 0) {
        curFmtRef.current = getFormatAt(entry.runs, Math.min(entry.cursor, flatText.length - 1));
      }
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    }, [emitChange, notifyFmt, resetBlink, draw]);

    const redoFn = useCallback(() => {
      const entry = redoStackRef.current.pop();
      if (!entry) return;
      undoStackRef.current.push({
        runs: runsRef.current.map((r) => ({ ...r })),
        cursor: cursorRef.current,
      });
      runsRef.current = entry.runs;
      cursorRef.current = entry.cursor;
      selStartRef.current = null;
      const flatText = runsToText(entry.runs);
      if (flatText.length > 0) {
        curFmtRef.current = getFormatAt(entry.runs, Math.min(entry.cursor, flatText.length - 1));
      }
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    }, [emitChange, notifyFmt, resetBlink, draw]);

    // ── Input hook ────────────────────────────────────────────────────────────
    const inputRefs = {
      canvasRef,
      runsRef,
      cursorRef,
      selStartRef,
      curFmtRef,
      isDraggingRef,
    };
    const inputCbs = {
      draw,
      resetBlink,
      emitChange,
      notifyFmt,
      getOffsetFromClientXY,
      pushHistory,
      undo: undoFn,
      redo: redoFn,
    };
    const {
      handleKeyDown,
      handlePaste,
      pastePlainText,
      pasteWithSourceFormat,
      handleMouseDown,
      handleMouseMove,
      handleWheel: _handleWheel,
      applyOrSetFmt,
      getSelRange,
      toggleBullet,
      toggleNumberList,
      indentLeft,
      indentRight,
      setLineSpacing,
      toggleHighlight,
      setHighlightColor,
      setTableCellFormat,
      toggleSpaceBeforeLine,
      toggleSpaceAfterLine,
      insertLink,
      insertImage,
      insertTable,
      insertPageBreak,
      setImageAlign,
      setImageWidthPct,
      setImageRotationDeg,
      setImageWrap,
      setImageAltText,
      setImageFrontOpacityPct,
      setTableCell,
      setTableCellRuns,
      setTableTrackSize,
      addTableRowAbove,
      addTableRowBelow,
      addTableColumnLeft,
      addTableColumnRight,
      setTableBorders,
      setTableBorderRadius,
      setCursorOffset,
    } = useEditorInput(inputRefs, {
      ...inputCbs,
      onImageInserted: (offset: number) => {
        // Defer selection until after next draw so imageBoxesRef is up-to-date
        if (syncOverlayRafRef.current !== null) {
          cancelAnimationFrame(syncOverlayRafRef.current);
        }
        syncOverlayRafRef.current = window.requestAnimationFrame(() => {
          syncOverlayRafRef.current = null;
          const imageBox = getImageBoxAtOffset(offset);
          if (imageBox) {
            setSelectedImage(imageBox);
            setAltDraft(imageBox.meta.alt);
          }
        });
      },
    });

    const syncImageOverlay = useCallback(
      (image: Pick<ImageBox, 'start' | 'end' | 'meta' | 'tableImage'> | null) => {
        if (syncOverlayRafRef.current !== null) {
          cancelAnimationFrame(syncOverlayRafRef.current);
        }
        syncOverlayRafRef.current = window.requestAnimationFrame(() => {
          syncOverlayRafRef.current = null;
          if (image === null) {
            setSelectedImage(null);
            return;
          }
          const next = getResolvedImageBox(image);
          setSelectedImage(next);
          if (next) setAltDraft(next.meta.alt);
        });
      },
      [getResolvedImageBox],
    );

    const handleWheel = useCallback(
      (e: React.WheelEvent) => {
        _handleWheel(e, scrollYRef);
        if (selectedImage) syncImageOverlay(selectedImage);
      },
      [_handleWheel, scrollYRef, selectedImage, syncImageOverlay],
    );

    const handleCanvasMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isTableTextSelectingRef.current) {
          if ((e.buttons & 1) === 0) {
            isTableTextSelectingRef.current = false;
            tableTextSelectionAnchorRef.current = null;
            notifyFmt();
            resetBlink();
            draw();
            return;
          }

          const anchor = tableTextSelectionAnchorRef.current;
          const hit = getTableTextHitAtClientXY(e.clientX, e.clientY);
          if (anchor && hit) {
            const sameTable = anchor.tableStart === hit.box.start;
            const sameCell =
              sameTable &&
              anchor.row === hit.row &&
              anchor.column === hit.column;
            if (sameCell) {
              if (selectedImage || isImagePanelOpen) {
                setSelectedImage(null);
                setHoveredImage(null);
                setIsImagePanelOpen(false);
              }
              const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), hit.box.start);
              const cellText = tableMeta
                ? runsToText(tableMeta.cells?.[hit.row]?.[hit.column] ?? [])
                : '';
              const ranges = getImageTokenRanges(cellText);
              const snapOffset = (offset: number) => {
                for (const range of ranges) {
                  if (offset > range.start && offset < range.end) {
                    return Math.abs(offset - range.start) <= Math.abs(range.end - offset)
                      ? range.start
                      : range.end;
                  }
                }
                return offset;
              };
              const hitOffset = snapOffset(hit.offset);
              const anchorOffset = snapOffset(anchor.offset);
              tableCellCursorRef.current = {
                tableStart: hit.box.start,
                row: hit.row,
                column: hit.column,
                offset: hitOffset,
              };
              const from = Math.min(anchorOffset, hitOffset);
              const to = Math.max(anchorOffset, hitOffset);
              tableTextSelectionRef.current =
                to > from
                  ? {
                      tableStart: hit.box.start,
                      row: hit.row,
                      column: hit.column,
                      start: from,
                      end: to,
                    }
                  : null;
              notifyFmt();
              resetBlink();
              draw();
              return;
            }

            if (sameTable) {
              if (selectedImage || isImagePanelOpen) {
                setSelectedImage(null);
                setHoveredImage(null);
                setIsImagePanelOpen(false);
              }
              // Dragging into another cell switches to cell-range selection.
              tableTextSelectionRef.current = null;
              tableCellCursorRef.current = null;
              tableSelectionRangeRef.current = {
                rowStart: anchor.row,
                rowEnd: hit.row,
                columnStart: anchor.column,
                columnEnd: hit.column,
              };
              isTableCellEditingRef.current = false;
              activeTableEditingCellRef.current = null;
              notifyFmt();
              resetBlink();
              draw();
              return;
            }
          }
        }

        const borderLine = getTableBorderLineAtClientXY(e.clientX, e.clientY);
        if (borderLine) {
          const prev = hoveredTableLineRef.current;
          if (
            !prev ||
            prev.box.start !== borderLine.box.start ||
            prev.axis !== borderLine.axis ||
            prev.index !== borderLine.index ||
            prev.segment !== borderLine.segment
          ) {
            hoveredTableLineRef.current = borderLine;
            draw();
          }
          const canvas = canvasRef.current;
          if (canvas) canvas.style.cursor = borderLine.axis === 'row' ? 'ns-resize' : 'ew-resize';
          return;
        }
        if (hoveredTableLineRef.current) {
          hoveredTableLineRef.current = null;
          draw();
        }

        handleMouseMove();
        const next = getImageBoxAtClientXY(e.clientX, e.clientY);
        setHoveredImage(next);
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = next ? 'pointer' : 'text';
      },
      [
        handleMouseMove,
        getImageBoxAtClientXY,
        getTableTextHitAtClientXY,
        getTableBorderLineAtClientXY,
        selectedImage,
        isImagePanelOpen,
        notifyFmt,
        resetBlink,
        draw,
      ],
    );

    const handleCanvasMouseUp = useCallback(() => {
      if (!isTableTextSelectingRef.current) return;
      isTableTextSelectingRef.current = false;
      tableTextSelectionAnchorRef.current = null;
      notifyFmt();
      resetBlink();
      draw();
    }, [notifyFmt, resetBlink, draw]);

    const handleCanvasMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return;
        if (isMenuOpen) setIsMenuOpen(false);

        const imageHit = getImageBoxAtClientXY(e.clientX, e.clientY);
        if (!imageHit && (selectedImage || hoveredImage || isImagePanelOpen)) {
          if (syncOverlayRafRef.current !== null) {
            cancelAnimationFrame(syncOverlayRafRef.current);
            syncOverlayRafRef.current = null;
          }
          setSelectedImage(null);
          setHoveredImage(null);
          setIsImagePanelOpen(false);
        }
        if (imageHit) {
          e.preventDefault();

          if (imageHit.tableImage) {
            const tableStart = imageHit.tableImage.tableStart;
            const row = imageHit.tableImage.row;
            const column = imageHit.tableImage.column;

            const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), tableStart);
            const cellText = tableMeta
              ? runsToText(tableMeta.cells?.[row]?.[column] ?? [])
              : '';
            const ranges = getImageTokenRanges(cellText);
            const tokenRange = ranges[imageHit.tableImage.tokenRangeIndex] ?? null;

            const canvasRect = canvasRef.current?.getBoundingClientRect();
            const clickX = canvasRect ? e.clientX - canvasRect.left : imageHit.x;
            // Deterministic placement: left half => before image, right half => after image.
            const clickBeforeImage = clickX < imageHit.x + imageHit.width / 2;
            const nextOffset = tokenRange
              ? clickBeforeImage
                ? tokenRange.start
                : tokenRange.end
              : cellText.length;

            const tableHit = getTableHitAtClientXY(e.clientX, e.clientY);
            selectedTableHitRef.current =
              tableHit ?? {
                box: {
                  start: tableStart,
                  end: tableStart,
                  x: imageHit.x,
                  y: imageHit.y,
                  width: imageHit.width,
                  height: imageHit.height,
                  rows: tableMeta?.rows ?? 1,
                  columns: tableMeta?.columns ?? 1,
                  rowHeight: imageHit.height,
                  cellWidth: imageHit.width,
                  rowHeights: tableMeta ? new Array(tableMeta.rows).fill(0) : [imageHit.height],
                  columnWidths: tableMeta ? new Array(tableMeta.columns).fill(0) : [imageHit.width],
                  rowOffsets: tableMeta ? new Array(tableMeta.rows + 1).fill(0) : [0, imageHit.height],
                  columnOffsets: tableMeta ? new Array(tableMeta.columns + 1).fill(0) : [0, imageHit.width],
                },
                row,
                column,
              };
            tableSelectionRangeRef.current = {
              rowStart: row,
              rowEnd: row,
              columnStart: column,
              columnEnd: column,
            };
            isTableCellEditingRef.current = true;
            activeTableEditingCellRef.current = {
              tableStart,
              row,
              column,
            };
            tableCellCursorRef.current = {
              tableStart,
              row,
              column,
              offset: nextOffset,
            };
            tableTextSelectionRef.current = null;
            tableTextSelectionAnchorRef.current = null;
            isTableTextSelectingRef.current = false;
            setSelectedImage(imageHit);
            setHoveredImage(imageHit);
            setAltDraft(imageHit.meta.alt);
            setIsImagePanelOpen(false);
            setCursorOffset(tableStart);
            notifyFmt();
            resetBlink();
            draw();
            return;
          }

          const canvasRect = canvasRef.current?.getBoundingClientRect();
          const clickX = canvasRect ? e.clientX - canvasRect.left : imageHit.x;
          const midX = imageHit.x + imageHit.width / 2;
          const text = runsToText(runsRef.current);
          const nextOffset = resolveImageClickOffsetByWrap({
            wrap: imageHit.meta.wrap,
            text,
            imageStart: imageHit.start,
            imageEnd: imageHit.end,
            clickX,
            imageMidX: midX,
          });
          setCursorOffset(nextOffset);
          setSelectedImage(imageHit);
          setAltDraft(imageHit.meta.alt);
          return;
        }

        const tableBorderLine = getTableBorderLineAtClientXY(e.clientX, e.clientY);
        if (tableBorderLine) {
          e.preventDefault();
          setSelectedImage(null);
          setHoveredImage(null);
          setIsImagePanelOpen(false);
          const tableHitForBorder = getTableHitAtClientXY(e.clientX, e.clientY);
          if (tableHitForBorder) {
            selectedTableHitRef.current = tableHitForBorder;
          }
          hoveredTableLineRef.current = tableBorderLine;

          const prev = selectedTableLineRef.current;
          if (
            e.shiftKey &&
            prev &&
            prev.box.start === tableBorderLine.box.start &&
            prev.axis === tableBorderLine.axis
          ) {
            selectedTableLineRangeRef.current = {
              box: tableBorderLine.box,
              axis: tableBorderLine.axis,
              indexStart: Math.min(prev.index, tableBorderLine.index),
              indexEnd: Math.max(prev.index, tableBorderLine.index),
              segmentStart: Math.min(prev.segment, tableBorderLine.segment),
              segmentEnd: Math.max(prev.segment, tableBorderLine.segment),
            };
          } else {
            selectedTableLineRef.current = tableBorderLine;
            selectedTableLineRangeRef.current = null;
          }

          if (!e.shiftKey) {
            const isRowAxis = tableBorderLine.axis === 'row';
            const maxTrackCount = isRowAxis ? tableBorderLine.box.rows : tableBorderLine.box.columns;
            const rawTrackIndex =
              tableBorderLine.index <= 0
                ? 0
                : tableBorderLine.index >= maxTrackCount
                  ? maxTrackCount - 1
                  : tableBorderLine.index - 1;
            const trackIndex = Math.max(0, Math.min(maxTrackCount - 1, rawTrackIndex));
            const startSize = isRowAxis
              ? Math.max(24, Math.round(tableBorderLine.box.rowHeights[trackIndex] ?? tableBorderLine.box.rowHeight))
              : Math.max(48, Math.round(tableBorderLine.box.columnWidths[trackIndex] ?? tableBorderLine.box.cellWidth));
            const startPointer = isRowAxis ? e.clientY : e.clientX;
            let lastSize = startSize;

            const onMove = (ev: MouseEvent) => {
              const delta = (isRowAxis ? ev.clientY : ev.clientX) - startPointer;
              const nextSize = isRowAxis
                ? Math.max(24, Math.round(startSize + delta))
                : Math.max(48, Math.min(960, Math.round(startSize + delta)));
              lastSize = nextSize;
              setTableTrackSize(
                {
                  axis: isRowAxis ? 'row' : 'column',
                  index: trackIndex,
                  sizePx: nextSize,
                },
                tableBorderLine.box.start,
                false,
              );
            };

            const onUp = () => {
              setTableTrackSize(
                {
                  axis: isRowAxis ? 'row' : 'column',
                  index: trackIndex,
                  sizePx: lastSize,
                },
                tableBorderLine.box.start,
                true,
              );
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }

          tableSelectionRangeRef.current = null;
          isTableCellEditingRef.current = false;
          activeTableEditingCellRef.current = null;
          tableCellCursorRef.current = null;
          tableTextSelectionRef.current = null;
          tableTextSelectionAnchorRef.current = null;
          isTableTextSelectingRef.current = false;
          notifyFmt();
          resetBlink();
          draw();
          return;
        }

        const tableHit = getTableHitAtClientXY(e.clientX, e.clientY);
        if (tableHit) {
          e.preventDefault();
          setSelectedImage(null);
          setHoveredImage(null);
          setIsImagePanelOpen(false);
          selectedTableHitRef.current = tableHit;
          tableSelectionRangeRef.current = {
            rowStart: tableHit.row,
            rowEnd: tableHit.row,
            columnStart: tableHit.column,
            columnEnd: tableHit.column,
          };
          selectedTableLineRef.current = null;
          selectedTableLineRangeRef.current = null;
          hoveredTableLineRef.current = null;
          isTableCellEditingRef.current = true;
          activeTableEditingCellRef.current = {
            tableStart: tableHit.box.start,
            row: tableHit.row,
            column: tableHit.column,
          };

          const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), tableHit.box.start);
          const cellText = tableMeta
            ? runsToText(tableMeta.cells?.[tableHit.row]?.[tableHit.column] ?? [])
            : '';
          const textHit = getTableTextHitAtClientXY(e.clientX, e.clientY);
          const canvasRect = canvasRef.current?.getBoundingClientRect();
          const clickX = canvasRect ? e.clientX - canvasRect.left : 0;
          const clickY = canvasRect ? e.clientY - canvasRect.top : 0;
          const ranges = getImageTokenRanges(cellText);
          const snapOffset = (offset: number) => {
            for (const range of ranges) {
              if (offset > range.start && offset < range.end) {
                return Math.abs(offset - range.start) <= Math.abs(range.end - offset)
                  ? range.start
                  : range.end;
              }
            }
            return offset;
          };
          const resolveOffsetFromImageGeometry = (candidateOffset: number) => {
            for (let tokenRangeIndex = 0; tokenRangeIndex < ranges.length; tokenRangeIndex += 1) {
              const range = ranges[tokenRangeIndex];
              const imageBox = getTableCellImageBox(
                tableHit.box.start,
                tableHit.row,
                tableHit.column,
                tokenRangeIndex,
              );
              if (!imageBox) continue;

              const clickedInsideImage =
                clickX >= imageBox.x - 1 &&
                clickX <= imageBox.x + imageBox.width + 1 &&
                clickY >= imageBox.y - 1 &&
                clickY <= imageBox.y + imageBox.height + 1;

              if (clickedInsideImage) {
                const isBefore = clickX < imageBox.x + imageBox.width / 2;
                return isBefore ? range.start : range.end;
              }
            }

            return snapOffset(candidateOffset);
          };
          const initialOffset = resolveOffsetFromImageGeometry(textHit ? textHit.offset : cellText.length);
          tableCellCursorRef.current = {
            tableStart: tableHit.box.start,
            row: tableHit.row,
            column: tableHit.column,
            offset: initialOffset,
          };
          tableTextSelectionRef.current = null;
          tableTextSelectionAnchorRef.current = {
            tableStart: tableHit.box.start,
            row: tableHit.row,
            column: tableHit.column,
            offset: initialOffset,
          };
          isTableTextSelectingRef.current = true;

          setCursorOffset(tableHit.box.start);
          notifyFmt();
          resetBlink();
          draw();
          return;
        }

        setSelectedImage(null);
        setHoveredImage(null);
        setIsImagePanelOpen(false);
        selectedTableHitRef.current = null;
        tableSelectionRangeRef.current = null;
        hoveredTableLineRef.current = null;
        selectedTableLineRef.current = null;
        selectedTableLineRangeRef.current = null;
        isTableCellEditingRef.current = false;
        activeTableEditingCellRef.current = null;
        tableCellCursorRef.current = null;
        tableTextSelectionRef.current = null;
        tableTextSelectionAnchorRef.current = null;
        isTableTextSelectingRef.current = false;
        handleMouseDown(e);
      },
      [
        getTableHitAtClientXY,
        getTableBorderLineAtClientXY,
        getTableTextHitAtClientXY,
        getImageBoxAtClientXY,
        getTableCellImageBox,
        selectedImage,
        hoveredImage,
        isImagePanelOpen,
        setCursorOffset,
        handleMouseDown,
        runsRef,
        isMenuOpen,
        setTableTrackSize,
        notifyFmt,
        resetBlink,
        draw,
      ],
    );

    const handleCanvasDoubleClick = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();

        const imageHit = getImageBoxAtClientXY(e.clientX, e.clientY);
        if (imageHit) return;

        const clickOffset = getOffsetFromClientXY(e.clientX, e.clientY);
        if (clickOffset === null) return;

        const text = runsToText(runsRef.current);
        if (!text.length) return;

        const imageRanges = getImageTokenRanges(text);
        const insideImage = imageRanges.some(
          (range) => clickOffset > range.start && clickOffset < range.end,
        );
        if (insideImage) return;

        const isWordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);

        let anchor = Math.max(0, Math.min(clickOffset, text.length - 1));
        if (!isWordChar(text[anchor])) {
          if (anchor > 0 && isWordChar(text[anchor - 1])) {
            anchor -= 1;
          } else {
            setCursorOffset(clickOffset);
            return;
          }
        }

        let start = anchor;
        while (start > 0 && isWordChar(text[start - 1])) start -= 1;

        let end = anchor + 1;
        while (end < text.length && isWordChar(text[end])) end += 1;

        selStartRef.current = start;
        cursorRef.current = end;
        setSelectedImage(null);
        setHoveredImage(null);
        setIsImagePanelOpen(false);
        notifyFmt();
        resetBlink();
        draw();
      },
      [
        getImageBoxAtClientXY,
        getOffsetFromClientXY,
        runsRef,
        selStartRef,
        cursorRef,
        setCursorOffset,
        notifyFmt,
        resetBlink,
        draw,
      ],
    );

    const copySelectionToClipboard = useCallback(async () => {
      const { selF, selT, hasSel } = getSelRange();
      if (!hasSel) return false;
      const text = runsToText(runsRef.current).slice(selF, selT);
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }, [getSelRange, runsRef]);

    const cutSelectionToClipboard = useCallback(async () => {
      const { selF, selT, hasSel } = getSelRange();
      if (!hasSel) return;
      const didCopy = await copySelectionToClipboard();
      if (!didCopy) return;

      pushHistory();
      runsRef.current = deleteRange(runsRef.current, selF, selT);
      cursorRef.current = selF;
      selStartRef.current = null;
      emitChange();
      notifyFmt();
      resetBlink();
      draw();
    }, [
      getSelRange,
      copySelectionToClipboard,
      pushHistory,
      runsRef,
      cursorRef,
      selStartRef,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
    ]);

    const sanitizePastedRuns = useCallback(
      (inputRuns: Run[]) => {
        return inputRuns
          .filter((run) => run.text.length > 0)
          .map((run) => ({
            text: run.text,
            bold: Boolean(run.bold),
            italic: Boolean(run.italic),
            underline: Boolean(run.underline),
            textAlign: run.textAlign ?? 'left',
            fontSize: Number.isFinite(run.fontSize) ? run.fontSize : DEFAULT_RUN_FMT.fontSize,
            lineSpacing: Number.isFinite(run.lineSpacing)
              ? run.lineSpacing
              : DEFAULT_RUN_FMT.lineSpacing,
            fontFamily: run.fontFamily || DEFAULT_RUN_FMT.fontFamily,
            color: run.color || DEFAULT_RUN_FMT.color,
            highlightColor: null,
            href: run.href,
          }));
      },
      [],
    );

    const getActiveTablePasteTarget = useCallback(() => {
      const activeCell = activeTableEditingCellRef.current;
      const selectedCell = selectedTableHitRef.current;
      const target = activeCell
        ? { tableStart: activeCell.tableStart, row: activeCell.row, column: activeCell.column }
        : selectedCell
          ? {
              tableStart: selectedCell.box.start,
              row: selectedCell.row,
              column: selectedCell.column,
            }
          : null;
      if (!target) return null;

      const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), target.tableStart);
      if (!tableMeta) return null;

      const currentRuns = tableMeta.cells?.[target.row]?.[target.column] ?? [];
      const currentText = runsToText(currentRuns);
      const currentOffset =
        tableCellCursorRef.current?.tableStart === target.tableStart &&
        tableCellCursorRef.current?.row === target.row &&
        tableCellCursorRef.current?.column === target.column
          ? tableCellCursorRef.current.offset
          : currentText.length;
      const safeOffset = Math.max(0, Math.min(currentText.length, currentOffset));

      const tableSelection = tableTextSelectionRef.current;
      const hasTableSelection =
        Boolean(tableSelection) &&
        tableSelection?.tableStart === target.tableStart &&
        tableSelection?.row === target.row &&
        tableSelection?.column === target.column &&
        tableSelection.end > tableSelection.start;
      const from = hasTableSelection ? tableSelection!.start : safeOffset;
      const to = hasTableSelection ? tableSelection!.end : safeOffset;

      return {
        ...target,
        currentRuns,
        from,
        to,
      };
    }, [runsRef]);

    const applyRunsToActiveTableTarget = useCallback(
      (incomingRuns: Run[]) => {
        const target = getActiveTablePasteTarget();
        if (!target) return false;

        const inserts = sanitizePastedRuns(incomingRuns);
        if (inserts.length === 0) return false;

        const nextRuns = replaceRangeWithRuns(target.currentRuns, target.from, target.to, inserts);
        const nextOffset = target.from + runsToText(inserts).length;

        isTableCellEditingRef.current = true;
        activeTableEditingCellRef.current = {
          tableStart: target.tableStart,
          row: target.row,
          column: target.column,
        };
        tableSelectionRangeRef.current = {
          rowStart: target.row,
          rowEnd: target.row,
          columnStart: target.column,
          columnEnd: target.column,
        };
        tableTextSelectionRef.current = null;
        tableTextSelectionAnchorRef.current = null;
        tableCellCursorRef.current = {
          tableStart: target.tableStart,
          row: target.row,
          column: target.column,
          offset: nextOffset,
        };
        setCursorOffset(target.tableStart);
        setTableCellRuns(target.row, target.column, nextRuns, target.tableStart, true);
        notifyFmt();
        resetBlink();
        draw();
        return true;
      },
      [
        getActiveTablePasteTarget,
        sanitizePastedRuns,
        setCursorOffset,
        setTableCellRuns,
        notifyFmt,
        resetBlink,
        draw,
      ],
    );

    const pastePlainTextIntoTable = useCallback(
      (pasteText: string) => {
        if (!pasteText) return false;
        const target = getActiveTablePasteTarget();
        if (!target) return false;

        const targetText = runsToText(target.currentRuns);
        const anchorOffset = targetText.length > 0
          ? Math.max(0, Math.min(target.from > 0 ? target.from - 1 : target.from, targetText.length - 1))
          : 0;
        const tableTypingFmt = targetText.length > 0
          ? getFormatAt(target.currentRuns, anchorOffset)
          : curFmtRef.current;

        const isUrl = /^https?:\/\/[^\s]+$/.test(pasteText.trim());
        const pasteFmt = isUrl
          ? { ...tableTypingFmt, color: '#2563eb', underline: true, href: pasteText.trim() }
          : { ...tableTypingFmt };
        return applyRunsToActiveTableTarget([makeRun(pasteText, pasteFmt)]);
      },
      [getActiveTablePasteTarget, curFmtRef, applyRunsToActiveTableTarget],
    );

    const pasteWithFormatIntoTable = useCallback(
      (pasteText: string, pasteHtml = '') => {
        const htmlRuns = clipboardHtmlToRuns(pasteHtml, curFmtRef.current);
        if (htmlRuns && htmlRuns.length > 0) {
          return applyRunsToActiveTableTarget(htmlRuns);
        }
        return pastePlainTextIntoTable(pasteText);
      },
      [curFmtRef, applyRunsToActiveTableTarget, pastePlainTextIntoTable],
    );

    const readClipboardPayload = useCallback(async () => {
      let text = '';
      let html = '';
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        return { text, html };
      }

      if (typeof navigator.clipboard.read === 'function') {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (!html && item.types.includes('text/html')) {
              const htmlBlob = await item.getType('text/html');
              html = await htmlBlob.text();
            }
            if (!text && item.types.includes('text/plain')) {
              const textBlob = await item.getType('text/plain');
              text = await textBlob.text();
            }
            if (text && html) break;
          }
        } catch {
          // Ignore and fall back to readText.
        }
      }

      if (!text) {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          // Ignore clipboard read failures.
        }
      }

      return { text, html };
    }, []);

    const pasteFromClipboard = useCallback(
      async (mode: 'plain' | 'with-format') => {
        const { text, html } = await readClipboardPayload();
        if (!text && !html) return;

        if (mode === 'with-format') {
          if (pasteWithFormatIntoTable(text, html)) return;
          pasteWithSourceFormat(text, html);
          return;
        }

        if (pastePlainTextIntoTable(text)) return;
        pastePlainText(text);
      },
      [
        readClipboardPayload,
        pasteWithFormatIntoTable,
        pasteWithSourceFormat,
        pastePlainTextIntoTable,
        pastePlainText,
      ],
    );

    const handleCanvasPaste = useCallback(
      (e: React.ClipboardEvent<HTMLCanvasElement>) => {
        if (getActiveTablePasteTarget()) {
          e.preventDefault();
          const pasteText = e.clipboardData?.getData('text') || '';
          const pasteHtml = e.clipboardData?.getData('text/html') || '';
          pasteWithFormatIntoTable(pasteText, pasteHtml);
          return;
        }
        handlePaste(e);
      },
      [getActiveTablePasteTarget, pasteWithFormatIntoTable, handlePaste],
    );

    const handleCanvasContextMenu = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const clickOffset = getOffsetFromClientXY(e.clientX, e.clientY);
        let insideSelection = false;
        let hasSelection = false;
        if (clickOffset !== null) {
          const { selF, selT, hasSel } = getSelRange();
          hasSelection = hasSel;
          insideSelection = hasSel && clickOffset >= selF && clickOffset <= selT;
          if (!insideSelection) {
            setCursorOffset(clickOffset);
          }
        }

        if (insideSelection && hasSelection) {
          const { selF, selT } = getSelRange();
          setQuickFormattingState({
            bold: isFormatUniform(runsRef.current, selF, selT, 'bold', true),
            italic: isFormatUniform(runsRef.current, selF, selT, 'italic', true),
            underline: isFormatUniform(runsRef.current, selF, selT, 'underline', true),
            fontFamily: curFmtRef.current.fontFamily,
            fontSize: curFmtRef.current.fontSize,
            color: curFmtRef.current.color,
            highlightColor: curFmtRef.current.highlightColor,
          });
          setShowQuickFormatting(true);
        } else {
          setShowQuickFormatting(false);
        }

        const rootRect = rootRef.current?.getBoundingClientRect();
        const rawX = rootRect ? e.clientX - rootRect.left : e.clientX;
        const rawY = rootRect ? e.clientY - rootRect.top : e.clientY;

        const menuW = 256;
        const menuH = 420;
        const maxX = rootRect ? Math.max(8, rootRect.width - menuW - 8) : rawX;
        const maxY = rootRect ? Math.max(8, rootRect.height - menuH - 8) : rawY;

        setMenuPos({ x: Math.max(8, Math.min(rawX, maxX)), y: Math.max(8, Math.min(rawY, maxY)) });
        setIsMenuOpen(true);
      },
      [getOffsetFromClientXY, setCursorOffset, getSelRange],
    );

    const runFormattingPainter = useCallback(() => {
      if (!formatPainterRef.current) {
        formatPainterRef.current = { ...curFmtRef.current };
        return;
      }

      const { selF, selT, hasSel } = getSelRange();
      const copiedFormat = { ...formatPainterRef.current };
      if (hasSel) {
        pushHistory();
        runsRef.current = applyFormatToRange(runsRef.current, selF, selT, copiedFormat);
        emitChange();
      }

      curFmtRef.current = copiedFormat;
      formatPainterRef.current = null;
      notifyFmt();
      resetBlink();
      draw();
    }, [
      curFmtRef,
      getSelRange,
      pushHistory,
      runsRef,
      emitChange,
      notifyFmt,
      resetBlink,
      draw,
    ]);

    const runClearFormatting = useCallback(() => {
      applyOrSetFmt({
        ...DEFAULT_RUN_FMT,
        fontSize: getDefaultFontSizeForPageSize(pageSize),
        lineSpacing: getDefaultLineSpacingForPageSize(pageSize),
      });
    }, [applyOrSetFmt, pageSize]);

    const handleContextMenuAction = useCallback(
      async (action: CanvasMenuAction, value?: string | number | null) => {
        if (action === 'cut') {
          await cutSelectionToClipboard();
          return;
        }
        if (action === 'copy') {
          await copySelectionToClipboard();
          return;
        }
        if (action === 'paste') {
          await pasteFromClipboard('plain');
          return;
        }
        if (action === 'paste-with-format') {
          await pasteFromClipboard('with-format');
          return;
        }
        if (action === 'format-painter') {
          runFormattingPainter();
          return;
        }
        if (action === 'toggle-bold') {
          const { selF, selT, hasSel } = getSelRange();
          const allBold = hasSel && isFormatUniform(runsRef.current, selF, selT, 'bold', true);
          applyOrSetFmt({ bold: hasSel ? !allBold : !curFmtRef.current.bold });
          return;
        }
        if (action === 'toggle-italic') {
          const { selF, selT, hasSel } = getSelRange();
          const allItalic = hasSel && isFormatUniform(runsRef.current, selF, selT, 'italic', true);
          applyOrSetFmt({ italic: hasSel ? !allItalic : !curFmtRef.current.italic });
          return;
        }
        if (action === 'toggle-underline') {
          const { selF, selT, hasSel } = getSelRange();
          const allUnderline =
            hasSel && isFormatUniform(runsRef.current, selF, selT, 'underline', true);
          applyOrSetFmt({ underline: hasSel ? !allUnderline : !curFmtRef.current.underline });
          return;
        }
        if (action === 'set-font-family' && typeof value === 'string') {
          applyOrSetFmt({ fontFamily: value });
          setQuickFormattingState((prev) => ({ ...prev, fontFamily: value }));
          return;
        }
        if (action === 'set-font-size') {
          const numeric = typeof value === 'number' ? value : Number(value);
          if (Number.isFinite(numeric)) {
            const nextSize = Math.max(8, Math.min(72, Math.round(numeric)));
            applyOrSetFmt({ fontSize: nextSize });
            setQuickFormattingState((prev) => ({ ...prev, fontSize: nextSize }));
          }
          return;
        }
        if (action === 'set-font-color' && typeof value === 'string') {
          applyOrSetFmt({ color: value });
          setQuickFormattingState((prev) => ({ ...prev, color: value }));
          return;
        }
        if (action === 'set-highlight-color') {
          const nextHighlight = typeof value === 'string' ? value : null;
          setHighlightColor(nextHighlight);
          setQuickFormattingState((prev) => ({ ...prev, highlightColor: nextHighlight }));
          return;
        }
        if (action === 'clear-formatting') {
          runClearFormatting();
          return;
        }
        if (action === 'insert-link') {
          const url = window.prompt('Enter link URL');
          if (url && url.trim()) insertLink(url.trim(), url.trim());
          return;
        }
        if (action === 'insert-image') {
          const url = window.prompt('Enter image URL');
          if (url && url.trim()) insertImage(url.trim());
          return;
        }
        if (action === 'comments') {
          window.dispatchEvent(new CustomEvent('docsync:open-comments'));
          return;
        }
        if (action === 'spelling-check') {
          window.dispatchEvent(new CustomEvent('docsync:open-spelling'));
        }
      },
      [
        cutSelectionToClipboard,
        copySelectionToClipboard,
        pasteFromClipboard,
        runFormattingPainter,
        getSelRange,
        runsRef,
        applyOrSetFmt,
        setHighlightColor,
        curFmtRef,
        runClearFormatting,
        insertLink,
        insertImage,
      ],
    );

    const handleCanvasKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLCanvasElement>) => {
        const activeTable = activeTableEditingCellRef.current;
        if (isTableCellEditingRef.current && activeTable) {
          const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), activeTable.tableStart);
          if (tableMeta) {
            const currentText = runsToText(tableMeta.cells?.[activeTable.row]?.[activeTable.column] ?? []);
            const imageRanges = getImageTokenRanges(currentText);
            const snapOffsetInsideImageToken = (offset: number, direction?: 'left' | 'right') => {
              for (const range of imageRanges) {
                if (offset > range.start && offset < range.end) {
                  if (direction === 'left') return range.start;
                  if (direction === 'right') return range.end;
                  return Math.abs(offset - range.start) <= Math.abs(range.end - offset)
                    ? range.start
                    : range.end;
                }
              }
              return offset;
            };
            const currentOffset =
              tableCellCursorRef.current?.tableStart === activeTable.tableStart &&
              tableCellCursorRef.current?.row === activeTable.row &&
              tableCellCursorRef.current?.column === activeTable.column
                ? tableCellCursorRef.current.offset
                : currentText.length;
            const safeOffset = snapOffsetInsideImageToken(
              Math.max(0, Math.min(currentText.length, currentOffset)),
            );
            const tableSelection = tableTextSelectionRef.current;
            const hasTableSelection =
              Boolean(tableSelection) &&
              tableSelection?.tableStart === activeTable.tableStart &&
              tableSelection?.row === activeTable.row &&
              tableSelection?.column === activeTable.column &&
              tableSelection.end > tableSelection.start;
            const selectedFrom = hasTableSelection ? tableSelection!.start : safeOffset;
            const selectedTo = hasTableSelection ? tableSelection!.end : safeOffset;

            if (e.key === 'Escape') {
              e.preventDefault();
              isTableCellEditingRef.current = false;
              activeTableEditingCellRef.current = null;
              tableTextSelectionRef.current = null;
              tableTextSelectionAnchorRef.current = null;
              isTableTextSelectingRef.current = false;
              tableSelectionRangeRef.current = null;
              selectedTableHitRef.current = null;
              tableCellCursorRef.current = null;
              notifyFmt();
              resetBlink();
              draw();
              return;
            }

            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
              e.preventDefault();
              tableTextSelectionRef.current = null;
              tableTextSelectionAnchorRef.current = null;
              isTableTextSelectingRef.current = false;
              tableCellCursorRef.current = null;
              tableSelectionRangeRef.current = {
                rowStart: 0,
                rowEnd: Math.max(0, tableMeta.rows - 1),
                columnStart: 0,
                columnEnd: Math.max(0, tableMeta.columns - 1),
              };
              isTableCellEditingRef.current = false;
              activeTableEditingCellRef.current = null;
              notifyFmt();
              resetBlink();
              draw();
              return;
            }

            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              if (e.shiftKey) {
                const anchorOffset =
                  hasTableSelection && safeOffset === selectedFrom ? selectedTo : selectedFrom;
                const nextOffset =
                  e.key === 'ArrowLeft'
                    ? Math.max(0, safeOffset - 1)
                    : Math.min(currentText.length, safeOffset + 1);
                const snappedNextOffset = snapOffsetInsideImageToken(
                  nextOffset,
                  e.key === 'ArrowLeft' ? 'left' : 'right',
                );
                const start = Math.min(anchorOffset, snappedNextOffset);
                const end = Math.max(anchorOffset, snappedNextOffset);
                tableTextSelectionRef.current =
                  end > start
                    ? {
                        tableStart: activeTable.tableStart,
                        row: activeTable.row,
                        column: activeTable.column,
                        start,
                        end,
                      }
                    : null;
                tableCellCursorRef.current = {
                  tableStart: activeTable.tableStart,
                  row: activeTable.row,
                  column: activeTable.column,
                  offset: snappedNextOffset,
                };
                notifyFmt();
                resetBlink();
                draw();
                return;
              }

              const nextOffset = hasTableSelection
                ? e.key === 'ArrowLeft'
                  ? selectedFrom
                  : selectedTo
                : e.key === 'ArrowLeft'
                  ? Math.max(0, safeOffset - 1)
                  : Math.min(currentText.length, safeOffset + 1);
              const snappedNextOffset = snapOffsetInsideImageToken(
                nextOffset,
                e.key === 'ArrowLeft' ? 'left' : 'right',
              );
              tableTextSelectionRef.current = null;
              tableCellCursorRef.current = {
                tableStart: activeTable.tableStart,
                row: activeTable.row,
                column: activeTable.column,
                offset: snappedNextOffset,
              };
              notifyFmt();
              resetBlink();
              draw();
              return;
            }

            let nextText: string | null = null;
            let nextOffset = safeOffset;
            if (e.key === 'Backspace') {
              if (hasTableSelection) {
                nextText = currentText.slice(0, selectedFrom) + currentText.slice(selectedTo);
                nextOffset = selectedFrom;
              } else if (safeOffset > 0) {
                const imageAtLeft = imageRanges.find((range) => range.end === safeOffset);
                if (imageAtLeft) {
                  nextText = currentText.slice(0, imageAtLeft.start) + currentText.slice(imageAtLeft.end);
                  nextOffset = imageAtLeft.start;
                } else {
                  nextText = currentText.slice(0, safeOffset - 1) + currentText.slice(safeOffset);
                  nextOffset = safeOffset - 1;
                }
              }
            } else if (e.key === 'Delete') {
              if (hasTableSelection) {
                nextText = currentText.slice(0, selectedFrom) + currentText.slice(selectedTo);
                nextOffset = selectedFrom;
              } else if (safeOffset < currentText.length) {
                const imageAtRight = imageRanges.find((range) => range.start === safeOffset);
                if (imageAtRight) {
                  nextText = currentText.slice(0, imageAtRight.start) + currentText.slice(imageAtRight.end);
                  nextOffset = imageAtRight.start;
                } else {
                  nextText = currentText.slice(0, safeOffset) + currentText.slice(safeOffset + 1);
                }
              }
            } else if (e.key === 'Enter') {
              nextText = currentText.slice(0, selectedFrom) + '\n' + currentText.slice(selectedTo);
              nextOffset = selectedFrom + 1;
            } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
              nextText = currentText.slice(0, selectedFrom) + e.key + currentText.slice(selectedTo);
              nextOffset = selectedFrom + 1;
            }

            if (nextText !== null) {
              e.preventDefault();
              if (selectedImage) {
                setSelectedImage(null);
                setHoveredImage(null);
                setIsImagePanelOpen(false);
              }
              tableTextSelectionRef.current = null;
              tableCellCursorRef.current = {
                tableStart: activeTable.tableStart,
                row: activeTable.row,
                column: activeTable.column,
                offset: nextOffset,
              };
              setTableCell(activeTable.row, activeTable.column, nextText, activeTable.tableStart, true);
              return;
            }
          }
        }

        const isMod = e.metaKey || e.ctrlKey;
        if (isMod && !e.shiftKey && e.key.toLowerCase() === 'x') {
          e.preventDefault();
          void cutSelectionToClipboard();
          return;
        }

        const isTextEditingKey =
          e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter';
        if (isTextEditingKey && !isMod && !e.altKey && selectedImage) {
          setSelectedImage(null);
          setHoveredImage(null);
          setIsImagePanelOpen(false);
        }

        handleKeyDown(e);
      },
      [
        cutSelectionToClipboard,
        handleKeyDown,
        runsRef,
        selectedImage,
        setTableCell,
        notifyFmt,
        resetBlink,
        draw,
      ],
    );

    const applyImageMutation = useCallback(
      (offset: number, mutate: () => void) => {
        setCursorOffset(offset);
        mutate();
        const current = getImageBoxAtOffset(offset);
        syncImageOverlay(current ?? selectedImage ?? hoveredImage ?? null);
      },
      [setCursorOffset, syncImageOverlay, getImageBoxAtOffset, selectedImage, hoveredImage],
    );

    const applyTableImageMetaPatch = useCallback(
      (
        image: ImageBox,
        patch: Partial<ImageTokenMeta>,
        withHistory = true,
      ) => {
        const tableImage = image.tableImage;
        if (!tableImage) return false;

        const { tableStart, row, column, tokenRangeIndex } = tableImage;
        const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), tableStart);
        if (!tableMeta) return false;

        const cellText = runsToText(tableMeta.cells?.[row]?.[column] ?? []);
        const ranges = getImageTokenRanges(cellText);
        const tokenRange = ranges[tokenRangeIndex];
        if (!tokenRange) return false;

        const token = cellText.slice(tokenRange.start, tokenRange.end);
        const parsed = parseImageToken(token);
        if (!parsed) return false;

        const nextToken = buildImageToken({
          ...parsed,
          ...patch,
        });
        const nextText =
          cellText.slice(0, tokenRange.start) + nextToken + cellText.slice(tokenRange.end);

        const currentOffset =
          tableCellCursorRef.current?.tableStart === tableStart &&
          tableCellCursorRef.current?.row === row &&
          tableCellCursorRef.current?.column === column
            ? tableCellCursorRef.current.offset
            : tokenRange.end;
        const tokenDelta = nextToken.length - (tokenRange.end - tokenRange.start);
        const shiftedOffset =
          currentOffset <= tokenRange.start
            ? currentOffset
            : currentOffset >= tokenRange.end
              ? currentOffset + tokenDelta
              : tokenRange.start + nextToken.length;
        const nextOffset = Math.max(0, Math.min(nextText.length, shiftedOffset));

        isTableCellEditingRef.current = true;
        activeTableEditingCellRef.current = { tableStart, row, column };
        tableSelectionRangeRef.current = {
          rowStart: row,
          rowEnd: row,
          columnStart: column,
          columnEnd: column,
        };
        tableTextSelectionRef.current = null;
        tableTextSelectionAnchorRef.current = null;
        tableCellCursorRef.current = {
          tableStart,
          row,
          column,
          offset: nextOffset,
        };
        setCursorOffset(tableStart);
        setTableCell(row, column, nextText, tableStart, withHistory);

        window.requestAnimationFrame(() => {
          const nextBox = getTableCellImageBox(tableStart, row, column, tokenRangeIndex);
          if (nextBox) {
            setSelectedImage(nextBox);
            setAltDraft(nextBox.meta.alt);
          }
        });
        return true;
      },
      [getTableCellImageBox, runsRef, setCursorOffset, setTableCell],
    );

    const updateImageWidthByValue = useCallback(
      (image: ImageBox, widthPct: number, withHistory = true) => {
        const nextWidth = Math.max(25, Math.min(100, Math.round(widthPct)));
        if (image.tableImage) {
          applyTableImageMetaPatch(image, { widthPct: nextWidth }, withHistory);
          return;
        }
        applyImageMutation(image.start, () => setImageWidthPct(nextWidth, withHistory));
      },
      [applyTableImageMetaPatch, applyImageMutation, setImageWidthPct],
    );

    const updateImageRotationByValue = useCallback(
      (image: ImageBox, rotationDeg: number, withHistory = true) => {
        if (image.tableImage) {
          applyTableImageMetaPatch(image, { rotationDeg }, withHistory);
          return;
        }
        applyImageMutation(image.start, () => setImageRotationDeg(rotationDeg, withHistory));
      },
      [applyTableImageMetaPatch, applyImageMutation, setImageRotationDeg],
    );

    const applyFormatToActiveTableCell = useCallback(
      (patch: Partial<RunFmt>, options?: { requireSelection?: boolean; allowWhenEmpty?: boolean }) => {
        const activeCell = activeTableEditingCellRef.current;
        const selectedCell = selectedTableHitRef.current;
        const targetCell = activeCell
          ? { tableStart: activeCell.tableStart, row: activeCell.row, column: activeCell.column }
          : selectedCell
            ? {
                tableStart: selectedCell.box.start,
                row: selectedCell.row,
                column: selectedCell.column,
              }
            : null;
        if (!targetCell) return false;

        const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), targetCell.tableStart);
        if (!tableMeta) return false;

        const cellText = runsToText(tableMeta.cells?.[targetCell.row]?.[targetCell.column] ?? []);
        const tableSelection = tableTextSelectionRef.current;
        const hasTableSelection =
          Boolean(tableSelection) &&
          tableSelection?.tableStart === targetCell.tableStart &&
          tableSelection?.row === targetCell.row &&
          tableSelection?.column === targetCell.column &&
          tableSelection.end > tableSelection.start;
        if (options?.requireSelection && !hasTableSelection) {
          if (options.allowWhenEmpty && cellText.length === 0) {
            // Allow formatting empty cells so insertion caret/next typing can inherit style.
          } else {
          return true;
          }
        }
        const rangeFrom = hasTableSelection ? tableSelection!.start : 0;
        const rangeTo = hasTableSelection ? tableSelection!.end : cellText.length;
        setTableCellFormat(
          targetCell.row,
          targetCell.column,
          patch,
          rangeFrom,
          rangeTo,
          targetCell.tableStart,
          true,
        );
        return true;
      },
      [runsRef, setTableCellFormat],
    );

    const applyTableTextAlignToSelectedLines = useCallback(
      (align: 'left' | 'center' | 'right') => {
        if (!isTableCellEditingRef.current) return false;
        const activeCell = activeTableEditingCellRef.current;
        if (!activeCell) return false;

        const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), activeCell.tableStart);
        if (!tableMeta) return false;

        const cellText = runsToText(tableMeta.cells?.[activeCell.row]?.[activeCell.column] ?? []);
        const tableSelection = tableTextSelectionRef.current;
        const hasTableSelection =
          Boolean(tableSelection) &&
          tableSelection?.tableStart === activeCell.tableStart &&
          tableSelection?.row === activeCell.row &&
          tableSelection?.column === activeCell.column &&
          tableSelection.end > tableSelection.start;

        const cursorOffset =
          tableCellCursorRef.current?.tableStart === activeCell.tableStart &&
          tableCellCursorRef.current?.row === activeCell.row &&
          tableCellCursorRef.current?.column === activeCell.column
            ? tableCellCursorRef.current.offset
            : cellText.length;
        const safeCursor = Math.max(0, Math.min(cellText.length, cursorOffset));

        if (cellText.length === 0) {
          setTableCellFormat(
            activeCell.row,
            activeCell.column,
            { textAlign: align },
            0,
            0,
            activeCell.tableStart,
            true,
          );
          return true;
        }

        const rawFrom = hasTableSelection ? tableSelection!.start : safeCursor;
        const rawTo = hasTableSelection ? tableSelection!.end : safeCursor;
        const safeFrom = Math.max(0, Math.min(cellText.length, rawFrom));
        const safeTo = Math.max(safeFrom, Math.min(cellText.length, rawTo));

        const lineStart = cellText.lastIndexOf('\n', Math.max(0, safeFrom - 1)) + 1;
        const lineEndAnchor = hasTableSelection
          ? Math.max(lineStart, Math.min(cellText.length - 1, Math.max(safeFrom, safeTo - 1)))
          : safeFrom;
        const lineEndBreak = cellText.indexOf('\n', lineEndAnchor);
        const lineEnd = lineEndBreak === -1 ? cellText.length : lineEndBreak;

        let patchFrom = lineStart;
        let patchTo = lineEnd;
        if (patchFrom === patchTo) {
          // Empty logical line has no glyph range; patch a nearby newline sentinel
          // so caret/insertion alignment can still resolve for this line.
          patchFrom = Math.max(0, Math.min(cellText.length - 1, lineStart));
          patchTo = Math.min(cellText.length, patchFrom + 1);
        }

        setTableCellFormat(
          activeCell.row,
          activeCell.column,
          { textAlign: align },
          patchFrom,
          patchTo,
          activeCell.tableStart,
          true,
        );

        if (!hasTableSelection && cellText.length > 0) {
          const anchorFrom = safeCursor < cellText.length ? safeCursor : Math.max(0, safeCursor - 1);
          const anchorTo = Math.min(cellText.length, anchorFrom + 1);
          if (anchorTo > anchorFrom) {
            // Keep insertion formatting aligned with current caret line, especially
            // at empty-line/newline boundaries.
            setTableCellFormat(
              activeCell.row,
              activeCell.column,
              { textAlign: align },
              anchorFrom,
              anchorTo,
              activeCell.tableStart,
              false,
            );
          }
        }
        return true;
      },
      [runsRef, setTableCellFormat],
    );

    const insertImageAtCurrentContext = useCallback(
      (url: string) => {
        const normalized = url.trim();
        if (!normalized) return;

        const activeCell = activeTableEditingCellRef.current;
        const selectedCell = selectedTableHitRef.current;

        const target = activeCell
          ? { tableStart: activeCell.tableStart, row: activeCell.row, column: activeCell.column }
          : selectedCell
            ? {
                tableStart: selectedCell.box.start,
                row: selectedCell.row,
                column: selectedCell.column,
              }
              : null;

        if (!target) {
          insertImage(normalized);
          return;
        }

        const tableMeta = getTableTokenAtOffset(runsToText(runsRef.current), target.tableStart);
        if (!tableMeta) {
          insertImage(normalized);
          return;
        }

        const currentText = runsToText(tableMeta.cells?.[target.row]?.[target.column] ?? []);
        const currentOffset =
          tableCellCursorRef.current?.tableStart === target.tableStart &&
          tableCellCursorRef.current?.row === target.row &&
          tableCellCursorRef.current?.column === target.column
            ? tableCellCursorRef.current.offset
            : currentText.length;
        const safeOffset = Math.max(0, Math.min(currentText.length, currentOffset));

        const tableSelection = tableTextSelectionRef.current;
        const hasTableSelection =
          Boolean(tableSelection) &&
          tableSelection?.tableStart === target.tableStart &&
          tableSelection?.row === target.row &&
          tableSelection?.column === target.column &&
          tableSelection.end > tableSelection.start;
        const selectedFrom = hasTableSelection ? tableSelection!.start : safeOffset;
        const selectedTo = hasTableSelection ? tableSelection!.end : safeOffset;

        const token = buildImageToken({
          src: normalized,
          widthPct: 10,
          align: 'left',
          rotationDeg: 0,
          wrap: 'inline',
          alt: '',
          frontOpacityPct: 45,
        });

        const nextText = currentText.slice(0, selectedFrom) + token + currentText.slice(selectedTo);
        const nextOffset = selectedFrom + token.length;

        isTableCellEditingRef.current = true;
        activeTableEditingCellRef.current = {
          tableStart: target.tableStart,
          row: target.row,
          column: target.column,
        };
        tableSelectionRangeRef.current = {
          rowStart: target.row,
          rowEnd: target.row,
          columnStart: target.column,
          columnEnd: target.column,
        };
        tableTextSelectionRef.current = null;
        tableTextSelectionAnchorRef.current = null;
        tableCellCursorRef.current = {
          tableStart: target.tableStart,
          row: target.row,
          column: target.column,
          offset: nextOffset,
        };
        setCursorOffset(target.tableStart);
        setTableCell(target.row, target.column, nextText, target.tableStart, true);
      },
      [insertImage, runsRef, setCursorOffset, setTableCell],
    );

    const getTargetImage = useCallback(() => selectedImage ?? hoveredImage, [selectedImage, hoveredImage]);

    const updateSelectedImageAlign = useCallback(
      (align: 'left' | 'center' | 'right') => {
        const image = getTargetImage();
        if (!image) return;
        if (image.tableImage) {
          applyTableImageMetaPatch(image, { align }, true);
          return;
        }
        applyImageMutation(image.start, () => setImageAlign(align));
      },
      [getTargetImage, applyTableImageMetaPatch, applyImageMutation, setImageAlign],
    );

    const updateSelectedImageWrap = useCallback(
      (wrap: ImageWrap) => {
        const image = getTargetImage();
        if (!image) return;
        if (image.tableImage) {
          applyTableImageMetaPatch(image, { wrap }, true);
          return;
        }
        const anchorOffset = getWrapAnchorOffset(wrap, image);
        applyImageMutation(anchorOffset, () => setImageWrap(wrap));
      },
      [getTargetImage, applyTableImageMetaPatch, applyImageMutation, setImageWrap],
    );

    const updateBreakLayout = useCallback(
      (mode: 'break-right' | 'break-left' | 'break-center') => {
        const image = getTargetImage();
        if (!image) return;
        const align = mode === 'break-right' ? 'right' : mode === 'break-center' ? 'center' : 'left';
        if (image.tableImage) {
          applyTableImageMetaPatch(image, { wrap: 'break', align }, true);
          return;
        }
        const anchorOffset = mode === 'break-right' ? image.start : image.end;
        applyImageMutation(anchorOffset, () => {
          setImageWrap('break');
          setImageAlign(align);
        });
      },
      [getTargetImage, applyTableImageMetaPatch, applyImageMutation, setImageWrap, setImageAlign],
    );

    const commitSelectedImageAlt = useCallback(() => {
      const image = getTargetImage();
      if (!image) return;
      if (image.tableImage) {
        applyTableImageMetaPatch(image, { alt: altDraft }, true);
        return;
      }
      applyImageMutation(image.start, () => setImageAltText(altDraft));
    }, [getTargetImage, altDraft, applyTableImageMetaPatch, applyImageMutation, setImageAltText]);

    const rotateSelectedImageBy = useCallback(
      (deltaDeg: number) => {
        const image = getTargetImage();
        if (!image) return;
        updateImageRotationByValue(image, image.meta.rotationDeg + deltaDeg, true);
      },
      [getTargetImage, updateImageRotationByValue],
    );

    const startResize = useCallback(
      (handle: ResizeHandle, event: React.MouseEvent<HTMLButtonElement>) => {
        if (!selectedImage) return;
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidthPct = selectedImage.meta.widthPct;
        const startDrawWidth = Math.max(1, selectedImage.drawWidth);
        const startDrawHeight = Math.max(1, selectedImage.drawHeight);
        const aspectRatio = startDrawWidth / startDrawHeight;
        let lastWidthPct = startWidthPct;

        const onMove = (ev: MouseEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const horizontalDir = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
          const verticalDir = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;

          let nextWidth = startDrawWidth;
          let nextHeight = startDrawHeight;

          if (horizontalDir !== 0 && verticalDir !== 0) {
            // Corner handle: preserve aspect ratio
            const delta = Math.max(dx * horizontalDir, dy * verticalDir);
            nextWidth = Math.max(1, startDrawWidth + delta);
            nextHeight = Math.max(1, nextWidth / aspectRatio);
          } else if (horizontalDir !== 0) {
            // Side handle: width only
            nextWidth = Math.max(1, startDrawWidth + dx * horizontalDir);
            nextHeight = startDrawHeight;
          } else if (verticalDir !== 0) {
            // Top/bottom handle: height only (optional, can be locked if not supported)
            nextHeight = Math.max(1, startDrawHeight + dy * verticalDir);
            nextWidth = nextHeight * aspectRatio;
          }

          // Convert width to percent of page/canvas width
          const nextWidthPct = Math.max(
            25,
            Math.min(100, Math.round((nextWidth / startDrawWidth) * startWidthPct)),
          );
          lastWidthPct = nextWidthPct;
          updateImageWidthByValue(selectedImage, nextWidthPct, false);
        };

        const onUp = () => {
          updateImageWidthByValue(selectedImage, lastWidthPct, true);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      },
      [selectedImage, applyImageMutation, setImageWidthPct],
    );

    const startRotate = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!selectedImage) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const centerX = rect.left + selectedImage.centerX;
        const centerY = rect.top + selectedImage.centerY;
        const startRotationDeg = selectedImage.meta.rotationDeg;
        const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
        let lastRotation = startRotationDeg;

        const onMove = (ev: MouseEvent) => {
          const nextAngle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
          const deltaDeg = ((nextAngle - startAngle) * 180) / Math.PI;
          lastRotation = startRotationDeg + deltaDeg;
          updateImageRotationByValue(selectedImage, lastRotation, false);
        };

        const onUp = () => {
          updateImageRotationByValue(selectedImage, lastRotation, true);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      },
      [selectedImage, updateImageRotationByValue],
    );

    // ── Imperative API ────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      getContent: () => runsToText(runsRef.current),
      focus: () => canvasRef.current?.focus(),
      setContent: (t: string) => {
        runsRef.current = [makeRun(t, { ...curFmtRef.current })];
        cursorRef.current = t.length;
        selStartRef.current = null;
        emitChange();
        draw();
      },
      getFontSize: () => curFmtRef.current.fontSize,
      setFontSize: (n: number) => {
        const next = Math.max(8, Math.min(72, n));
        if (applyFormatToActiveTableCell({ fontSize: next })) return;
        applyOrSetFmt({ fontSize: next });
      },
      toggleBold: () => {
        if (applyFormatToActiveTableCell({ bold: !curFmtRef.current.bold })) return;
        const { selF, selT, hasSel } = getSelRange();
        const allBold = hasSel && isFormatUniform(runsRef.current, selF, selT, 'bold', true);
        applyOrSetFmt({ bold: hasSel ? !allBold : !curFmtRef.current.bold });
      },
      getBold: () => curFmtRef.current.bold,
      toggleItalic: () => {
        if (applyFormatToActiveTableCell({ italic: !curFmtRef.current.italic })) return;
        const { selF, selT, hasSel } = getSelRange();
        const allItalic = hasSel && isFormatUniform(runsRef.current, selF, selT, 'italic', true);
        applyOrSetFmt({
          italic: hasSel ? !allItalic : !curFmtRef.current.italic,
        });
      },
      getItalic: () => curFmtRef.current.italic,
      toggleUnderline: () => {
        if (applyFormatToActiveTableCell({ underline: !curFmtRef.current.underline })) return;
        const { selF, selT, hasSel } = getSelRange();
        const allUnder = hasSel && isFormatUniform(runsRef.current, selF, selT, 'underline', true);
        applyOrSetFmt({
          underline: hasSel ? !allUnder : !curFmtRef.current.underline,
        });
      },
      getUnderline: () => curFmtRef.current.underline,
      getFontFamily: () => curFmtRef.current.fontFamily,
      setFontFamily: (f: string) => {
        if (applyFormatToActiveTableCell({ fontFamily: f })) return;
        applyOrSetFmt({ fontFamily: f });
      },
      getTextColor: () => curFmtRef.current.color,
      setTextColor: (c: string) => {
        if (applyFormatToActiveTableCell({ color: c })) return;
        applyOrSetFmt({ color: c });
      },
      toggleBullet,
      toggleNumberList,
      indentLeft,
      indentRight,
      setLineSpacing: (value: number) => {
        if (applyFormatToActiveTableCell({ lineSpacing: value })) return;
        setLineSpacing(value);
      },
      toggleHighlight,
      setHighlightColor: (color: string | null) => {
        if (applyFormatToActiveTableCell({ highlightColor: color })) return;
        setHighlightColor(color);
      },
      insertLink,
      insertImage: insertImageAtCurrentContext,
      insertTable,
      insertPageBreak,
      setImageAlign,
      setImageWidthPct,
      setImageRotationDeg,
      setImageWrap,
      setImageAltText,
      setImageFrontOpacityPct,
      formatPainter: runFormattingPainter,
      clearFormatting: runClearFormatting,
      toggleImagePanel: () => setIsImagePanelOpen((prev) => !prev),
      openImagePanel: () => setIsImagePanelOpen(true),
      closeImagePanel: () => setIsImagePanelOpen(false),
      toggleTablePanel: () => {
        // Table panel UI is not mounted in this legacy editor shell.
      },
      openTablePanel: () => {
        // Table panel UI is not mounted in this legacy editor shell.
      },
      closeTablePanel: () => {
        // Table panel UI is not mounted in this legacy editor shell.
      },
      setTableTextAlign: (align: 'left' | 'center' | 'right') => {
        if (applyTableTextAlignToSelectedLines(align)) {
          return;
        }
        if (applyFormatToActiveTableCell({ textAlign: align })) return;
        applyOrSetFmt({ textAlign: align });
      },
      setTableBorderColor: (color: string | null) => {
        const selectedTable = selectedTableHitRef.current;
        const activeTable = activeTableEditingCellRef.current;
        const tableStart = selectedTable?.box.start ?? activeTable?.tableStart;
        if (tableStart === undefined) return;
        const editingCell = isTableCellEditingRef.current && Boolean(activeTable);
        const selectedRange = tableSelectionRangeRef.current;
        const hasCellRange = Boolean(selectedRange);
        if (!editingCell && !hasCellRange && !selectedTableLineRef.current && !selectedTableLineRangeRef.current) return;
        const targetRange = editingCell
          ? (activeTable
              ? {
                  rowStart: activeTable.row,
                  rowEnd: activeTable.row,
                  columnStart: activeTable.column,
                  columnEnd: activeTable.column,
                }
              : null)
          : hasCellRange
            ? selectedRange
            : tableSelectionRangeRef.current;
        setTableBorders(
          { color },
          targetRange,
          tableStart,
          editingCell ? null : selectedTableLineRef.current,
          editingCell ? null : selectedTableLineRangeRef.current,
        );
        notifyFmt();
        resetBlink();
        draw();
      },
      setTableBorderWidth: (width: number) => {
        const selectedTable = selectedTableHitRef.current;
        const activeTable = activeTableEditingCellRef.current;
        const tableStart = selectedTable?.box.start ?? activeTable?.tableStart;
        if (tableStart === undefined) return;
        const editingCell = isTableCellEditingRef.current && Boolean(activeTable);
        const selectedRange = tableSelectionRangeRef.current;
        const hasCellRange = Boolean(selectedRange);
        if (!editingCell && !hasCellRange && !selectedTableLineRef.current && !selectedTableLineRangeRef.current) return;
        const targetRange = editingCell
          ? (activeTable
              ? {
                  rowStart: activeTable.row,
                  rowEnd: activeTable.row,
                  columnStart: activeTable.column,
                  columnEnd: activeTable.column,
                }
              : null)
          : hasCellRange
            ? selectedRange
            : tableSelectionRangeRef.current;
        const nextWidth = Math.max(0, Math.min(8, Math.round(width)));
        setTableBorders(
          { width: nextWidth },
          targetRange,
          tableStart,
          editingCell ? null : selectedTableLineRef.current,
          editingCell ? null : selectedTableLineRangeRef.current,
        );
        notifyFmt();
        resetBlink();
        draw();
      },
      setTableNoBorders: () => {
        const selectedTable = selectedTableHitRef.current;
        const activeTable = activeTableEditingCellRef.current;
        const tableStart = selectedTable?.box.start ?? activeTable?.tableStart;
        if (tableStart === undefined) return;
        const editingCell = isTableCellEditingRef.current && Boolean(activeTable);
        const selectedRange = tableSelectionRangeRef.current;
        const hasCellRange = Boolean(selectedRange);
        if (!editingCell && !hasCellRange && !selectedTableLineRef.current && !selectedTableLineRangeRef.current) return;
        const targetRange = editingCell
          ? (activeTable
              ? {
                  rowStart: activeTable.row,
                  rowEnd: activeTable.row,
                  columnStart: activeTable.column,
                  columnEnd: activeTable.column,
                }
              : null)
          : hasCellRange
            ? selectedRange
            : tableSelectionRangeRef.current;
        setTableBorders(
          { width: 0, colorless: true },
          targetRange,
          tableStart,
          editingCell ? null : selectedTableLineRef.current,
          editingCell ? null : selectedTableLineRangeRef.current,
        );
        notifyFmt();
        resetBlink();
        draw();
      },
      setTableBorderRadius: (radiusPx: number) => {
        const selectedTable = selectedTableHitRef.current;
        const activeTable = activeTableEditingCellRef.current;
        const tableStart = selectedTable?.box.start ?? activeTable?.tableStart;
        if (tableStart === undefined) return;
        const nextRadius = Math.max(0, Math.min(24, Math.round(radiusPx)));
        setTableBorderRadius(nextRadius, tableStart);
        notifyFmt();
        resetBlink();
        draw();
      },
      setTableRoundedBorders: (enabled: boolean) => {
        const selectedTable = selectedTableHitRef.current;
        const activeTable = activeTableEditingCellRef.current;
        const tableStart = selectedTable?.box.start ?? activeTable?.tableStart;
        if (tableStart === undefined) return;
        setTableBorderRadius(enabled ? 12 : 0, tableStart);
        notifyFmt();
        resetBlink();
        draw();
      },
      addTableRowAbove: () => {
        const active = activeTableEditingCellRef.current;
        const selected = selectedTableHitRef.current;
        const row = active?.row ?? selected?.row;
        if (row === undefined) return;
        addTableRowAbove(row);
      },
      addTableRowBelow: () => {
        const active = activeTableEditingCellRef.current;
        const selected = selectedTableHitRef.current;
        const row = active?.row ?? selected?.row;
        if (row === undefined) return;
        addTableRowBelow(row);
      },
      addTableColumnLeft: () => {
        const active = activeTableEditingCellRef.current;
        const selected = selectedTableHitRef.current;
        const column = active?.column ?? selected?.column;
        if (column === undefined) return;
        addTableColumnLeft(column);
      },
      addTableColumnRight: () => {
        const active = activeTableEditingCellRef.current;
        const selected = selectedTableHitRef.current;
        const column = active?.column ?? selected?.column;
        if (column === undefined) return;
        addTableColumnRight(column);
      },
      toggleSpaceBeforeLine,
      toggleSpaceAfterLine,
      setRuns: (runs: Run[]) => {
        runsRef.current = runs.map((run) => ({ ...run }));
        cursorRef.current = runsToText(runsRef.current).length;
        selStartRef.current = null;
        emitChange();
        notifyFmt();
        draw();
      },
      undo: undoFn,
      redo: redoFn,
    }));

    // ── Effects ───────────────────────────────────────────────────────────────
    useEffect(() => {
      if (initialContent !== undefined) {
        const nextDefaultFontSize = getDefaultFontSizeForPageSize(pageSize);
        const nextDefaultLineSpacing = getDefaultLineSpacingForPageSize(pageSize);
        runsRef.current = [
          makeRun(initialContent, {
            ...DEFAULT_RUN_FMT,
            fontSize: nextDefaultFontSize,
            lineSpacing: nextDefaultLineSpacing,
          }),
        ];
        curFmtRef.current = {
          ...DEFAULT_RUN_FMT,
          fontSize: nextDefaultFontSize,
          lineSpacing: nextDefaultLineSpacing,
        };
        cursorRef.current = initialContent.length;
        selStartRef.current = null;
        onContentChange?.(initialContent);
      }
    }, [initialContent, pageSize, onContentChange]);

    useEffect(() => {
      if (prevPageSize.current === pageSize) return;
      const prevSize = prevPageSize.current;
      const prevDefaultFontSize = getDefaultFontSizeForPageSize(prevSize);
      const prevDefaultLineSpacing = getDefaultLineSpacingForPageSize(prevSize);
      const nextDefaultFontSize = getDefaultFontSizeForPageSize(pageSize);
      const nextDefaultLineSpacing = getDefaultLineSpacingForPageSize(pageSize);
      const fontScale = prevDefaultFontSize > 0 ? nextDefaultFontSize / prevDefaultFontSize : 1;
      prevPageSize.current = pageSize;
      setLeftMargin(DEFAULT_MARGINS[pageSize].left);
      setRightMargin(DEFAULT_MARGINS[pageSize].right);

      const clampFontSize = (value: number) => Math.max(8, Math.min(72, Math.round(value)));

      let didScaleRuns = false;
      if (fontScale !== 1 && runsRef.current.length > 0) {
        runsRef.current = runsRef.current.map((run) => {
          const baseSize = Number.isFinite(run.fontSize) ? run.fontSize : prevDefaultFontSize;
          const nextSize = clampFontSize(baseSize * fontScale);
          if (nextSize !== run.fontSize) didScaleRuns = true;
          return { ...run, fontSize: nextSize };
        });
      }

      if (fontScale !== 1) {
        const nextFmtFontSize = clampFontSize(curFmtRef.current.fontSize * fontScale);
        curFmtRef.current = { ...curFmtRef.current, fontSize: nextFmtFontSize };
      }

      if (curFmtRef.current.fontSize === prevDefaultFontSize) {
        curFmtRef.current = { ...curFmtRef.current, fontSize: nextDefaultFontSize };
      }
      if (curFmtRef.current.lineSpacing === prevDefaultLineSpacing) {
        curFmtRef.current = { ...curFmtRef.current, lineSpacing: nextDefaultLineSpacing };
      }
      setQuickFormattingState((prev) =>
        prev.fontSize === prevDefaultFontSize
          ? { ...prev, fontSize: nextDefaultFontSize }
          : fontScale !== 1
            ? { ...prev, fontSize: clampFontSize(prev.fontSize * fontScale) }
            : prev,
      );

      if (didScaleRuns) {
        emitChange();
      }

      // Keep external toolbar state in sync immediately after mode/page-size switch.
      notifyFmt();
    }, [pageSize]);

    useEffect(() => {
      if (!isPaperMode) {
        setPaperPagination((prev) =>
          prev.pageCount === 1 && prev.pageHeightPx === 0
            ? prev
            : {
                pageCount: 1,
                pageHeightPx: 0,
              },
        );
      }
    }, [isPaperMode]);

    useEffect(() => {
      canvasRef.current?.focus();
    }, []);

    useEffect(() => {
      if (!selectedImage) {
        if (syncOverlayRafRef.current !== null) {
          cancelAnimationFrame(syncOverlayRafRef.current);
          syncOverlayRafRef.current = null;
        }
        return;
      }
      syncImageOverlay(selectedImage);
    }, [selectedImage, leftMargin, rightMargin, pageSize, contentVersion, syncImageOverlay]);

    useEffect(() => {
      if (selectedImage) {
        notifyFmt();
        return;
      }
      setIsImagePanelOpen(false);
      notifyFmt();
    }, [selectedImage, notifyFmt]);

    useEffect(() => {
      notifyFmt();
    }, [isImagePanelOpen, notifyFmt]);

    useEffect(() => {
      if (!selectedImage) return;
      const handlePointerDownOutside = (event: MouseEvent) => {
        const root = rootRef.current;
        const target = event.target as Node | null;
        if (!root || !target) return;
        if (root.contains(target)) return;
        setSelectedImage(null);
        setHoveredImage(null);
        setIsImagePanelOpen(false);
      };
      document.addEventListener('mousedown', handlePointerDownOutside);
      return () => {
        document.removeEventListener('mousedown', handlePointerDownOutside);
      };
    }, [selectedImage]);

    const visibleImage = selectedImage ?? hoveredImage;
    const isSameImage = useCallback((a: ImageBox | null, b: ImageBox | null) => {
      if (!a || !b) return false;
      const ta = a.tableImage;
      const tb = b.tableImage;
      if (ta || tb) {
        return (
          Boolean(ta) &&
          Boolean(tb) &&
          ta!.tableStart === tb!.tableStart &&
          ta!.row === tb!.row &&
          ta!.column === tb!.column &&
          ta!.tokenRangeIndex === tb!.tokenRangeIndex
        );
      }
      return a.start === b.start && a.end === b.end;
    }, []);
    useEffect(() => {
      if (!visibleImage) return;
      setAltDraft(visibleImage.meta.alt);
    }, [visibleImage, isSameImage]);

    const renderImageOverlay = (image: ImageBox | null) => {
      if (!image) return null;
      const isSelected = isSameImage(selectedImage, image);
      const canAlignImage = image.meta.wrap !== 'break';
      const popupWidth = 240;
      const popupHeight = 56;
      const canvasWidth = canvasRef.current?.clientWidth ?? 0;
      // Center the popup horizontally above the image so it never overlaps with image content.
      let popupLeft = image.x + (image.width - popupWidth) / 2;
      let popupTop = image.y - popupHeight - 8;
      // Clamp horizontal position to canvas bounds
      popupLeft = Math.max(10, Math.min(popupLeft, canvasWidth - popupWidth - 10));
      // If not enough room above the image, flip it below
      if (popupTop < 10) {
        popupTop = image.y + image.height + 8;
      }

      const focusImageControls = () => {
        if (isSameImage(selectedImage, image)) return;
        setSelectedImage(image);
        setCursorOffset(image.tableImage?.tableStart ?? image.start);
        setAltDraft(image.meta.alt);
      };

      return (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className="pointer-events-auto absolute overflow-visible rounded-full border border-slate-200/80 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.16)] backdrop-blur"
            style={{ left: popupLeft, top: popupTop, width: popupWidth }}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={() => setHoveredImage(image)}
            onMouseLeave={() => {
              if (!isSelected) setHoveredImage(null);
            }}
          >
            <div className="flex items-center gap-2 px-2.5 py-2">
              {image.meta.wrap === 'break' && (
                <BreakLayoutControls
                  image={image}
                  variant="compact"
                  onSelect={updateBreakLayout}
                  onMouseDownButton={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    focusImageControls();
                  }}
                />
              )}

              {canAlignImage && (
                <div className="flex items-center gap-1 rounded-full bg-slate-100/90 p-1">
                  {IMAGE_ALIGN_OPTIONS.map((option) => (
                    <div key={option.key} className="relative inline-flex group">
                      <button
                        type="button"
                        title={option.title}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          focusImageControls();
                        }}
                        onClick={() => updateSelectedImageAlign(option.key)}
                        className={`relative flex h-5 w-5 items-center justify-center rounded-full transition-all ${image.meta.align === option.key ? 'bg-white text-cyan-700 shadow-[0_2px_6px_rgba(15,23,42,0.14)]' : 'text-slate-500 hover:bg-white/90 hover:text-slate-700'}`}
                      >
                        {image.meta.wrap === 'wrap' ? (
                          renderWrapAlignIcon(option.key, 'h-4 w-4')
                        ) : (
                          <span className="material-icons text-[16px]">{option.icon}</span>
                        )}
                      </button>
                      <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {option.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <WrapModeControls
                currentWrap={image.meta.wrap}
                variant="compact"
                onSelect={updateSelectedImageWrap}
                onMouseDownButton={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  focusImageControls();
                }}
              />

              <button
                type="button"
                title="Open image options"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  focusImageControls();
                }}
                onClick={() => {
                  focusImageControls();
                  setIsImagePanelOpen(true);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)] transition-transform hover:-translate-y-0.5"
              >
                <span className="material-icons text-[16px]">tune</span>
              </button>
            </div>
          </div>

          <div
            className={`absolute rounded-[22px] border ${isSelected ? 'border-cyan-500/80' : 'border-cyan-300/60'} bg-cyan-400/5 shadow-[0_18px_40px_rgba(8,145,178,0.12)] transition-colors`}
            style={{
              left: image.x,
              top: image.y,
              width: image.width,
              height: image.height,
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              focusImageControls();
            }}
          >
            <button
              type="button"
              onMouseDown={startRotate}
              className="pointer-events-auto absolute flex h-8 w-8 items-center justify-center rounded-full border border-cyan-200 bg-white text-cyan-700 shadow-[0_10px_22px_rgba(15,23,42,0.14)]"
              style={{ left: 'calc(50% - 16px)', top: -34, cursor: 'grab' }}
              title="Rotate image"
            >
              <span className="material-icons text-[16px]">rotate_right</span>
            </button>
            <div className="absolute left-1/2 -top-3.5 h-4 w-px -translate-x-1/2 bg-cyan-300" />

            {isSelected &&
              IMAGE_RESIZE_HANDLES.map((handle) => (
                <button
                  key={handle.key}
                  type="button"
                  onMouseDown={(event) => startResize(handle.key, event)}
                  className="pointer-events-auto absolute h-2.5 w-2.5 rounded-full border border-white/80 bg-cyan-500 shadow-[0_2px_6px_rgba(6,182,212,0.25)]"
                  style={{
                    left: handle.left,
                    top: handle.top,
                    cursor: handle.cursor,
                  }}
                  title="Resize image"
                />
              ))}
          </div>
        </div>
      );
    };

    const renderImagePanel = (image: ImageBox | null) => {
      const isSelected = image ? isSameImage(selectedImage, image) : false;
      const canAlignImage = image ? image.meta.wrap !== 'break' : false;
      const hasMoreOptions = image ? image.meta.wrap === 'break' || canAlignImage : false;
      const panelWidthClass = hasMoreOptions ? 'w-[300px]' : 'w-[250px]';

      return (
        <aside
          className={`pointer-events-auto absolute bottom-3 right-3 top-16 z-30 ${panelWidthClass} max-w-[96vw] overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-[-12px_0_28px_rgba(15,23,42,0.10)] backdrop-blur transition-transform duration-200 ${image ? 'translate-x-0' : 'translate-x-[120%]'}`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {image ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200/80 bg-slate-50/80 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Image Options
                </div>
                <div className="flex gap-1.5">
                  {!isSelected && (
                    <button
                      type="button"
                      className="group flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                      onClick={() => {
                        setSelectedImage(image);
                        setCursorOffset(image.tableImage?.tableStart ?? image.start);
                        setAltDraft(image.meta.alt);
                      }}
                      title="Pin image panel"
                    >
                      <span className="material-icons text-[18px]">push_pin</span>
                      <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        Pin
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="group flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-700"
                    onClick={() => {
                      setSelectedImage(null);
                      setHoveredImage(null);
                      setIsImagePanelOpen(false);
                    }}
                    title="Close image panel"
                  >
                    <span className="material-icons text-[18px]">close</span>
                    <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      Close
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {canAlignImage && (
                  <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Alignment
                    </div>
                    <div className="flex gap-2">
                      {IMAGE_ALIGN_OPTIONS.map((option) => (
                        <div key={option.key} className="relative group">
                          <button
                            type="button"
                            className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all ${image.meta.align === option.key ? 'bg-cyan-600 text-white shadow' : 'bg-white text-slate-500 border border-slate-200 hover:bg-cyan-50 hover:text-cyan-700'}`}
                            onClick={() => updateSelectedImageAlign(option.key)}
                            title={option.title}
                          >
                            {image.meta.wrap === 'wrap' ? (
                              renderWrapAlignIcon(option.key, 'h-5 w-5')
                            ) : (
                              <span className="material-icons text-[20px]">{option.icon}</span>
                            )}
                          </button>
                          <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            {option.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Text Wrap
                  </div>

                  {image.meta.wrap === 'break' && (
                    <BreakLayoutControls
                      image={image}
                      variant="panel"
                      onSelect={updateBreakLayout}
                    />
                  )}

                  <WrapModeControls
                    currentWrap={image.meta.wrap}
                    variant="panel"
                    onSelect={updateSelectedImageWrap}
                  />
                </section>

                {/* Width */}
                <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Width
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                      onClick={() => updateImageWidthByValue(image, Math.max(25, image.meta.widthPct - 5), true)}
                      aria-label="Decrease width"
                      title="Decrease width"
                    >
                      <span className="material-icons text-[18px]">remove</span>
                    </button>
                    <input
                      type="range"
                      min={25}
                      max={100}
                      value={image.meta.widthPct}
                      onChange={(e) => updateImageWidthByValue(image, Number(e.currentTarget.value), false)}
                      onMouseUp={(e) => updateImageWidthByValue(image, Number(e.currentTarget.value), true)}
                      onTouchEnd={(e) => updateImageWidthByValue(image, Number(e.currentTarget.value), true)}
                      className="flex-1 h-2 rounded-full bg-slate-200 accent-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                      aria-label="Image width"
                      style={{ minWidth: 60 }}
                    />
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                      onClick={() => updateImageWidthByValue(image, Math.min(100, image.meta.widthPct + 5), true)}
                      aria-label="Increase width"
                      title="Increase width"
                    >
                      <span className="material-icons text-[18px]">add</span>
                    </button>
                    <div className="w-12 text-right text-xs text-slate-700 select-none">
                      {image.meta.widthPct}%
                    </div>
                  </div>
                </section>

                {/* Rotation */}
                <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Rotation
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                      onClick={() => rotateSelectedImageBy(-15)}
                      title="Rotate -15°"
                    >
                      <span className="material-icons text-[18px]">rotate_left</span>
                    </button>
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                      onClick={() => rotateSelectedImageBy(15)}
                      title="Rotate +15°"
                    >
                      <span className="material-icons text-[18px]">rotate_right</span>
                    </button>
                    <div className="text-[11px] text-slate-500 min-w-8 text-center">
                      {image.meta.rotationDeg}°
                    </div>
                  </div>
                </section>

                {/* Alt text */}
                <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                  <label className="block text-[11px] font-medium text-slate-600">
                    Alt text
                    <input
                      value={altDraft}
                      onChange={(event) => setAltDraft(event.target.value)}
                      onBlur={commitSelectedImageAlt}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitSelectedImageAlt();
                        }
                      }}
                      placeholder="Describe this image"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-cyan-400"
                    />
                  </label>
                </section>
              </div>
            </div>
          ) : null}
        </aside>
      );
    };

    // ── JSX ───────────────────────────────────────────────────────────────────
    return (
      <div
        ref={rootRef}
        className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm"
      >
        <div className="z-30 w-full shrink-0 px-3 py-1">
          <MarginRuler
            left={leftMargin}
            right={rightMargin}
            min={0}
            max={100}
            step={1}
            pageRef={isPaperMode ? pageElRef : undefined}
            paperWidthMm={
              isPaperMode
                ? PAGE_DIMENSIONS[pageSize as Exclude<PageSize, 'responsive'>].widthMm
                : undefined
            }
            onChangeLeft={(v) => setLeftMargin(v)}
            onChangeRight={(v) => setRightMargin(v)}
          />
        </div>

        {isPaperMode ? (
          <div className="docsync-editor-scrollbars relative min-h-0 h-full flex-1 overflow-x-auto overflow-y-auto">
            <div className="flex min-h-full items-start justify-center p-6">
              <div
                ref={pageElRef}
                className="relative shrink-0 bg-white"
                style={{
                  width: PAGE_DIMENSIONS[pageSize as Exclude<PageSize, 'responsive'>].width,
                  height: paperCanvasHeight,
                  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)',
                  borderRadius: 6,
                }}
              >
                {paperPagination.pageHeightPx > 0 && paperPagination.pageCount > 1
                  ? Array.from({ length: paperPagination.pageCount - 1 }).map((_, idx) => {
                      const gapTop =
                        (idx + 1) * paperPagination.pageHeightPx + idx * PAPER_MODE_PAGE_GAP_PX;
                      return (
                        <div
                          key={`page-break-${idx}`}
                          className="pointer-events-none absolute inset-x-0 z-10"
                          style={{ top: gapTop, height: PAPER_MODE_PAGE_GAP_PX }}
                        >
                          <div className="h-full w-full bg-slate-100/80" />
                          <div className="absolute inset-x-0 top-0 border-t border-slate-300/90" />
                          <div className="absolute inset-x-0 bottom-0 border-b border-slate-300/90" />
                        </div>
                      );
                    })
                  : null}
                <canvas
                  ref={canvasRef}
                  className="w-full h-full cursor-text"
                  tabIndex={0}
                  onKeyDown={handleCanvasKeyDown}
                  onPaste={handleCanvasPaste}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseUp={handleCanvasMouseUp}
                  onDoubleClick={handleCanvasDoubleClick}
                  onMouseMove={handleCanvasMouseMove}
                  onWheel={handleWheel}
                  onContextMenu={handleCanvasContextMenu}
                  aria-label="Document editor"
                  style={{ display: 'block', outline: 'none' }}
                />
                {renderImageOverlay(visibleImage)}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 h-full flex-1 overflow-hidden">
            <div
              className="relative h-full w-full"
            >
              <canvas
                ref={canvasRef}
                className="h-full w-full cursor-text"
                tabIndex={0}
                onKeyDown={handleCanvasKeyDown}
                onPaste={handleCanvasPaste}
                onMouseDown={handleCanvasMouseDown}
                onMouseUp={handleCanvasMouseUp}
                onDoubleClick={handleCanvasDoubleClick}
                onMouseMove={handleCanvasMouseMove}
                onWheel={handleWheel}
                onContextMenu={handleCanvasContextMenu}
                aria-label="Document editor"
                style={{ display: 'block', outline: 'none' }}
              />
              {renderImageOverlay(visibleImage)}
            </div>
          </div>
        )}
        <CanvasContextMenu
          open={isMenuOpen}
          x={menuPos.x}
          y={menuPos.y}
          showQuickFormatting={showQuickFormatting}
          quickFormattingState={quickFormattingState}
          onClose={() => setIsMenuOpen(false)}
          onAction={handleContextMenuAction}
        />
        {renderImagePanel(selectedImage && isImagePanelOpen ? selectedImage : null)}
      </div>
    );
  },
);

export default RichEditor;
