import type { ImageTokenMeta, ImageWrap } from '../textModel';

type ImageAtOffset = Pick<ImageTokenMeta, 'wrap'> & { start: number; end: number };

export const isBreakLineWrap = (wrap: ImageWrap) => wrap === 'break';

const getBreakTextTopOffset = (text: string, imageStart: number): number => {
  const prevLineBreak = text.lastIndexOf('\n', imageStart - 1);
  return prevLineBreak >= 0 ? prevLineBreak : imageStart;
};

const getBreakTextWriteOffset = (text: string, imageEnd: number): number =>
  text[imageEnd] === '\n' ? imageEnd + 1 : imageEnd;

export const resolveBreakLineInsertOffset = (
  text: string,
  image: ImageAtOffset,
  offset: number,
): number => {
  // Break-line typing is constrained to above or below the image line.
  if (offset === image.start) return getBreakTextTopOffset(text, image.start);
  return getBreakTextWriteOffset(text, image.end);
};

export const resolveBreakLineClickOffset = (
  text: string,
  imageStart: number,
  imageEnd: number,
  clickX: number,
  imageMidX: number,
): number => {
  const topOffset = getBreakTextTopOffset(text, imageStart);
  const writeOffset = getBreakTextWriteOffset(text, imageEnd);
  return clickX <= imageMidX ? topOffset : writeOffset;
};
