import React, { useRef } from 'react';

type ColorPickerProps = {
  textColor: string;
  disabled?: boolean;
  onColorChange: (color: string) => void;
};

/**
 * Text color picker with a hidden input and clickable color preview.
 * Shows current color on the A glyph and as a small underline.
 */
export const ColorPicker: React.FC<ColorPickerProps> = ({ textColor, disabled, onColorChange }) => {
  const textColorInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="group relative inline-flex">
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => {
            if (!disabled) e.preventDefault();
          }}
          onClick={() => {
            if (!disabled) textColorInputRef.current?.click();
          }}
          title="Text Color"
          aria-label="Text Color"
          className={`relative flex h-7 w-7 items-center justify-center rounded transition-colors duration-100 ${
            disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-slate-100'
          }`}
        >
          <span className="text-[18px] font-normal leading-none text-slate-600">A</span>
          <span
            className="absolute bottom-0.5 left-1/2 h-1 w-5.5 -translate-x-1/2 rounded-full"
            style={{ backgroundColor: textColor }}
          />
        </button>
        <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity duration-100 group-hover:opacity-100">
          Text Color
        </span>
      </div>
      <input
        ref={textColorInputRef}
        type="color"
        value={textColor}
        onChange={(e) => onColorChange(e.target.value)}
        className="invisible absolute h-0 w-0"
        tabIndex={-1}
        disabled={disabled}
        aria-label="Text Color"
      />
    </>
  );
};
