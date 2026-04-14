import type { ImageWrap, RunFmt } from './textModel';

export type CursorFormat = RunFmt & {
  bullet: boolean;
  numberList: boolean;
  hasSpaceBeforeLine: boolean;
  hasSpaceAfterLine: boolean;
  imageSelected: boolean;
  imagePanelOpen: boolean;
  imageAlign: 'left' | 'center' | 'right';
  imageWidthPct: number;
};

export type RichEditorHandle = {
  getContent: () => string;
  setContent: (html: string) => void;
  getFontSize: () => number;
  setFontSize: (n: number) => void;
  toggleBold: () => void;
  getBold: () => boolean;
  toggleItalic: () => void;
  getItalic: () => boolean;
  toggleUnderline: () => void;
  getUnderline: () => boolean;
  getFontFamily: () => string;
  setFontFamily: (f: string) => void;
  getTextColor: () => string;
  setTextColor: (c: string) => void;
  focus: () => void;
  toggleBullet: () => void;
  toggleNumberList: () => void;
  indentLeft: () => void;
  indentRight: () => void;
  setLineSpacing: (n: number) => void;
  toggleHighlight: () => void;
  setHighlightColor: (color: string | null) => void;
  insertLink: (url: string) => void;
  insertImage: (url: string) => void;
  setImageAlign: (align: 'left' | 'center' | 'right') => void;
  setImageWidthPct: (widthPct: number) => void;
  setImageRotationDeg: (rotationDeg: number) => void;
  setImageWrap: (wrap: ImageWrap) => void;
  setImageAltText: (alt: string) => void;
  toggleImagePanel: () => void;
  openImagePanel: () => void;
  closeImagePanel: () => void;
  toggleSpaceBeforeLine: () => void;
  toggleSpaceAfterLine: () => void;
  undo: () => void;
  redo: () => void;
};

export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
