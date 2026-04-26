import type { ImageTokenMeta, ImageWrap } from '../textModel';

type ImageAtOffset = Pick<ImageTokenMeta, 'wrap'> & { start: number; end: number };

export const isWrapTextWrap = (wrap: ImageWrap) => wrap === 'wrap';

export const resolveWrapTextInsertOffset = (image: ImageAtOffset): number => {
  // Keep wrap-image token stable while typing around it.
  return image.end;
};

export const resolveWrapTextClickOffset = (
  imageStart: number,
  imageEnd: number,
  clickX: number,
  imageMidX: number,
): number => {
  return clickX < imageMidX ? imageStart : imageEnd;
};
