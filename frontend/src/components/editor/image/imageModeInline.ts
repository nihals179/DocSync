import type { ImageWrap } from '../textModel';

export const isInlineWrap = (wrap: ImageWrap) => wrap === 'inline';

export const resolveInlineTextClickOffset = (
  imageStart: number,
  imageEnd: number,
  clickX: number,
  imageMidX: number,
): number => (clickX <= imageMidX ? imageStart : imageEnd);
