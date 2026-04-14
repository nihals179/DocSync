export type PageSize = 'responsive' | 'A3' | 'A4' | 'A5';

export const PAGE_DIMENSIONS: Record<
  Exclude<PageSize, 'responsive'>,
  { width: string; height: string; widthMm: number }
> = {
  A3: { width: '297mm', height: '420mm', widthMm: 297 },
  A4: { width: '210mm', height: '297mm', widthMm: 210 },
  A5: { width: '148mm', height: '210mm', widthMm: 148 },
};

export const DEFAULT_MARGINS: Record<PageSize, { left: number; right: number }> = {
  responsive: { left: 4, right: 90 },
  A3: { left: 8, right: 92 },
  A4: { left: 12, right: 88 },
  A5: { left: 14, right: 86 },
};
