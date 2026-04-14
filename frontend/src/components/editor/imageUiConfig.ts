import type { ImageWrap } from './textModel';
import type { ResizeHandle } from './types';

export type ImageWrapOption = {
  key: ImageWrap;
  title: string;
  label: string;
};

export type ImageBehaviorOption = {
  key: 'move' | 'fixed';
  label: string;
  description: string;
};

export type ResizeHandleConfig = {
  key: ResizeHandle;
  left: string;
  top: string;
  cursor: string;
};

export const IMAGE_WRAP_OPTIONS: ImageWrapOption[] = [
  { key: 'inline', title: 'In line', label: 'In line' },
  { key: 'break', title: 'Break text', label: 'Break text' },
  { key: 'front', title: 'Text in front of image', label: 'Text in front' },
  { key: 'wrap', title: 'Wrap text', label: 'Wrap text' },
];

export const IMAGE_BEHAVIOR_OPTIONS: ImageBehaviorOption[] = [
  {
    key: 'move',
    label: 'Move with text',
    description: 'Image moves as text is edited.',
  },
  {
    key: 'fixed',
    label: 'Fixed position',
    description: 'Image stays fixed on the page layout.',
  },
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
