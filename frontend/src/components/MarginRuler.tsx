import { useRef, useEffect, useState, useCallback } from 'react';

type MarginRulerProps = {
  left: number;
  right: number;
  min?: number;
  max?: number;
  step?: number;
  pageRef?: React.RefObject<HTMLElement | null>;
  paperWidthMm?: number;
  onChangeLeft: (v: number) => void;
  onChangeRight: (v: number) => void;
};


const MarginRuler: React.FC<MarginRulerProps> = ({ left, right, min = 0, max = 100, step = 1, pageRef, paperWidthMm, onChangeLeft, onChangeRight }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pageBox, setPageBox] = useState<{ left: number; width: number } | null>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);

  const updatePageBox = () => {
    if (!ref.current) return;
    if (!pageRef?.current) {
      setPageBox(null);
      return;
    }
    const containerRect = ref.current.getBoundingClientRect();
    const pageRect = pageRef.current.getBoundingClientRect();
    setPageBox({ left: pageRect.left - containerRect.left, width: pageRect.width });
  };

  const percentToValue = useCallback(
    (p: number) => Math.round(((p / 100) * (max - min) + min) / step) * step,
    [min, max, step]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const val = percentToValue(percent);
      if (dragging === 'left') {
        // prevent crossing
        const clamped = Math.min(val, right - step);
        onChangeLeft(Math.max(min, clamped));
      } else {
        const clamped = Math.max(val, left + step);
        onChangeRight(Math.min(max, clamped));
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, left, right, min, max, step, onChangeLeft, onChangeRight, percentToValue]);

  // observe page element and container to compute pageBox (relative left and width)
  useEffect(() => {
    if (!ref.current) return;
    const update = () => updatePageBox();
    update();
    window.addEventListener('resize', update);
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      if (pageRef?.current) ro.observe(pageRef.current);
      ro.observe(ref.current);
    } catch {}
    return () => {
      window.removeEventListener('resize', update);
      if (ro) {
        try {
          if (pageRef?.current) ro.unobserve(pageRef.current);
          if (ref.current) ro.unobserve(ref.current);
          ro.disconnect();
        } catch {}
      }
    };
  }, [pageRef]);

  const leftPx  = pageBox ? `${Math.round(pageBox.left + (left  / 100) * pageBox.width)}px` : `${left}%`;
  const rightPx = pageBox ? `${Math.round(pageBox.left + (right / 100) * pageBox.width)}px` : `${right}%`;
  const leftTooltip  = paperWidthMm ? `${(left  / 100 * paperWidthMm).toFixed(0)} mm` : `${left}%`;
  const rightTooltip = paperWidthMm ? `${((100 - right) / 100 * paperWidthMm).toFixed(0)} mm` : `${right}%`;

  return (
    <div className="w-full select-none" ref={ref}>
      <div className="relative h-10">
        <div className="absolute left-0 right-0 bottom-4 h-px bg-slate-200" />

        <div className="absolute left-0 right-0 top-0 h-full">
          {paperWidthMm ? (
            // ── CM ruler (Word / Google Docs style) with uniform larger ticks and even cm labels
            <>
              {/* margin shading zones */}
              {pageBox && (
                <>
                  <div
                    className="absolute top-0 bottom-4 bg-slate-100"
                    style={{
                      left: `${pageBox.left}px`,
                      width: `${(left / 100) * pageBox.width}px`,
                      borderRight: '1px solid #cbd5e1',
                    }}
                  />
                  <div
                    className="absolute top-0 bottom-4 bg-slate-100"
                    style={{
                      left: `${pageBox.left + (right / 100) * pageBox.width}px`,
                      width: `${((100 - right) / 100) * pageBox.width}px`,
                      borderLeft: '1px solid #cbd5e1',
                    }}
                  />
                </>
              )}
              {/* Fixed scale: 0 at left edge, labels increase left to right */}
              {(() => {
                const mmToPx = (mm: number) =>
                  pageBox
                    ? `${Math.round(pageBox.left + (mm / paperWidthMm) * pageBox.width)}px`
                    : `${(mm / paperWidthMm) * 100}%`;

                const totalCm = Math.floor(paperWidthMm / 10);

                const cmTicks: { mm: number; cm: number }[] = [];
                const mmTicks: number[] = [];

                for (let cm = 0; cm <= totalCm; cm++) {
                  cmTicks.push({ mm: cm * 10, cm });
                  for (let sub = 2; sub < 10; sub += 2) {
                    const subMm = cm * 10 + sub;
                    if (subMm < paperWidthMm) mmTicks.push(subMm);
                  }
                }

                return (
                  <>
                    {/* 2mm ticks */}
                    {mmTicks.map((mm) => (
                      <div
                        key={`mm2-${mm}`}
                        className="absolute top-0 h-full"
                        style={{ left: mmToPx(mm), width: 0, overflow: 'visible', transform: 'translateX(-50%)' }}
                      >
                        <div className="absolute left-0 -translate-x-1/2 w-px bg-slate-300" style={{ bottom: '18px', height: '6px' }} />
                      </div>
                    ))}

                    {/* cm ticks with labels */}
                    {cmTicks.map(({ mm, cm }) => {
                      const isEven = cm % 2 === 0;
                      return (
                        <div
                          key={`cm-${mm}`}
                          className="absolute top-0 h-full"
                          style={{ left: mmToPx(mm), width: 0, overflow: 'visible', transform: 'translateX(-50%)' }}
                        >
                          <div
                            className="absolute left-0 -translate-x-1/2 w-px"
                            style={{ bottom: '16px', height: isEven ? '12px' : '8px', backgroundColor: isEven ? '#0f172a' : '#6b7280' }}
                          />
                          <div className="absolute bottom-0 left-0 -translate-x-1/2 text-[9px] leading-none text-slate-500 font-medium">
                            {cm}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </>
          ) : (
            (() => {
              const pctToPx = (p: number) =>
                pageBox
                  ? `${Math.round(pageBox.left + (p / 100) * pageBox.width)}px`
                  : `${p}%`;

              // fixed scale: ticks every 2% from 0 to 100
              const ticks2: { pos: number }[] = [];
              for (let p = 0; p <= 100; p += 2) {
                ticks2.push({ pos: p });
              }

              return ticks2.map(({ pos }) => {
                const is10 = pos % 10 === 0;
                const is5  = pos % 5 === 0 && !is10;
                const height = is10 ? '12px' : is5 ? '8px' : '4px';
                const color  = is10 ? '#0f172a' : is5 ? '#6b7280' : '#cbd5e1';
                return (
                  <div
                    key={`pct-${pos}`}
                    className="absolute top-0 h-full -translate-x-1/2"
                    style={{ left: pctToPx(pos), width: 0, overflow: 'visible' }}
                  >
                    <div
                      className="absolute left-0 -translate-x-1/2 w-px"
                      style={{ bottom: '16px', height, backgroundColor: color }}
                    />
                    {is10 && (
                      <div className="absolute bottom-0 left-0 -translate-x-1/2 text-[9px] leading-none text-slate-500 font-medium">
                        {pos}%
                      </div>
                    )}
                  </div>
                );
              });
            })()
          )}
        </div>

        {/* left handle */}
        <div
          role="slider"
          aria-label="Left margin"
          style={{ left: leftPx }}
          className="absolute bottom-0 z-20 flex -translate-x-1/2 cursor-grab flex-col items-center group"
          onPointerDown={(e) => {
            try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
            e.preventDefault();
            setDragging('left');
          }}
        >
          <div className="absolute bottom-full mb-1.5 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150" style={{ opacity: dragging === 'left' ? 1 : undefined }}>
            {leftTooltip}
          </div>
          <div className="-mt-1">
            <svg width="10" height="6" viewBox="0 0 12 8" fill="none"><path d="M0 0L12 0L6 8Z" fill="#0ea5e9" /></svg>
          </div>
        </div>

        {/* right handle */}
        <div
          role="slider"
          aria-label="Right margin"
          style={{ left: rightPx }}
          className="absolute bottom-0 z-20 flex -translate-x-1/2 cursor-grab flex-col items-center group"
          onPointerDown={(e) => {
            try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {}
            e.preventDefault();
            setDragging('right');
          }}
        >
          <div className="absolute bottom-full mb-1.5 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150" style={{ opacity: dragging === 'right' ? 1 : undefined }}>
            {rightTooltip}
          </div>
          <div className="-mt-1">
            <svg width="10" height="6" viewBox="0 0 12 8" fill="none"><path d="M0 0L12 0L6 8Z" fill="#0ea5e9" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarginRuler;
