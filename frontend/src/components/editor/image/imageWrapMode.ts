import type { ImageTokenMeta, ImageWrap } from '../textModel';
import {
  isBreakLineWrap,
  resolveBreakLineClickOffset,
  resolveBreakLineInsertOffset,
} from './imageModeBreak';
import { isInlineWrap, resolveInlineTextClickOffset } from './imageModeInline';
import { isTextInFrontWrap } from './imageModeFront';
import { isWrapTextWrap, resolveWrapTextClickOffset, resolveWrapTextInsertOffset } from './imageModeWrap';

type ImageAtOffset = Pick<ImageTokenMeta, 'wrap'> & { start: number; end: number };

export { isBreakLineWrap, isInlineWrap, isTextInFrontWrap, isWrapTextWrap };

export const isFlowingImageWrap = (wrap: ImageWrap) =>
  isInlineWrap(wrap) || isBreakLineWrap(wrap) || isWrapTextWrap(wrap);

export const isBlockImageParagraphWrap = (wrap: ImageWrap) =>
  isBreakLineWrap(wrap);

export const getWrapAnchorOffset = (
  wrap: ImageWrap,
  image: { start: number; end: number },
): number => (isBreakLineWrap(wrap) || isTextInFrontWrap(wrap) ? image.end : image.start);

export const resolveImageClickOffsetByWrap = ({
  wrap,
  text,
  imageStart,
  imageEnd,
  clickX,
  imageMidX,
}: {
  wrap: ImageWrap;
  text: string;
  imageStart: number;
  imageEnd: number;
  clickX: number;
  imageMidX: number;
}): number => {
  if (isBreakLineWrap(wrap)) {
    return resolveBreakLineClickOffset(text, imageStart, imageEnd, clickX, imageMidX);
  }
  if (isWrapTextWrap(wrap)) {
    return resolveWrapTextClickOffset(imageEnd);
  }
  if (isTextInFrontWrap(wrap)) {
    // Keep writing after the token so text renders over the image layer.
    return imageEnd;
  }
  return resolveInlineTextClickOffset(imageStart, imageEnd, clickX, imageMidX);
};

export function resolveInsertOffsetForWrapMode(
  text: string,
  image: ImageAtOffset | null,
  offset: number,
): number {
  if (!image) return offset;
  if (isBreakLineWrap(image.wrap)) return resolveBreakLineInsertOffset(text, image, offset);
  if (isWrapTextWrap(image.wrap)) return resolveWrapTextInsertOffset(image);
  if (isTextInFrontWrap(image.wrap)) return image.end;
  return offset;
}