import type { ImageTokenMeta } from './textModel';

export function imageMetaKey(meta: ImageTokenMeta): string {
  return JSON.stringify([
    meta.src,
    meta.widthPct,
    meta.align,
    meta.rotationDeg,
    meta.wrap,
    meta.position,
    meta.alt,
  ]);
}

export function getLayoutMetrics(
  w: number,
  leftMargin: number,
  rightMargin: number,
  isPaperMode: boolean,
  curFontSize: number,
) {
  const padLeft = (leftMargin / 100) * w + (isPaperMode ? 0 : w * 0.01);
  const padRight = ((100 - rightMargin) / 100) * w + (isPaperMode ? 0 : w * 0.01);
  const textAreaWidth = Math.max(w - padLeft - padRight, 50);
  const padTop = isPaperMode ? 45 : 32;
  const baseLineH = Math.ceil(curFontSize * 1.5);
  return { padLeft, padRight, textAreaWidth, padTop, baseLineH };
}
