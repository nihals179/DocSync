import React, { useRef } from 'react';

type ColorPickerProps = {
  textColor: string;
  onColorChange: (color: string) => void;
};

/**
 * Text color picker with a hidden input and clickable color preview.
 * Shows current color on the A glyph and as a small underline.
 */
export const ColorPicker: React.FC<ColorPickerProps> = ({ textColor, onColorChange }) => {
  const textColorInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => textColorInputRef.current?.click()}
        title="Text Color"
        aria-label="Text Color"
        className="relative flex h-7 w-7 items-center justify-center rounded transition-colors duration-100 hover:bg-slate-100"
      >
        <span className="text-[18px] font-normal leading-none text-slate-600">A</span>
        <span
          className="absolute bottom-0.5 left-1/2 h-1 w-5.5 -translate-x-1/2 rounded-full"
          style={{ backgroundColor: textColor }}
        />
      </button>
      <input
        ref={textColorInputRef}
        type="color"
        value={textColor}
        onChange={(e) => onColorChange(e.target.value)}
        className="invisible absolute h-0 w-0"
        tabIndex={-1}
        aria-label="Text Color"
      />
    </>
  );
};
