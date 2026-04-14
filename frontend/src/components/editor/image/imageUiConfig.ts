import type { ImageWrap } from '../textModel';
import type { ResizeHandle } from '../types';

export type ImageWrapOption = {
  key: ImageWrap;
  title: string;
  label: string;
};

export type ResizeHandleConfig = {
  key: ResizeHandle;
  left: string;
  top: string;
  cursor: string;
};

export const IMAGE_WRAP_OPTIONS: ImageWrapOption[] = [
  { key: 'break', title: 'Break line', label: 'Break line' },
  { key: 'inline', title: 'In line', label: 'In line' },
  { key: 'wrap', title: 'Wrap text', label: 'Wrap text' },
  { key: 'front', title: 'Text in front of image', label: 'Text in front' },
];

export const IMAGE_RESIZE_HANDLES: ResizeHandleConfig[] = [
  { key: 'nw', left: '-6px', top: '-6px', cursor: 'nwse-resize' },
  { key: 'n', left: 'calc(50% - 5px)', top: '-6px', cursor: 'ns-resize' },
  { key: 'ne', left: 'calc(100% - 4px)', top: '-6px', cursor: 'nesw-resize' },
  { key: 'e', left: 'calc(100% - 4px)', top: 'calc(50% - 5px)', cursor: 'ew-resize' },
  { key: 'se', left: 'calc(100% - 4px)', top: 'calc(100% - 4px)', cursor: 'nwse-resize' },
  { key: 's', left: 'calc(50% - 5px)', top: 'calc(100% - 4px)', cursor: 'ns-resize' },
  { key: 'sw', left: '-6px', top: 'calc(100% - 4px)', cursor: 'nesw-resize' },
  { key: 'w', left: '-6px', top: 'calc(50% - 5px)', cursor: 'ew-resize' },
];
