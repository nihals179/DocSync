import React from 'react';
import { ToolbarButton } from './ToolbarButton';

const FONT_OPTIONS = ['Raleway', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];

const TEXT_TYPE_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'heading1', label: 'Heading 1' },
  { value: 'heading2', label: 'Heading 2' },
  { value: 'heading3', label: 'Heading 3' },
  { value: 'paragraph', label: 'Paragraph' },
] as const;

export type TextTypeOption = (typeof TEXT_TYPE_OPTIONS)[number]['value'];

type FontControlsProps = {
  selectedTextType: TextTypeOption;
  selectedFont: string;
  fontSize: number;
  onTextTypeChange: (textType: TextTypeOption) => void;
  onFontChange: (fontName: string) => void;
  onFontSizeDecrease: () => void;
  onFontSizeIncrease: () => void;
  onFontSizeInput: (val: string) => void;
  onFontSizeBlur: () => void;
};

/**
 * Font family selector, font size decrease/input/increase controls in one cohesive section.
 */
export const FontControls: React.FC<FontControlsProps> = ({
  selectedTextType,
  selectedFont,
  fontSize,
  onTextTypeChange,
  onFontChange,
  onFontSizeDecrease,
  onFontSizeIncrease,
  onFontSizeInput,
  onFontSizeBlur,
}) => (
  <>
    {/* Text type */}
    <select
      value={selectedTextType}
      onChange={(e) => onTextTypeChange(e.target.value as TextTypeOption)}
      className="h-7 max-w-28 truncate rounded-md border-none bg-transparent pl-2 pr-5 text-xs font-medium text-slate-600 outline-none hover:bg-slate-100 focus:ring-1 focus:ring-cyan-300"
      aria-label="Text Type"
    >
      {TEXT_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>

    {/* Font family */}
    <select
      value={selectedFont}
      onChange={(e) => onFontChange(e.target.value)}
      className="h-7 max-w-28 truncate rounded-md border-none bg-transparent pl-2 pr-5 text-xs font-medium text-slate-600 outline-none hover:bg-slate-100 focus:ring-1 focus:ring-cyan-300"
      aria-label="Font Family"
    >
      {FONT_OPTIONS.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>

    {/* Font size */}
    <div className="flex items-center gap-0.5">
      <ToolbarButton title="Decrease font size" icon="remove" onClick={onFontSizeDecrease} />
      <input
        type="number"
        value={fontSize}
        min={8}
        max={72}
        onChange={(e) => onFontSizeInput(e.target.value)}
        onBlur={onFontSizeBlur}
        className="h-6 w-8 rounded border border-slate-200 bg-white text-center text-xs font-medium text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="Font Size"
      />
      <ToolbarButton title="Increase font size" icon="add" onClick={onFontSizeIncrease} />
    </div>
  </>
);
