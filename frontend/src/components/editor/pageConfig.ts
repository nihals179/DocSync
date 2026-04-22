export type PageSize = 'responsive' | 'A3' | 'A4' | 'A5';

export const PAGE_SIZE_OPTIONS: readonly PageSize[] = ['responsive', 'A3', 'A4', 'A5'] as const;

export function isPageSize(value: string): value is PageSize {
  return PAGE_SIZE_OPTIONS.includes(value as PageSize);
}

export const PAGE_DIMENSIONS: Record<
  Exclude<PageSize, 'responsive'>,
  { width: string; height: string; widthMm: number; heightMm: number }
> = {
  A3: { width: '297mm', height: '420mm', widthMm: 297, heightMm: 420 },
  A4: { width: '210mm', height: '297mm', widthMm: 210, heightMm: 297 },
  A5: { width: '148mm', height: '210mm', widthMm: 148, heightMm: 210 },
};

export const DEFAULT_MARGINS: Record<PageSize, { left: number; right: number }> = {
  responsive: { left: 4, right: 90 },
  A3: { left: 8, right: 92 },
  A4: { left: 12, right: 88 },
  A5: { left: 14, right: 86 },
};

// Standard document margins used for paper page layouts.
export const STANDARD_PAPER_TOP_MARGIN_MM = 22;
export const STANDARD_PAPER_BOTTOM_MARGIN_MM = 48;
