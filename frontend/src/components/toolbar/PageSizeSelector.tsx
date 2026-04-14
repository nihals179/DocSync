import React from 'react';

type PageSizeSelectorProps = {
  pageSize: 'responsive' | 'A3' | 'A4' | 'A5';
  onPageSizeChange: (size: 'responsive' | 'A3' | 'A4' | 'A5') => void;
};

/**
 * Page size selector dropdown (Responsive, A3, A4, A5).
 */
export const PageSizeSelector: React.FC<PageSizeSelectorProps> = ({
  pageSize,
  onPageSizeChange,
}) => (
  <select
    value={pageSize}
    onChange={(e) => {
      const v = e.target.value;
      if (v === 'A3' || v === 'A4' || v === 'A5') onPageSizeChange(v as 'A3' | 'A4' | 'A5');
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
);
