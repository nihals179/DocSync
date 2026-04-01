

import { useRef, useState } from 'react';
import type { RichEditorHandle } from './RichEditor';

type ToolbarProps = {
  editorRef: React.RefObject<RichEditorHandle | null>;
  pageSize: 'responsive' | 'A3' | 'A4' | 'A5';
  onPageSizeChange: (size: 'responsive' | 'A3' | 'A4' | 'A5') => void;
};

const FONT_OPTIONS = ['Raleway', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];

const Divider = () => <div className="mx-0.5 hidden h-5 w-px bg-slate-200 sm:block" />;

type BtnProps = {
  title: string;
  icon: string;
  active?: boolean;
  onClick: () => void;
};

const Btn: React.FC<BtnProps> = ({ title, icon, active, onClick }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`flex h-7 w-7 items-center justify-center rounded transition-colors duration-100 ${
      active
        ? 'bg-cyan-50 text-cyan-700'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
    }`}
  >
    <span className="material-icons" style={{ fontSize: 18 }}>{icon}</span>
  </button>
);

const Toolbar: React.FC<ToolbarProps> = ({ editorRef, pageSize, onPageSizeChange }) => {
  const [, forceUpdate] = useState(0);
  const rerender = () => forceUpdate((n) => n + 1);

  const handle = editorRef.current;

  const [selectedFont, setSelectedFont] = useState(FONT_OPTIONS[0]);
  const [textColor, setTextColor] = useState('#1e293b');
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const [fontSize, setFontSize] = useState(16);

  const changeFont = (fontName: string) => {
    setSelectedFont(fontName);
    handle?.setFontFamily(fontName);
  };

  const adjustFontSize = (delta: number) => {
    const current = handle?.getFontSize() ?? fontSize;
    const next = Math.max(8, Math.min(72, current + delta));
    setFontSize(next);
    handle?.setFontSize(next);
  };

  const handleFontSizeInput = (val: string) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 8 && n <= 72) {
      setFontSize(n);
      handle?.setFontSize(n);
    }
  };

  const applyTextColor = (color: string) => {
    setTextColor(color);
    handle?.setTextColor(color);
  };

  const toggleBold = () => { handle?.toggleBold(); rerender(); };
  const toggleItalic = () => { handle?.toggleItalic(); rerender(); };
  const toggleUnderline = () => { handle?.toggleUnderline(); rerender(); };

  return (
    <div className="sticky top-0 z-10 mt-2 mb-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1 shadow-sm backdrop-blur-md">
      <div className="flex items-center gap-0.5">
        {/* Page size */}
        <select
          value={pageSize}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'A3' || v === 'A4' || v === 'A5') onPageSizeChange(v as any);
            else onPageSizeChange('responsive');
          }}
          className="h-7 rounded-md border-none bg-transparent pl-2 pr-6 text-xs font-medium text-slate-600 outline-none hover:bg-slate-100 focus:ring-1 focus:ring-cyan-300"
          aria-label="Page size"
        >
          <option value="responsive">Responsive</option>
          <option value="A3">A3</option>
          <option value="A4">A4</option>
          <option value="A5">A5</option>
        </select>

        <Divider />

        {/* Font family */}
        <select
          value={selectedFont}
          onChange={(e) => changeFont(e.target.value)}
          className="h-7 max-w-28 truncate rounded-md border-none bg-transparent pl-2 pr-5 text-xs font-medium text-slate-600 outline-none hover:bg-slate-100 focus:ring-1 focus:ring-cyan-300"
          aria-label="Font Family"
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font} value={font}>{font}</option>
          ))}
        </select>

        <Divider />

        {/* Font size group */}
        <Btn title="Decrease font size" icon="remove" onClick={() => adjustFontSize(-1)} />
        <input
          type="number"
          value={fontSize}
          min={8}
          max={72}
          onChange={(e) => handleFontSizeInput(e.target.value)}
          className="h-6 w-8 rounded border border-slate-200 bg-white text-center text-xs font-medium text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label="Font Size"
        />
        <Btn title="Increase font size" icon="add" onClick={() => adjustFontSize(1)} />

        <Divider />

        {/* Formatting */}
        <Btn title="Bold (⌘B)" icon="format_bold" active={handle?.getBold()} onClick={toggleBold} />
        <Btn title="Italic (⌘I)" icon="format_italic" active={handle?.getItalic()} onClick={toggleItalic} />
        <Btn title="Underline (⌘U)" icon="format_underlined" active={handle?.getUnderline()} onClick={toggleUnderline} />

        {/* Text color */}
        <button
          type="button"
          onClick={() => textColorInputRef.current?.click()}
          title="Text Color"
          aria-label="Text Color"
          className="relative flex h-7 w-7 items-center justify-center rounded text-slate-600 transition-colors duration-100 hover:bg-slate-100"
        >
          <span className="material-icons" style={{ fontSize: 18 }}>format_color_text</span>
          <span className="absolute bottom-0.5 left-1/2 h-0.5 w-3.5 -translate-x-1/2 rounded-full" style={{ backgroundColor: textColor }} />
        </button>
        <input
          ref={textColorInputRef}
          type="color"
          value={textColor}
          onChange={(e) => applyTextColor(e.target.value)}
          className="invisible absolute h-0 w-0"
          tabIndex={-1}
          aria-label="Text Color"
        />
      </div>
    </div>
  );
};

export default Toolbar;
