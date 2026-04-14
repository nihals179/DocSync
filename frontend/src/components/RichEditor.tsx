// RichEditor — canvas-only rich text editor (thin orchestration shell)
import { useRef, useImperativeHandle, forwardRef, useState, useEffect, useCallback } from 'react';
import MarginRuler from './MarginRuler';
import {
  DEFAULT_RUN_FMT,
  getFormatAt,
  isBulletAtOffset,
  isFormatUniform,
  isNumberListAtOffset,
  isSpaceAfterLineAtOffset,
  isSpaceBeforeLineAtOffset,
  makeRun,
  runsToText,
  type ImageWrap,
  type Run,
  type RunFmt,
} from './editor/textModel';
import type { CursorFormat, ResizeHandle, RichEditorHandle } from './editor/types';
import {
  IMAGE_BEHAVIOR_OPTIONS,
  IMAGE_RESIZE_HANDLES,
  IMAGE_WRAP_OPTIONS,
} from './editor/imageUiConfig';
import { DEFAULT_MARGINS, PAGE_DIMENSIONS, type PageSize } from './editor/pageConfig';
import { useEditorDraw, type ImageBox } from './editor/useEditorDraw';
import { useEditorInput } from './editor/useEditorInput';

export type { CursorFormat, RichEditorHandle } from './editor/types';

type RichEditorProps = {
  initialContent?: string;
  onContentChange?: (html: string) => void;
  /** Called whenever the cursor position or formatting changes */
  onCursorFormatChange?: (fmt: CursorFormat) => void;
  pageSize: PageSize;
};

// ── Component ────────────────────────────────────────────────────────────────
const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(
  ({ initialContent, onContentChange, onCursorFormatChange, pageSize }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pageElRef = useRef<HTMLDivElement | null>(null);

    const [leftMargin, setLeftMargin] = useState(DEFAULT_MARGINS[pageSize].left);
    const [rightMargin, setRightMargin] = useState(DEFAULT_MARGINS[pageSize].right);
    const [hoveredImage, setHoveredImage] = useState<ImageBox | null>(null);
    const [selectedImage, setSelectedImage] = useState<ImageBox | null>(null);
    const [isImagePanelOpen, setIsImagePanelOpen] = useState(false);
    const [altDraft, setAltDraft] = useState('');
    const [contentVersion, setContentVersion] = useState(0);
    const prevPageSize = useRef(pageSize);
    const isPaperMode = pageSize !== 'responsive';

    // ── Document refs ─────────────────────────────────────────────────────────
    const runsRef = useRef<Run[]>([makeRun(initialContent ?? '', { ...DEFAULT_RUN_FMT })]);
    const cursorRef = useRef(initialContent?.length ?? 0);
    const scrollYRef = useRef(0);
    const blinkRef = useRef(true);
    const blinkTimerRef = useRef<number | null>(null);
    const selStartRef = useRef<number | null>(null);
    const curFmtRef = useRef<RunFmt>({ ...DEFAULT_RUN_FMT });
    const isDraggingRef = useRef(false);
    const undoStackRef = useRef<Array<{ runs: Run[]; cursor: number }>>([]);
    const redoStackRef = useRef<Array<{ runs: Run[]; cursor: number }>>([]);

    const emitChange = useCallback(() => {
      onContentChange?.(runsToText(runsRef.current));
      setContentVersion((value) => value + 1);
    }, [onContentChange]);
    const notifyFmt = useCallback(() => {
      const text = runsToText(runsRef.current);
      const bullet = isBulletAtOffset(text, cursorRef.current);
      const numberList = isNumberListAtOffset(text, cursorRef.current);
      const hasSpaceBeforeLine = isSpaceBeforeLineAtOffset(text, cursorRef.current);
      const hasSpaceAfterLine = isSpaceAfterLineAtOffset(text, cursorRef.current);
      onCursorFormatChange?.({
        ...curFmtRef.current,
        bullet,
        numberList,
        hasSpaceBeforeLine,
        hasSpaceAfterLine,
        imageSelected: Boolean(selectedImage),
        imagePanelOpen: Boolean(selectedImage) && isImagePanelOpen,
        imageAlign: selectedImage?.meta.align ?? 'center',
        imageWidthPct: selectedImage?.meta.widthPct ?? 100,
      });
    }, [onCursorFormatChange, selectedImage, isImagePanelOpen]);

    // ── Drawing hook ──────────────────────────────────────────────────────────
    const drawRefs = {
      canvasRef,
      runsRef,
      cursorRef,
      selStartRef,
      scrollYRef,
      blinkRef,
      blinkTimerRef,
      curFmtRef,
    };
    const {
      draw,
      resetBlink,
      getOffsetFromClientXY,
      getImageBoxAtClientXY,
      getImageBoxAtOffset,
      getResolvedImageBox,
    } = useEditorDraw(drawRefs, leftMargin, rightMargin, isPaperMode);

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
      toggleSpaceBeforeLine,
      toggleSpaceAfterLine,
      insertLink,
      insertImage,
      setImageAlign,
      setImageWidthPct,
      setImageRotationDeg,
      setImageWrap,
      setImagePosition,
      setImageAltText,
      setCursorOffset,
    } = useEditorInput(inputRefs, {
      ...inputCbs,
      onImageInserted: (offset: number) => {
        // Defer selection until after next draw so imageBoxesRef is up-to-date
        window.requestAnimationFrame(() => {
          const imageBox = getImageBoxAtOffset(offset);
          if (imageBox) {
            setSelectedImage(imageBox);
            setAltDraft(imageBox.meta.alt);
          }
        });
      },
    });

    const syncImageOverlay = useCallback(
      (image: Pick<ImageBox, 'start' | 'end' | 'meta'> | null) => {
        window.requestAnimationFrame(() => {
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
        handleMouseMove();
        const next = getImageBoxAtClientXY(e.clientX, e.clientY);
        setHoveredImage(next);
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = next ? 'pointer' : 'text';
      },
      [handleMouseMove, getImageBoxAtClientXY],
    );

    const handleCanvasMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const hit = getImageBoxAtClientXY(e.clientX, e.clientY);
        if (hit) {
          e.preventDefault();
          const canvasRect = canvasRef.current?.getBoundingClientRect();
          const clickX = canvasRect ? e.clientX - canvasRect.left : hit.x;
          const midX = hit.x + hit.width / 2;
          setCursorOffset(clickX <= midX ? hit.start : hit.end);
          setSelectedImage(hit);
          setAltDraft(hit.meta.alt);
          return;
        }
        setSelectedImage(null);
        setIsImagePanelOpen(false);
        handleMouseDown(e);
      },
      [getImageBoxAtClientXY, setCursorOffset, handleMouseDown],
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

    const updateSelectedImageAlign = useCallback(
      (align: 'left' | 'center' | 'right') => {
        const image = selectedImage ?? hoveredImage;
        if (!image) return;
        applyImageMutation(image.start, () => setImageAlign(align));
      },
      [selectedImage, hoveredImage, applyImageMutation, setImageAlign],
    );

    const updateSelectedImageWrap = useCallback(
      (wrap: ImageWrap) => {
        const image = selectedImage ?? hoveredImage;
        if (!image) return;
        applyImageMutation(image.start, () => setImageWrap(wrap));
      },
      [selectedImage, hoveredImage, applyImageMutation, setImageWrap],
    );

    const updateSelectedImagePosition = useCallback(
      (position: 'move' | 'fixed') => {
        const image = selectedImage ?? hoveredImage;
        if (!image) return;
        applyImageMutation(image.start, () => setImagePosition(position));
      },
      [selectedImage, hoveredImage, applyImageMutation, setImagePosition],
    );

    const commitSelectedImageAlt = useCallback(() => {
      const image = selectedImage ?? hoveredImage;
      if (!image) return;
      applyImageMutation(image.start, () => setImageAltText(altDraft));
    }, [selectedImage, hoveredImage, altDraft, applyImageMutation, setImageAltText]);

    const rotateSelectedImageBy = useCallback(
      (deltaDeg: number) => {
        const image = selectedImage ?? hoveredImage;
        if (!image) return;
        applyImageMutation(image.start, () =>
          setImageRotationDeg(image.meta.rotationDeg + deltaDeg),
        );
      },
      [selectedImage, hoveredImage, applyImageMutation, setImageRotationDeg],
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
          applyImageMutation(selectedImage.start, () => setImageWidthPct(nextWidthPct, false));
        };

        const onUp = () => {
          applyImageMutation(selectedImage.start, () => setImageWidthPct(lastWidthPct, true));
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
          applyImageMutation(selectedImage.start, () => setImageRotationDeg(lastRotation, false));
        };

        const onUp = () => {
          applyImageMutation(selectedImage.start, () => setImageRotationDeg(lastRotation, true));
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      },
      [selectedImage, applyImageMutation, setImageRotationDeg],
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
      setFontSize: (n: number) => applyOrSetFmt({ fontSize: Math.max(8, Math.min(72, n)) }),
      toggleBold: () => {
        const { selF, selT, hasSel } = getSelRange();
        const allBold = hasSel && isFormatUniform(runsRef.current, selF, selT, 'bold', true);
        applyOrSetFmt({ bold: hasSel ? !allBold : !curFmtRef.current.bold });
      },
      getBold: () => curFmtRef.current.bold,
      toggleItalic: () => {
        const { selF, selT, hasSel } = getSelRange();
        const allItalic = hasSel && isFormatUniform(runsRef.current, selF, selT, 'italic', true);
        applyOrSetFmt({
          italic: hasSel ? !allItalic : !curFmtRef.current.italic,
        });
      },
      getItalic: () => curFmtRef.current.italic,
      toggleUnderline: () => {
        const { selF, selT, hasSel } = getSelRange();
        const allUnder = hasSel && isFormatUniform(runsRef.current, selF, selT, 'underline', true);
        applyOrSetFmt({
          underline: hasSel ? !allUnder : !curFmtRef.current.underline,
        });
      },
      getUnderline: () => curFmtRef.current.underline,
      getFontFamily: () => curFmtRef.current.fontFamily,
      setFontFamily: (f: string) => applyOrSetFmt({ fontFamily: f }),
      getTextColor: () => curFmtRef.current.color,
      setTextColor: (c: string) => applyOrSetFmt({ color: c }),
      toggleBullet,
      toggleNumberList,
      indentLeft,
      indentRight,
      setLineSpacing,
      toggleHighlight,
      setHighlightColor,
      insertLink,
      insertImage,
      setImageAlign,
      setImageWidthPct,
      setImageRotationDeg,
      setImageWrap,
      setImageAltText,
      toggleImagePanel: () => setIsImagePanelOpen((prev) => !prev),
      openImagePanel: () => setIsImagePanelOpen(true),
      closeImagePanel: () => setIsImagePanelOpen(false),
      toggleSpaceBeforeLine,
      toggleSpaceAfterLine,
      undo: undoFn,
      redo: redoFn,
    }));

    // ── Effects ───────────────────────────────────────────────────────────────
    useEffect(() => {
      if (initialContent !== undefined) {
        runsRef.current = [makeRun(initialContent, { ...DEFAULT_RUN_FMT })];
        cursorRef.current = initialContent.length;
        selStartRef.current = null;
        onContentChange?.(initialContent);
      }
    }, [initialContent]);

    useEffect(() => {
      if (prevPageSize.current === pageSize) return;
      prevPageSize.current = pageSize;
      setLeftMargin(DEFAULT_MARGINS[pageSize].left);
      setRightMargin(DEFAULT_MARGINS[pageSize].right);
    }, [pageSize]);

    useEffect(() => {
      canvasRef.current?.focus();
    }, []);

    useEffect(() => {
      if (!selectedImage) return;
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

    const visibleImage = selectedImage ?? hoveredImage;
    useEffect(() => {
      if (!visibleImage) return;
      setAltDraft(visibleImage.meta.alt);
    }, [visibleImage?.start]);

    const renderImageOverlay = (image: ImageBox | null) => {
      if (!image) return null;
      const isSelected = selectedImage?.start === image.start;
      const canAlignImage = image.meta.position === 'fixed';
      const popupWidth = canAlignImage ? 300 : 210;
      const popupHeight = 56;
      const canvasWidth = canvasRef.current?.clientWidth ?? 0;
      // For right-aligned images, show popup on the left side of the image.
      // Otherwise keep popup on the right side.
      let popupLeft =
        image.meta.align === 'right' ? image.x - popupWidth - 8 : image.x + image.width + 8;
      let popupTop = image.y - popupHeight - 8;
      // Clamp to canvas bounds
      popupLeft = Math.max(10, Math.min(popupLeft, canvasWidth - popupWidth - 10));
      popupTop = Math.max(10, popupTop);

      const focusImageControls = () => {
        if (selectedImage?.start === image.start) return;
        setSelectedImage(image);
        setCursorOffset(image.start);
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
              {canAlignImage && (
                <div className="flex items-center gap-1 rounded-full bg-slate-100/90 p-1">
                  {(
                    [
                      {
                        key: 'left',
                        icon: 'format_align_left',
                        title: 'Align left',
                      },
                      {
                        key: 'center',
                        icon: 'format_align_center',
                        title: 'Align center',
                      },
                      {
                        key: 'right',
                        icon: 'format_align_right',
                        title: 'Align right',
                      },
                    ] as const
                  ).map((option) => (
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
                        className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${image.meta.align === option.key ? 'bg-white text-cyan-700 shadow-[0_2px_6px_rgba(15,23,42,0.14)]' : 'text-slate-500 hover:bg-white/90 hover:text-slate-700'}`}
                      >
                        <span className="material-icons text-[16px]">{option.icon}</span>
                      </button>
                      <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {option.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1 rounded-full bg-slate-100/90 p-1">
                {IMAGE_WRAP_OPTIONS.map((option) => (
                  <div key={option.key} className="relative inline-flex group">
                    <button
                      type="button"
                      title={option.title}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        focusImageControls();
                      }}
                      onClick={() => updateSelectedImageWrap(option.key)}
                      className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${image.meta.wrap === option.key ? 'bg-white text-cyan-700 shadow-[0_2px_6px_rgba(15,23,42,0.14)]' : 'text-slate-500 hover:bg-white/90 hover:text-slate-700'}`}
                    >
                      {option.key === 'inline' && (
                        <svg
                          viewBox="0 -960 960 960"
                          className="h-4 w-4"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Zm280 200v-80h240v80H600Z" />
                        </svg>
                      )}
                      {option.key === 'break' && (
                        <svg
                          viewBox="0 -960 960 960"
                          className="h-4 w-4"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Z" />
                        </svg>
                      )}
                      {option.key === 'front' && (
                        <svg
                          viewBox="0 -960 960 960"
                          className="h-4 w-4"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M120-120v-80h720v80H120Zm0-160v-80h100v80H120Zm160 0v-400h400v400H280Zm460 0v-80h100v80H740Zm-380-80h240v-240H360v240Zm-240-80v-80h100v80H120Zm620 0v-80h100v80H740ZM120-600v-80h100v80H120Zm620 0v-80h100v80H740ZM120-760v-80h720v80H120Zm360 280Z" />
                        </svg>
                      )}
                      {option.key === 'wrap' && (
                        <svg
                          viewBox="0 -960 960 960"
                          className="h-4 w-4"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M120-280v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm480 160v-80h240v80H600Zm0 160v-80h240v80H600Zm0 160v-80h240v80H600ZM120-120v-80h720v80H120Zm200-360Z" />
                        </svg>
                      )}
                    </button>
                    <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {option.title}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-full bg-slate-100/90 p-1">
                {(
                  [
                    { key: 'move', icon: 'open_with', title: 'Move with text' },
                    { key: 'fixed', icon: 'push_pin', title: 'Fixed position' },
                  ] as const
                ).map((option) => (
                  <div key={option.key} className="relative inline-flex group">
                    <button
                      type="button"
                      title={option.title}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        focusImageControls();
                      }}
                      onClick={() => updateSelectedImagePosition(option.key)}
                      className={`flex h-5 w-5 items-center justify-center rounded-full transition-all ${image.meta.position === option.key ? 'bg-white text-cyan-700 shadow-[0_2px_6px_rgba(15,23,42,0.14)]' : 'text-slate-500 hover:bg-white/90 hover:text-slate-700'}`}
                    >
                      <span className="material-icons text-[14px]">{option.icon}</span>
                    </button>
                    <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {option.title}
                    </span>
                  </div>
                ))}
              </div>
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
      const isSelected = image && selectedImage?.start === image.start;
      const canAlignImage = image ? image.meta.position === 'fixed' : false;

      return (
        <aside
          className={`pointer-events-auto absolute bottom-3 right-3 top-16 z-30 w-72 max-w-[96vw] overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-[-12px_0_28px_rgba(15,23,42,0.10)] backdrop-blur transition-transform duration-200 ${image ? 'translate-x-0' : 'translate-x-[120%]'}`}
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
                        setCursorOffset(image.start);
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
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <div key={align} className="relative group">
                          <button
                            type="button"
                            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${image.meta.align === align ? 'bg-cyan-600 text-white shadow' : 'bg-white text-slate-500 border border-slate-200 hover:bg-cyan-50 hover:text-cyan-700'}`}
                            onClick={() => updateSelectedImageAlign(align)}
                            title={`Align ${align}`}
                          >
                            <span className="material-icons text-[20px]">
                              {align === 'left'
                                ? 'format_align_left'
                                : align === 'center'
                                  ? 'format_align_center'
                                  : 'format_align_right'}
                            </span>
                          </button>
                          <span className="pointer-events-none absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            Align {align}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Wrap */}
                <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Position Behavior
                  </div>
                  <label className="block text-[11px] font-medium text-slate-600">
                    <select
                      value={image.meta.position}
                      onChange={(event) =>
                        updateSelectedImagePosition(event.target.value as 'move' | 'fixed')
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-cyan-400"
                    >
                      {IMAGE_BEHAVIOR_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-2 text-[11px] text-slate-500">
                    {
                      IMAGE_BEHAVIOR_OPTIONS.find((option) => option.key === image.meta.position)
                        ?.description
                    }
                  </div>
                </section>

                {/* Wrap */}
                <section className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Text Wrap
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {IMAGE_WRAP_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all ${image.meta.wrap === option.key ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50/40'}`}
                        onClick={() => updateSelectedImageWrap(option.key)}
                        title={option.title}
                      >
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${image.meta.wrap === option.key ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                        >
                          {option.key === 'inline' && (
                            <svg
                              viewBox="0 -960 960 960"
                              className="h-5 w-5"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Zm280 200v-80h240v80H600Z" />
                            </svg>
                          )}
                          {option.key === 'break' && (
                            <svg
                              viewBox="0 -960 960 960"
                              className="h-5 w-5"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Z" />
                            </svg>
                          )}
                          {option.key === 'front' && (
                            <svg
                              viewBox="0 -960 960 960"
                              className="h-5 w-5"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M120-120v-80h720v80H120Zm0-160v-80h100v80H120Zm160 0v-400h400v400H280Zm460 0v-80h100v80H740Zm-380-80h240v-240H360v240Zm-240-80v-80h100v80H120Zm620 0v-80h100v80H740ZM120-600v-80h100v80H120Zm620 0v-80h100v80H740ZM120-760v-80h720v80H120Zm360 280Z" />
                            </svg>
                          )}
                          {option.key === 'wrap' && (
                            <svg
                              viewBox="0 -960 960 960"
                              className="h-5 w-5"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M120-280v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm480 160v-80h240v80H600Zm0 160v-80h240v80H600Zm0 160v-80h240v80H600ZM120-120v-80h720v80H120Zm200-360Z" />
                            </svg>
                          )}
                        </span>
                        <span className="text-xs font-medium leading-tight">{option.label}</span>
                      </button>
                    ))}
                  </div>
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
                      onClick={() =>
                        applyImageMutation(image.start, () =>
                          setImageWidthPct(Math.max(25, image.meta.widthPct - 5), true),
                        )
                      }
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
                      onChange={(e) =>
                        applyImageMutation(image.start, () =>
                          setImageWidthPct(Number(e.currentTarget.value), false),
                        )
                      }
                      onMouseUp={() =>
                        applyImageMutation(image.start, () =>
                          setImageWidthPct(image.meta.widthPct, true),
                        )
                      }
                      className="flex-1 h-2 rounded-full bg-slate-200 accent-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                      aria-label="Image width"
                      style={{ minWidth: 60 }}
                    />
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                      onClick={() =>
                        applyImageMutation(image.start, () =>
                          setImageWidthPct(Math.min(100, image.meta.widthPct + 5), true),
                        )
                      }
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
        className={`relative min-h-0 flex-1 ${isPaperMode ? 'overflow-auto' : 'overflow-hidden'} rounded-xl border border-slate-200/80 bg-white shadow-sm`}
      >
        <div className="sticky top-0 z-30 w-full px-3 py-1">
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
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onWheel={handleWheel}
                aria-label="Document editor"
                style={{ display: 'block', outline: 'none' }}
              />
              {renderImageOverlay(visibleImage)}
            </div>
          </div>
        ) : (
          <div className="relative" style={{ height: 'calc(100% - 48px)' }}>
            <canvas
              ref={canvasRef}
              className="h-full w-full cursor-text"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onWheel={handleWheel}
              aria-label="Document editor"
              style={{ display: 'block', outline: 'none' }}
            />
            {renderImageOverlay(visibleImage)}
          </div>
        )}
        {renderImagePanel(selectedImage && isImagePanelOpen ? selectedImage : null)}
      </div>
    );
  },
);

export default RichEditor;
