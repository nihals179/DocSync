// ── Text model ─────────────────────────────────────────────────────────────
import { toRunFmt } from './runFmt';

/** A single contiguous run of text with its own formatting */
export type Run = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  textAlign?: 'left' | 'center' | 'right';
  fontSize: number;
  lineSpacing: number;
  fontFamily: string;
  color: string;
  highlightColor: string | null;
  /** If set, the run is a hyperlink and will be rendered as <a href> in HTML output */
  href?: string;
};

export type RunFmt = Omit<Run, 'text'>;

export const DEFAULT_RUN_FMT: RunFmt = {
  bold: false,
  italic: false,
  underline: false,
  textAlign: 'left',
  fontSize: 16,
  lineSpacing: 1.5,
  fontFamily: 'Raleway',
  color: '#1e293b',
  highlightColor: null,
  href: undefined,
};

export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function buildFont(size: number, bold: boolean, italic: boolean, family: string): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}, ${FONT_STACK}`;
}

/**
 * Compute visual line height with spacing that is stable across font-size changes.
 * Adds a constant spacing delta independent of font size so spacing controls
 * remain responsive for both small and large text.
 */
export function computeLineHeight(fontSize: number, lineSpacing = 1.5): number {
  const safeFontSize = Math.max(8, Math.round(fontSize));
  const safeSpacing = Math.max(0, Math.min(7, lineSpacing));
  // spacing=1 keeps standard line height near font size,
  // spacing=0 intentionally collapses lines to overlap.
  return Math.max(1, Math.round(safeFontSize * safeSpacing));
}

export function makeRun(text: string, fmt: RunFmt): Run {
  return { text, ...fmt };
}

export function runsToText(runs: Run[]): string {
  return runs.map((r) => r.text).join('');
}

export function formatsEqual(a: RunFmt, b: RunFmt): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    (a.textAlign ?? 'left') === (b.textAlign ?? 'left') &&
    a.fontSize === b.fontSize &&
    a.lineSpacing === b.lineSpacing &&
    a.fontFamily === b.fontFamily &&
    a.color === b.color &&
    a.highlightColor === b.highlightColor &&
    (a.href ?? '') === (b.href ?? '')
  );
}

export function mergeAdjacentRuns(runs: Run[]): Run[] {
  const result: Run[] = [];
  for (const run of runs) {
    const last = result[result.length - 1];
    const fmt: RunFmt = toRunFmt(run);
    const lastFmt: RunFmt = last ? toRunFmt(last) : { ...DEFAULT_RUN_FMT };
    if (last && formatsEqual(lastFmt, fmt)) {
      result[result.length - 1] = { ...last, text: last.text + run.text };
    } else {
      result.push({ ...run });
    }
  }
  return result.length > 0 ? result : [makeRun('', { ...DEFAULT_RUN_FMT })];
}

export function splitRunsAt(runs: Run[], at: number): [Run[], Run[]] {
  const left: Run[] = [];
  const right: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (at <= pos) {
      right.push({ ...run });
    } else if (at >= end) {
      left.push({ ...run });
    } else {
      const splitCol = at - pos;
      left.push({ ...run, text: run.text.slice(0, splitCol) });
      right.push({ ...run, text: run.text.slice(splitCol) });
    }
    pos = end;
  }
  return [left, right];
}

export function deleteRange(runs: Run[], from: number, to: number): Run[] {
  if (from >= to) return runs;
  const result: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (end <= from || pos >= to) {
      if (run.text.length > 0) result.push({ ...run });
    } else {
      const keepLeft = run.text.slice(0, Math.max(0, from - pos));
      const keepRight = run.text.slice(Math.min(run.text.length, to - pos));
      const combined = keepLeft + keepRight;
      if (combined.length > 0) result.push({ ...run, text: combined });
    }
    pos = end;
  }
  return mergeAdjacentRuns(result.length > 0 ? result : [makeRun('', { ...DEFAULT_RUN_FMT })]);
}

export function insertRun(runs: Run[], at: number, insert: Run): Run[] {
  const [left, right] = splitRunsAt(runs, at);
  return mergeAdjacentRuns([...left, insert, ...right]);
}

export function replaceRangeWithRuns(
  runs: Run[],
  from: number,
  to: number,
  inserts: Run[],
): Run[] {
  const safeFrom = Math.max(0, from);
  const safeTo = Math.max(safeFrom, to);
  const withoutRange = safeFrom < safeTo ? deleteRange(runs, safeFrom, safeTo) : [...runs];
  const [left, right] = splitRunsAt(withoutRange, safeFrom);
  const normalizedInserts = inserts.filter((run) => run.text.length > 0).map((run) => ({ ...run }));
  return mergeAdjacentRuns(
    [...left, ...normalizedInserts, ...right].length > 0
      ? [...left, ...normalizedInserts, ...right]
      : [makeRun('', { ...DEFAULT_RUN_FMT })],
  );
}

export function clipboardHtmlToRuns(html: string, baseFmt: RunFmt): Run[] | null {
  if (!html.trim() || typeof DOMParser === 'undefined') return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const root = doc.body;
  if (!root) return null;

  const result: Run[] = [];
  const blockTags = new Set([
    'P',
    'DIV',
    'SECTION',
    'ARTICLE',
    'HEADER',
    'FOOTER',
    'ASIDE',
    'BLOCKQUOTE',
    'PRE',
    'UL',
    'OL',
    'LI',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
  ]);
  const skipTags = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD']);

  const lastChar = () => {
    const lastRun = result[result.length - 1];
    return lastRun && lastRun.text.length > 0 ? lastRun.text[lastRun.text.length - 1] : '';
  };

  const appendText = (text: string, fmt: RunFmt, preserveWhitespace: boolean) => {
    if (!text) return;
    let nextText = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    if (!preserveWhitespace) {
      nextText = nextText.replace(/[\t\f\v ]+/g, ' ');
      nextText = nextText.replace(/ *\n */g, '\n');
    }
    if (!nextText) return;
    result.push(makeRun(nextText, { ...fmt }));
  };

  const appendNewline = (fmt: RunFmt) => {
    if (lastChar() === '\n') return;
    result.push(makeRun('\n', { ...fmt }));
  };

  const parseFontSize = (value: string) => {
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? Math.max(8, Math.min(72, Math.round(numeric))) : null;
  };

  const parseLineSpacing = (value: string, fontSize: number) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === 'normal') return null;

    if (trimmed.endsWith('%')) {
      const percent = Number.parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(percent)
        ? Math.max(0, Math.min(7, Math.round((percent / 100) * 100) / 100))
        : null;
    }

    if (trimmed.endsWith('px')) {
      const px = Number.parseFloat(trimmed.slice(0, -2));
      if (!Number.isFinite(px) || fontSize <= 0) return null;
      return Math.max(0, Math.min(7, Math.round((px / fontSize) * 100) / 100));
    }

    const numeric = Number.parseFloat(trimmed);
    return Number.isFinite(numeric)
      ? Math.max(0, Math.min(7, Math.round(numeric * 100) / 100))
      : null;
  };

  const applyElementFormatting = (element: HTMLElement, currentFmt: RunFmt): RunFmt => {
    const nextFmt: RunFmt = { ...currentFmt };
    const tag = element.tagName.toUpperCase();

    if (tag === 'B' || tag === 'STRONG') nextFmt.bold = true;
    if (tag === 'I' || tag === 'EM') nextFmt.italic = true;
    if (tag === 'U') nextFmt.underline = true;
    if (tag === 'A') {
      const href = element.getAttribute('href')?.trim();
      if (href) {
        nextFmt.href = href;
        nextFmt.underline = true;
        nextFmt.color = '#2563eb';
      }
    }

    const style = element.style;
    const fontWeight = style.fontWeight?.trim().toLowerCase();
    if (fontWeight === 'bold' || fontWeight === 'bolder') nextFmt.bold = true;
    const fontWeightNumber = Number.parseInt(fontWeight ?? '', 10);
    if (Number.isFinite(fontWeightNumber) && fontWeightNumber >= 600) nextFmt.bold = true;
    if (style.fontStyle?.trim().toLowerCase() === 'italic') nextFmt.italic = true;
    if (style.textDecoration?.toLowerCase().includes('underline')) nextFmt.underline = true;
    if (style.color) nextFmt.color = style.color;
    if (style.backgroundColor) nextFmt.highlightColor = style.backgroundColor;
    if (style.textAlign === 'left' || style.textAlign === 'center' || style.textAlign === 'right') {
      nextFmt.textAlign = style.textAlign;
    }
    if (style.fontFamily) {
      nextFmt.fontFamily = style.fontFamily.split(',')[0].replace(/["']/g, '').trim() || nextFmt.fontFamily;
    }
    if (style.fontSize) {
      const fontSize = parseFontSize(style.fontSize);
      if (fontSize !== null) nextFmt.fontSize = fontSize;
    }
    if (style.lineHeight) {
      const lineSpacing = parseLineSpacing(style.lineHeight, nextFmt.fontSize);
      if (lineSpacing !== null) nextFmt.lineSpacing = lineSpacing;
    }

    const faceAttr = element.getAttribute('face')?.trim();
    if (faceAttr) {
      nextFmt.fontFamily = faceAttr.split(',')[0].replace(/["']/g, '').trim() || nextFmt.fontFamily;
    }

    const sizeAttr = element.getAttribute('size')?.trim();
    if (sizeAttr) {
      const fontSize = parseFontSize(sizeAttr);
      if (fontSize !== null) nextFmt.fontSize = fontSize;
    }

    return nextFmt;
  };

  const walk = (node: Node, currentFmt: RunFmt, preserveWhitespace = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? '', currentFmt, preserveWhitespace);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tag = element.tagName.toUpperCase();
    if (skipTags.has(tag)) return;
    if (tag === 'BR') {
      appendNewline(currentFmt);
      return;
    }

    const nextFmt = applyElementFormatting(element, currentFmt);
    const nextPreserveWhitespace = preserveWhitespace || tag === 'PRE';

    if (tag === 'LI') {
      if (result.length > 0 && lastChar() !== '\n') appendNewline(baseFmt);
      appendText('• ', nextFmt, true);
    }

    for (const child of Array.from(element.childNodes)) {
      walk(child, nextFmt, nextPreserveWhitespace);
    }

    if (blockTags.has(tag)) appendNewline(baseFmt);
  };

  for (const child of Array.from(root.childNodes)) {
    walk(child, { ...baseFmt });
  }

  const merged = mergeAdjacentRuns(result);
  const trailing = merged[merged.length - 1];
  if (trailing && trailing.text.endsWith('\n')) {
    trailing.text = trailing.text.replace(/\n+$/g, '');
  }
  return mergeAdjacentRuns(merged.filter((run) => run.text.length > 0));
}

export function applyFormatToRange(
  runs: Run[],
  from: number,
  to: number,
  patch: Partial<RunFmt>,
): Run[] {
  if (from >= to) return runs;
  const result: Run[] = [];
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (end <= from || pos >= to) {
      result.push({ ...run });
    } else {
      if (from > pos) result.push({ ...run, text: run.text.slice(0, from - pos) });
      const iStart = Math.max(pos, from);
      const iEnd = Math.min(end, to);
      if (iEnd > iStart)
        result.push({
          ...run,
          ...patch,
          text: run.text.slice(iStart - pos, iEnd - pos),
        });
      if (to < end) result.push({ ...run, text: run.text.slice(to - pos) });
    }
    pos = end;
  }
  return mergeAdjacentRuns(result.length > 0 ? result : [makeRun('', { ...DEFAULT_RUN_FMT })]);
}

/** Get formatting of the run at (or just before) offset */
export function getFormatAt(runs: Run[], at: number): RunFmt {
  let pos = 0;
  let last: RunFmt = { ...DEFAULT_RUN_FMT };
  for (const run of runs) {
    const fmt: RunFmt = toRunFmt(run);
    if (at <= pos + run.text.length) return fmt;
    pos += run.text.length;
    last = fmt;
  }
  return last;
}

/** Check if all chars in [from, to) have `key` === `value` */
export function isFormatUniform(
  runs: Run[],
  from: number,
  to: number,
  key: 'bold' | 'italic' | 'underline',
  value: boolean,
): boolean {
  if (from >= to) return false;
  let pos = 0;
  for (const run of runs) {
    const end = pos + run.text.length;
    if (end > from && pos < to && run[key] !== value) return false;
    pos = end;
  }
  return true;
}

/** Convert flat offset → {para, col} */
export function offsetToParaCol(text: string, offset: number): { para: number; col: number } {
  const paras = text.split('\n');
  let rem = offset;
  for (let p = 0; p < paras.length; p++) {
    if (rem <= paras[p].length) return { para: p, col: rem };
    rem -= paras[p].length + 1;
  }
  const last = paras.length - 1;
  return { para: last, col: paras[last].length };
}

export function paraColToOffset(text: string, para: number, col: number): number {
  const paras = text.split('\n');
  let off = 0;
  for (let p = 0; p < para && p < paras.length; p++) off += paras[p].length + 1;
  return off + Math.min(col, paras[para]?.length ?? 0);
}

// ── Bullet list ───────────────────────────────────────────────────────────────
const BULLET_CHARS_SET = '•▪▸';

/** Detect bullet prefix in a paragraph string. Returns info about the prefix. */
export function detectBulletPrefix(para: string): {
  hasBullet: boolean;
  prefixLen: number;
  indentLen: number;
  bulletChar: string;
  listType: 'bullet' | 'number' | 'letter' | '';
} {
  let i = 0;
  while (i < para.length && para[i] === ' ') i++;
  const indentLen = i;
  if (i < para.length && BULLET_CHARS_SET.includes(para[i])) {
    const bulletChar = para[i];
    const hasSpace = i + 1 < para.length && para[i + 1] === ' ';
    return {
      hasBullet: true,
      prefixLen: indentLen + 1 + (hasSpace ? 1 : 0),
      indentLen,
      bulletChar,
      listType: 'bullet',
    };
  }

  // Ordered marker: "1. " or "a. "
  const marker = para[i] ?? '';
  const dot = para[i + 1] ?? '';
  const hasSpace = para[i + 2] === ' ';
  if ((/[0-9]/.test(marker) || /[a-z]/i.test(marker)) && dot === '.' && hasSpace) {
    const listType = /[0-9]/.test(marker) ? 'number' : 'letter';
    return {
      hasBullet: true,
      prefixLen: indentLen + 2 + (hasSpace ? 1 : 0),
      indentLen,
      bulletChar: marker,
      listType,
    };
  }

  return {
    hasBullet: false,
    prefixLen: 0,
    indentLen,
    bulletChar: '',
    listType: '',
  };
}

/** Returns true when the paragraph containing `offset` has a bullet prefix */
export function isBulletAtOffset(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', lineStart);
  const para = lineEnd === -1 ? text.slice(lineStart) : text.slice(lineStart, lineEnd);
  return detectBulletPrefix(para).listType === 'bullet';
}

/** Returns true when the paragraph containing `offset` has an ordered prefix (number/letter). */
export function isNumberListAtOffset(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', lineStart);
  const para = lineEnd === -1 ? text.slice(lineStart) : text.slice(lineStart, lineEnd);
  const detected = detectBulletPrefix(para);
  return detected.listType === 'number' || detected.listType === 'letter';
}

/** Returns true if there is a blank line immediately before the current line. */
export function isSpaceBeforeLineAtOffset(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  if (lineStart === 0) return false;
  const prevLineEnd = lineStart - 1;
  const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1;
  return text.slice(prevLineStart, prevLineEnd).length === 0;
}

/** Returns true if there is a blank line immediately after the current line. */
export function isSpaceAfterLineAtOffset(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', lineStart);
  if (lineEnd === -1) return false;
  const nextLineStart = lineEnd + 1;
  const nextLineEnd = text.indexOf('\n', nextLineStart);
  return text.slice(nextLineStart, nextLineEnd === -1 ? text.length : nextLineEnd).length === 0;
}

export type ImageAlign = 'left' | 'center' | 'right';
export type ImageWrap = 'inline' | 'break' | 'front' | 'wrap';
export type ImageTokenMeta = {
  src: string;
  widthPct: number;
  align: ImageAlign;
  rotationDeg: number;
  wrap: ImageWrap;
  alt: string;
  frontOpacityPct: number;
};

export type TableTokenMeta = {
  rows: number;
  columns: number;
  /** Each cell is an array of inline-formatted runs. An empty array means an empty cell. */
  cells: Run[][][];
  cellPaddingPx?: number;
  columnStartPaddingPx?: number[];
  widthPx?: number;
  rowHeightPx?: number;
  columnWidthsPx?: number[];
  rowHeightsPx?: number[];
  tableBorderRadiusPx?: number;
  borderWidth: number;
  borderColor: string | null;
  cellBorders: Record<string, { width: number; color: string | null }>;
  rowBorders: Record<string, { width: number; color: string | null }>;
  columnBorders: Record<string, { width: number; color: string | null }>;
  borderSegments: Record<string, { width: number; color: string | null }>;
  /** @deprecated Legacy field kept only for parsing old documents. Use per-run formatting in `cells` instead. */
  cellFormats?: Record<string, Partial<RunFmt>>;
};

const LEGACY_IMAGE_TOKEN_RE = /^\[\[IMAGE:(.+)\]\]$/;
const IMAGE_TOKEN_RE = /^\[\[IMAGE\|(.+)\]\]$/;
const TABLE_TOKEN_RE = /^\[\[TABLE\|(.+)\]\]$/;
const PAGE_BREAK_TOKEN = '[[PAGE_BREAK]]';

function clampImageWidthPct(n: number): number {
  return Math.max(25, Math.min(100, Math.round(n)));
}

function clampImageRotationDeg(n: number): number {
  const normalized = Math.round(Number.isFinite(n) ? n : 0) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function clampImageFrontOpacityPct(n: number): number {
  const normalized = Math.round(Number.isFinite(n) ? n : 45);
  return Math.max(0, Math.min(100, normalized));
}

function parseImageWrap(value: string | undefined): ImageWrap {
  if (value === 'inline' || value === 'front' || value === 'wrap') return value;
  if (value === 'left' || value === 'right') return 'wrap';
  return 'break';
}

function clampTableBorderWidth(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(8, Math.round(value)));
}

function clampTableBorderRadiusPx(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(24, Math.round(value)));
}

function clampTableWidthPx(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(140, Math.min(2400, Math.round(value)));
}

function clampTableRowHeightPx(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(24, Math.round(value));
}

function clampTableColumnWidthPx(value: number): number {
  if (!Number.isFinite(value)) return 96;
  return Math.max(48, Math.min(960, Math.round(value)));
}

function clampTableCellPaddingPx(value: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.max(2, Math.min(32, Math.round(value)));
}

function clampTableColumnStartPaddingPx(value: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.max(2, Math.min(480, Math.round(value)));
}

function normalizeTableColumnStartPadding(
  values: unknown,
  columns: number,
  fallbackPaddingPx: number,
): number[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const fallback = clampTableColumnStartPaddingPx(fallbackPaddingPx);
  return Array.from({ length: columns }, (_, index) =>
    clampTableColumnStartPaddingPx(Number(values[index] ?? fallback)),
  );
}

function normalizeTableColumnWidths(
  values: unknown,
  columns: number,
  fallbackWidthPx?: number,
): number[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const fallback = clampTableColumnWidthPx(
    fallbackWidthPx === undefined ? 96 : Math.max(48, Math.round(fallbackWidthPx / Math.max(1, columns))),
  );
  return Array.from({ length: columns }, (_, index) =>
    clampTableColumnWidthPx(Number(values[index] ?? fallback)),
  );
}

function normalizeTableRowHeights(
  values: unknown,
  rows: number,
  fallbackRowHeightPx?: number,
): number[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const fallback = clampTableRowHeightPx(fallbackRowHeightPx ?? 30);
  return Array.from({ length: rows }, (_, index) => clampTableRowHeightPx(Number(values[index] ?? fallback)));
}

function parseTableBorderColor(value: string | undefined): string | null {
  if (!value) return '#cbd5e1';
  if (value === 'none') return null;
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.toLowerCase() === 'none') return null;
    return decoded;
  } catch {
    return value.toLowerCase() === 'none' ? null : value;
  }
}

// ── Compact packed-run serialization for table cells ──────────────────────────
/**
 * Compact wire format for a single Run. Only non-default fields are written,
 * keeping the serialized token size small.
 */
type PackedRun = {
  t: string;
  b?: 1;           // bold
  i?: 1;           // italic
  u?: 1;           // underline
  s?: number;      // fontSize (omitted when === 16)
  l?: number;      // lineSpacing (omitted when === 1.5)
  f?: string;      // fontFamily (omitted when === 'Raleway')
  c?: string;      // color (omitted when === '#1e293b')
  h?: string;      // highlightColor (omitted when null)
  a?: 'center' | 'right'; // textAlign (omitted when 'left')
  hr?: string;     // href (omitted when absent)
};

function packRun(run: Run): PackedRun {
  const packed: PackedRun = { t: run.text };
  if (run.bold) packed.b = 1;
  if (run.italic) packed.i = 1;
  if (run.underline) packed.u = 1;
  if (run.fontSize !== DEFAULT_RUN_FMT.fontSize) packed.s = run.fontSize;
  if (run.lineSpacing !== DEFAULT_RUN_FMT.lineSpacing) packed.l = run.lineSpacing;
  if (run.fontFamily !== DEFAULT_RUN_FMT.fontFamily) packed.f = run.fontFamily;
  if (run.color !== DEFAULT_RUN_FMT.color) packed.c = run.color;
  if (run.highlightColor !== null) packed.h = run.highlightColor;
  if (run.textAlign && run.textAlign !== 'left') packed.a = run.textAlign as 'center' | 'right';
  if (run.href) packed.hr = run.href;
  return packed;
}

function unpackRun(packed: unknown): Run | null {
  if (!packed || typeof packed !== 'object' || Array.isArray(packed)) return null;
  const p = packed as Record<string, unknown>;
  if (typeof p.t !== 'string') return null;
  return {
    text: p.t,
    bold: p.b === 1,
    italic: p.i === 1,
    underline: p.u === 1,
    fontSize:
      typeof p.s === 'number' && Number.isFinite(p.s)
        ? Math.max(8, Math.min(72, Math.round(p.s)))
        : DEFAULT_RUN_FMT.fontSize,
    lineSpacing:
      typeof p.l === 'number' && Number.isFinite(p.l)
        ? Math.max(1, Math.min(3, p.l))
        : DEFAULT_RUN_FMT.lineSpacing,
    fontFamily:
      typeof p.f === 'string' && p.f.trim().length > 0 ? p.f.trim() : DEFAULT_RUN_FMT.fontFamily,
    color:
      typeof p.c === 'string' && p.c.trim().length > 0 ? p.c.trim() : DEFAULT_RUN_FMT.color,
    highlightColor: typeof p.h === 'string' ? p.h : null,
    textAlign: p.a === 'center' || p.a === 'right' ? p.a : 'left',
    href: typeof p.hr === 'string' && p.hr.trim().length > 0 ? p.hr.trim() : undefined,
  };
}

/**
 * Update a cell's Run[] to reflect new plain text while preserving formatting.
 * Diffs oldRuns text vs newText, deletes the changed range from runs, and
 * inserts the replacement text inheriting the format at the insertion point.
 */
export function updateCellRunsFromText(oldRuns: Run[], newText: string): Run[] {
  const oldText = runsToText(oldRuns);
  if (oldText === newText) return oldRuns;

  // Common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldText.length &&
    prefixLen < newText.length &&
    oldText[prefixLen] === newText[prefixLen]
  ) {
    prefixLen++;
  }

  // Common suffix (must not overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < oldText.length - prefixLen &&
    suffixLen < newText.length - prefixLen &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteFrom = prefixLen;
  const deleteTo = oldText.length - suffixLen;
  const insertText = newText.slice(prefixLen, newText.length - suffixLen);

  const effectiveRuns = oldRuns.length > 0 ? oldRuns : [makeRun('', { ...DEFAULT_RUN_FMT })];
  const resolveInsertFmt = () => {
    // For pure insertions at a run boundary, prefer the run on the right.
    // This keeps typed text aligned/styled with the visual line at the caret.
    if (deleteFrom === deleteTo) {
      let pos = 0;
      for (const run of effectiveRuns) {
        const end = pos + run.text.length;
        if (deleteFrom === pos || deleteFrom < end) {
          return toRunFmt(run);
        }
        pos = end;
      }
    }
    return getFormatAt(effectiveRuns, deleteFrom);
  };
  const insertFmt = resolveInsertFmt();
  let result: Run[] = deleteFrom < deleteTo ? deleteRange(oldRuns, deleteFrom, deleteTo) : [...oldRuns];
  if (insertText.length > 0) {
    result = insertRun(result, deleteFrom, makeRun(insertText, insertFmt));
  }
  return mergeAdjacentRuns(result.length > 0 ? result : [makeRun('', { ...DEFAULT_RUN_FMT })]);
}

function sanitizeTableCellFormat(value: unknown): Partial<RunFmt> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cast = value as Partial<RunFmt>;
  const next: Partial<RunFmt> = {};
  if (typeof cast.bold === 'boolean') next.bold = cast.bold;
  if (typeof cast.italic === 'boolean') next.italic = cast.italic;
  if (typeof cast.underline === 'boolean') next.underline = cast.underline;
  if (cast.textAlign === 'left' || cast.textAlign === 'center' || cast.textAlign === 'right') {
    next.textAlign = cast.textAlign;
  }
  if (typeof cast.fontFamily === 'string' && cast.fontFamily.trim().length > 0) {
    next.fontFamily = cast.fontFamily;
  }
  if (typeof cast.fontSize === 'number' && Number.isFinite(cast.fontSize)) {
    next.fontSize = Math.max(8, Math.min(72, Math.round(cast.fontSize)));
  }
  if (typeof cast.lineSpacing === 'number' && Number.isFinite(cast.lineSpacing)) {
    next.lineSpacing = Math.max(1, Math.min(3, cast.lineSpacing));
  }
  if (typeof cast.color === 'string' && cast.color.trim().length > 0) {
    next.color = cast.color;
  }
  if (cast.highlightColor === null || typeof cast.highlightColor === 'string') {
    next.highlightColor = cast.highlightColor;
  }
  return Object.keys(next).length > 0 ? next : null;
}

/** Parse image token metadata from paragraph/token text. Supports legacy and v2 tokens. */
export function parseImageToken(value: string): ImageTokenMeta | null {
  const text = value.trim();
  const structured = text.match(IMAGE_TOKEN_RE);
  if (structured) {
    const entries = structured[1]
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
    const fields = new Map<string, string>();
    for (const entry of entries) {
      const eq = entry.indexOf('=');
      if (eq === -1) continue;
      fields.set(entry.slice(0, eq), entry.slice(eq + 1));
    }

    const rawSrc = (fields.get('src') ?? '').trim();
    let decodedSrc = rawSrc;
    try {
      decodedSrc = decodeURIComponent(rawSrc);
    } catch {
      // Keep raw encoded value when malformed; this avoids crashing draw/layout.
      decodedSrc = rawSrc;
    }
    const widthPct = clampImageWidthPct(Number.parseInt(fields.get('w') ?? '40', 10));
    const alignRaw = fields.get('a');
    const rawWrap = fields.get('wrap');
    const normalizedWrap = parseImageWrap(rawWrap);
    const align: ImageAlign =
      alignRaw === 'left' || alignRaw === 'right'
        ? alignRaw
        : rawWrap === 'left' || rawWrap === 'right'
          ? rawWrap
          : 'center';
    const rotationDeg = clampImageRotationDeg(Number.parseInt(fields.get('rot') ?? '0', 10));
    const wrap = normalizedWrap;
    let alt = fields.get('alt') ?? '';
    try {
      alt = decodeURIComponent(alt);
    } catch {
      alt = alt.trim();
    }
    const frontOpacityPct = clampImageFrontOpacityPct(
      Number.parseInt(fields.get('op') ?? fields.get('opacity') ?? '45', 10),
    );
    if (!decodedSrc) return null;
    return {
      src: decodedSrc,
      widthPct,
      align,
      rotationDeg,
      wrap,
      alt,
      frontOpacityPct,
    };
  }

  const legacy = text.match(LEGACY_IMAGE_TOKEN_RE);
  if (legacy) {
    const src = legacy[1].trim();
    if (!src) return null;
    return {
      src,
      widthPct: 100,
      align: 'center',
      rotationDeg: 0,
      wrap: 'break',
      alt: '',
      frontOpacityPct: 45,
    };
  }

  return null;
}

/** Build a stable image token string from metadata. */
export function buildImageToken(meta: ImageTokenMeta): string {
  const src = encodeURIComponent(meta.src.trim());
  const widthPct = clampImageWidthPct(meta.widthPct ?? 40);
  const rotationDeg = clampImageRotationDeg(meta.rotationDeg);
  const wrap = parseImageWrap(meta.wrap);
  const alt = encodeURIComponent(meta.alt.trim());
  const frontOpacityPct = clampImageFrontOpacityPct(meta.frontOpacityPct);
  return `[[IMAGE|src=${src}|w=${widthPct}|a=${meta.align}|rot=${rotationDeg}|wrap=${wrap}|op=${frontOpacityPct}|alt=${alt}]]`;
}

/** Parse table token metadata from token text. */
export function parseTableToken(value: string): TableTokenMeta | null {
  const text = value.trim();
  const match = text.match(TABLE_TOKEN_RE);
  if (!match) return null;

  const entries = match[1]
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  const fields = new Map<string, string>();
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    fields.set(entry.slice(0, eq), entry.slice(eq + 1));
  }

  const rows = Number.parseInt(fields.get('r') ?? '0', 10);
  const columns = Number.parseInt(fields.get('c') ?? '0', 10);
  if (!Number.isFinite(rows) || !Number.isFinite(columns)) return null;

  const safeRows = Math.max(1, Math.min(20, rows));
  const safeColumns = Math.max(1, Math.min(10, columns));
  const rawWidthPx = Number.parseInt(fields.get('tw') ?? '', 10);
  const widthPx = Number.isFinite(rawWidthPx) ? clampTableWidthPx(rawWidthPx) : undefined;
  const rawCellPaddingPx = Number.parseInt(fields.get('cp') ?? '', 10);
  const cellPaddingPx = Number.isFinite(rawCellPaddingPx)
    ? clampTableCellPaddingPx(rawCellPaddingPx)
    : undefined;
  let columnStartPaddingPx: number[] | undefined;
  const rawColumnStartPadding = fields.get('csp') ?? '';
  if (rawColumnStartPadding) {
    try {
      columnStartPaddingPx = normalizeTableColumnStartPadding(
        JSON.parse(decodeURIComponent(rawColumnStartPadding)) as unknown,
        safeColumns,
        cellPaddingPx ?? 8,
      );
    } catch {
      columnStartPaddingPx = undefined;
    }
  }
  const rawRowHeightPx = Number.parseInt(fields.get('rh') ?? '', 10);
  const rowHeightPx = Number.isFinite(rawRowHeightPx)
    ? clampTableRowHeightPx(rawRowHeightPx)
    : undefined;
  const rawTableBorderRadiusPx = Number.parseInt(fields.get('br') ?? '', 10);
  const tableBorderRadiusPx = Number.isFinite(rawTableBorderRadiusPx)
    ? clampTableBorderRadiusPx(rawTableBorderRadiusPx)
    : undefined;
  const borderWidth = clampTableBorderWidth(Number.parseInt(fields.get('bw') ?? '1', 10));
  const borderColor = parseTableBorderColor(fields.get('bc'));
  let columnWidthsPx: number[] | undefined;
  const rawColumnWidths = fields.get('cws') ?? '';
  if (rawColumnWidths) {
    try {
      columnWidthsPx = normalizeTableColumnWidths(
        JSON.parse(decodeURIComponent(rawColumnWidths)) as unknown,
        safeColumns,
        widthPx,
      );
    } catch {
      columnWidthsPx = undefined;
    }
  }

  let rowHeightsPx: number[] | undefined;
  const rawRowHeights = fields.get('rhs') ?? '';
  if (rawRowHeights) {
    try {
      rowHeightsPx = normalizeTableRowHeights(
        JSON.parse(decodeURIComponent(rawRowHeights)) as unknown,
        safeRows,
        rowHeightPx,
      );
    } catch {
      rowHeightsPx = undefined;
    }
  }

  // Parse cell data: detect legacy string[][] vs new PackedRun[][][] format.
  let isLegacyData = false;
  let parsedLegacyStrings: string[][] = [];
  let parsedRunArrays: (Run[])[][] = [];
  const rawData = fields.get('data') ?? '';
  if (rawData) {
    try {
      const decoded = decodeURIComponent(rawData);
      const data = JSON.parse(decoded) as unknown;
      if (Array.isArray(data)) {
        // Detect format: legacy = cells are strings, new = cells are arrays of PackedRun
        const firstCell = (data[0] as unknown[] | undefined)?.[0];
        isLegacyData =
          firstCell === undefined ||
          firstCell === null ||
          typeof firstCell === 'string';

        if (isLegacyData) {
          parsedLegacyStrings = data.map((row) =>
            Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [],
          );
        } else {
          parsedRunArrays = data.map((row) =>
            Array.isArray(row)
              ? row.map((cell) =>
                  Array.isArray(cell)
                    ? cell.map(unpackRun).filter((r): r is Run => r !== null)
                    : [],
                )
              : [],
          );
        }
      }
    } catch {
      isLegacyData = true;
    }
  } else {
    isLegacyData = true;
  }

  const cellBorders: Record<string, { width: number; color: string | null }> = {};
  const rawBorders = fields.get('cb') ?? '';
  if (rawBorders) {
    try {
      const decoded = decodeURIComponent(rawBorders);
      const parsed = JSON.parse(decoded) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const keyMatch = key.match(/^(\d+):(\d+)$/);
          if (!keyMatch) continue;
          const rowIndex = Number.parseInt(keyMatch[1], 10);
          const colIndex = Number.parseInt(keyMatch[2], 10);
          if (
            !Number.isFinite(rowIndex) ||
            !Number.isFinite(colIndex) ||
            rowIndex < 0 ||
            rowIndex >= safeRows ||
            colIndex < 0 ||
            colIndex >= safeColumns
          ) {
            continue;
          }

          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const cast = value as { width?: unknown; color?: unknown; w?: unknown; c?: unknown };
          const widthValue =
            typeof cast.width === 'number'
              ? cast.width
              : typeof cast.w === 'number'
                ? cast.w
                : borderWidth;
          const colorValueRaw =
            typeof cast.color === 'string' || cast.color === null
              ? cast.color
              : typeof cast.c === 'string' || cast.c === null
                ? cast.c
                : borderColor;
          const colorValue =
            colorValueRaw === null
              ? null
              : colorValueRaw === 'none'
                ? null
                : String(colorValueRaw);

          cellBorders[key] = {
            width: clampTableBorderWidth(Number(widthValue)),
            color: colorValue,
          };
        }
      }
    } catch {
      // Ignore malformed per-cell border data.
    }
  }

  const rowBorders: Record<string, { width: number; color: string | null }> = {};
  const rawRowBorders = fields.get('rb') ?? '';
  if (rawRowBorders) {
    try {
      const decoded = decodeURIComponent(rawRowBorders);
      const parsed = JSON.parse(decoded) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index) || index < 0 || index > safeRows) continue;
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const cast = value as { width?: unknown; color?: unknown; w?: unknown; c?: unknown };
          const widthValue =
            typeof cast.width === 'number'
              ? cast.width
              : typeof cast.w === 'number'
                ? cast.w
                : borderWidth;
          const colorValueRaw =
            typeof cast.color === 'string' || cast.color === null
              ? cast.color
              : typeof cast.c === 'string' || cast.c === null
                ? cast.c
                : borderColor;
          rowBorders[key] = {
            width: clampTableBorderWidth(Number(widthValue)),
            color: colorValueRaw === null || colorValueRaw === 'none' ? null : String(colorValueRaw),
          };
        }
      }
    } catch {
      // Ignore malformed row border data.
    }
  }

  const columnBorders: Record<string, { width: number; color: string | null }> = {};
  const rawColumnBorders = fields.get('vb') ?? '';
  if (rawColumnBorders) {
    try {
      const decoded = decodeURIComponent(rawColumnBorders);
      const parsed = JSON.parse(decoded) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const index = Number.parseInt(key, 10);
          if (!Number.isFinite(index) || index < 0 || index > safeColumns) continue;
          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const cast = value as { width?: unknown; color?: unknown; w?: unknown; c?: unknown };
          const widthValue =
            typeof cast.width === 'number'
              ? cast.width
              : typeof cast.w === 'number'
                ? cast.w
                : borderWidth;
          const colorValueRaw =
            typeof cast.color === 'string' || cast.color === null
              ? cast.color
              : typeof cast.c === 'string' || cast.c === null
                ? cast.c
                : borderColor;
          columnBorders[key] = {
            width: clampTableBorderWidth(Number(widthValue)),
            color: colorValueRaw === null || colorValueRaw === 'none' ? null : String(colorValueRaw),
          };
        }
      }
    } catch {
      // Ignore malformed column border data.
    }
  }

  const borderSegments: Record<string, { width: number; color: string | null }> = {};
  const rawBorderSegments = fields.get('bs') ?? '';
  if (rawBorderSegments) {
    try {
      const decoded = decodeURIComponent(rawBorderSegments);
      const parsed = JSON.parse(decoded) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const hMatch = key.match(/^h:(\d+):(\d+)$/);
          const vMatch = key.match(/^v:(\d+):(\d+)$/);
          if (!hMatch && !vMatch) continue;

          const primary = Number.parseInt((hMatch ?? vMatch)![1], 10);
          const secondary = Number.parseInt((hMatch ?? vMatch)![2], 10);
          const valid = hMatch
            ? Number.isFinite(primary) &&
              Number.isFinite(secondary) &&
              primary >= 0 &&
              primary <= safeRows &&
              secondary >= 0 &&
              secondary < safeColumns
            : Number.isFinite(primary) &&
              Number.isFinite(secondary) &&
              primary >= 0 &&
              primary <= safeColumns &&
              secondary >= 0 &&
              secondary < safeRows;
          if (!valid) continue;

          if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
          const cast = value as { width?: unknown; color?: unknown; w?: unknown; c?: unknown };
          const widthValue =
            typeof cast.width === 'number'
              ? cast.width
              : typeof cast.w === 'number'
                ? cast.w
                : borderWidth;
          const colorValueRaw =
            typeof cast.color === 'string' || cast.color === null
              ? cast.color
              : typeof cast.c === 'string' || cast.c === null
                ? cast.c
                : borderColor;
          borderSegments[key] = {
            width: clampTableBorderWidth(Number(widthValue)),
            color: colorValueRaw === null || colorValueRaw === 'none' ? null : String(colorValueRaw),
          };
        }
      }
    } catch {
      // Ignore malformed segment border data.
    }
  }

  // Parse legacy cellFormats (only needed when converting old string-based cells)
  const legacyCellFormats: Record<string, Partial<RunFmt>> = {};
  const rawCellFormats = fields.get('cf') ?? '';
  if (isLegacyData && rawCellFormats) {
    try {
      const decoded = decodeURIComponent(rawCellFormats);
      const parsed = JSON.parse(decoded) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const keyMatch = key.match(/^(\d+):(\d+)$/);
          if (!keyMatch) continue;
          const rowIndex = Number.parseInt(keyMatch[1], 10);
          const colIndex = Number.parseInt(keyMatch[2], 10);
          if (
            !Number.isFinite(rowIndex) ||
            !Number.isFinite(colIndex) ||
            rowIndex < 0 ||
            rowIndex >= safeRows ||
            colIndex < 0 ||
            colIndex >= safeColumns
          ) {
            continue;
          }
          const normalized = sanitizeTableCellFormat(value);
          if (!normalized) continue;
          legacyCellFormats[key] = normalized;
        }
      }
    } catch {
      // Ignore malformed cell format data.
    }
  }

  // Build final cells: Run[][][]
  const cells: Run[][][] = Array.from({ length: safeRows }, (_, rowIndex) =>
    Array.from({ length: safeColumns }, (_, colIndex) => {
      if (isLegacyData) {
        const text = parsedLegacyStrings[rowIndex]?.[colIndex] ?? '';
        if (!text) return [];
        const fmt: RunFmt = {
          ...DEFAULT_RUN_FMT,
          ...(legacyCellFormats[`${rowIndex}:${colIndex}`] ?? {}),
        };
        return [makeRun(text, fmt)];
      }
      return parsedRunArrays[rowIndex]?.[colIndex] ?? [];
    }),
  );

  return {
    rows: safeRows,
    columns: safeColumns,
    cells,
    cellPaddingPx,
    columnStartPaddingPx,
    widthPx,
    rowHeightPx,
    columnWidthsPx,
    rowHeightsPx,
    tableBorderRadiusPx,
    borderWidth,
    borderColor,
    cellBorders,
    rowBorders,
    columnBorders,
    borderSegments,
  };
}

/** Build a stable table token string from metadata. */
export function buildTableToken(meta: TableTokenMeta): string {
  const rows = Math.max(1, Math.min(20, Math.round(meta.rows)));
  const columns = Math.max(1, Math.min(10, Math.round(meta.columns)));
  const cellPaddingPx =
    meta.cellPaddingPx === undefined ? undefined : clampTableCellPaddingPx(meta.cellPaddingPx);
  const columnStartPaddingPx = Array.isArray(meta.columnStartPaddingPx)
    ? Array.from({ length: columns }, (_, index) =>
        clampTableColumnStartPaddingPx(Number(meta.columnStartPaddingPx?.[index] ?? cellPaddingPx ?? 8)),
      )
    : undefined;
  const widthPx = meta.widthPx === undefined ? undefined : clampTableWidthPx(meta.widthPx);
  const rowHeightPx =
    meta.rowHeightPx === undefined ? undefined : clampTableRowHeightPx(meta.rowHeightPx);
  const columnWidthsPx = Array.isArray(meta.columnWidthsPx)
    ? Array.from({ length: columns }, (_, index) =>
        clampTableColumnWidthPx(Number(meta.columnWidthsPx?.[index] ?? 96)),
      )
    : undefined;
  const rowHeightsPx = Array.isArray(meta.rowHeightsPx)
    ? Array.from({ length: rows }, (_, index) =>
        clampTableRowHeightPx(Number(meta.rowHeightsPx?.[index] ?? rowHeightPx ?? 30)),
      )
    : undefined;
  const tableBorderRadiusPx =
    meta.tableBorderRadiusPx === undefined
      ? undefined
      : clampTableBorderRadiusPx(meta.tableBorderRadiusPx);
  const borderWidth = clampTableBorderWidth(meta.borderWidth);
  const borderColor = meta.borderColor;
  const cells = Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, colIndex) => {
      const cellRuns = meta.cells?.[rowIndex]?.[colIndex] ?? [];
      return cellRuns.map(packRun);
    }),
  );
  const cellBorders: Record<string, { width: number; color: string | null }> = {};
  for (const [key, value] of Object.entries(meta.cellBorders ?? {})) {
    const keyMatch = key.match(/^(\d+):(\d+)$/);
    if (!keyMatch) continue;
    const rowIndex = Number.parseInt(keyMatch[1], 10);
    const colIndex = Number.parseInt(keyMatch[2], 10);
    if (
      !Number.isFinite(rowIndex) ||
      !Number.isFinite(colIndex) ||
      rowIndex < 0 ||
      rowIndex >= rows ||
      colIndex < 0 ||
      colIndex >= columns
    ) {
      continue;
    }
    cellBorders[key] = {
      width: clampTableBorderWidth(value?.width ?? borderWidth),
      color: value?.color ?? borderColor,
    };
  }
  const rowBorders: Record<string, { width: number; color: string | null }> = {};
  for (const [key, value] of Object.entries(meta.rowBorders ?? {})) {
    const index = Number.parseInt(key, 10);
    if (!Number.isFinite(index) || index < 0 || index > rows) continue;
    rowBorders[key] = {
      width: clampTableBorderWidth(value?.width ?? borderWidth),
      color: value?.color ?? borderColor,
    };
  }
  const columnBorders: Record<string, { width: number; color: string | null }> = {};
  for (const [key, value] of Object.entries(meta.columnBorders ?? {})) {
    const index = Number.parseInt(key, 10);
    if (!Number.isFinite(index) || index < 0 || index > columns) continue;
    columnBorders[key] = {
      width: clampTableBorderWidth(value?.width ?? borderWidth),
      color: value?.color ?? borderColor,
    };
  }
  const borderSegments: Record<string, { width: number; color: string | null }> = {};
  for (const [key, value] of Object.entries(meta.borderSegments ?? {})) {
    const hMatch = key.match(/^h:(\d+):(\d+)$/);
    const vMatch = key.match(/^v:(\d+):(\d+)$/);
    if (!hMatch && !vMatch) continue;
    const primary = Number.parseInt((hMatch ?? vMatch)![1], 10);
    const secondary = Number.parseInt((hMatch ?? vMatch)![2], 10);
    const valid = hMatch
      ? Number.isFinite(primary) &&
        Number.isFinite(secondary) &&
        primary >= 0 &&
        primary <= rows &&
        secondary >= 0 &&
        secondary < columns
      : Number.isFinite(primary) &&
        Number.isFinite(secondary) &&
        primary >= 0 &&
        primary <= columns &&
        secondary >= 0 &&
        secondary < rows;
    if (!valid) continue;
    borderSegments[key] = {
      width: clampTableBorderWidth(value?.width ?? borderWidth),
      color: value?.color ?? borderColor,
    };
  }
  const data = encodeURIComponent(JSON.stringify(cells));
  const encodedColor = borderColor === null ? 'none' : encodeURIComponent(borderColor);
  const encodedCellBorders = encodeURIComponent(JSON.stringify(cellBorders));
  const encodedRowBorders = encodeURIComponent(JSON.stringify(rowBorders));
  const encodedColumnBorders = encodeURIComponent(JSON.stringify(columnBorders));
  const encodedBorderSegments = encodeURIComponent(JSON.stringify(borderSegments));
  const sizeParts = [
    widthPx === undefined ? null : `tw=${widthPx}`,
    cellPaddingPx === undefined ? null : `cp=${cellPaddingPx}`,
    columnStartPaddingPx === undefined
      ? null
      : `csp=${encodeURIComponent(JSON.stringify(columnStartPaddingPx))}`,
    rowHeightPx === undefined ? null : `rh=${rowHeightPx}`,
    columnWidthsPx === undefined ? null : `cws=${encodeURIComponent(JSON.stringify(columnWidthsPx))}`,
    rowHeightsPx === undefined ? null : `rhs=${encodeURIComponent(JSON.stringify(rowHeightsPx))}`,
    tableBorderRadiusPx === undefined ? null : `br=${tableBorderRadiusPx}`,
  ]
    .filter(Boolean)
    .join('|');
  return `[[TABLE|r=${rows}|c=${columns}${sizeParts ? `|${sizeParts}` : ''}|bw=${borderWidth}|bc=${encodedColor}|data=${data}|cb=${encodedCellBorders}|rb=${encodedRowBorders}|vb=${encodedColumnBorders}|bs=${encodedBorderSegments}]]`;
}

/** Parse an explicit page break token. */
export function parsePageBreakToken(value: string): { token: string } | null {
  return value.trim() === PAGE_BREAK_TOKEN ? { token: PAGE_BREAK_TOKEN } : null;
}

/** Build a stable page break token string. */
export function buildPageBreakToken(): string {
  return PAGE_BREAK_TOKEN;
}

/** Returns absolute [start,end) ranges for all page break tokens in the flat text. */
export function getPageBreakTokenRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf(PAGE_BREAK_TOKEN, searchFrom);
    if (start === -1) break;
    const end = start + PAGE_BREAK_TOKEN.length;
    ranges.push({ start, end });
    searchFrom = end;
  }
  return ranges;
}

/** Returns absolute [start,end) ranges for all table tokens in the flat text. */
export function getTableTokenRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const tokenRe = /\[\[TABLE\|[^\]]+\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (parseTableToken(match[0])) ranges.push({ start, end });
  }
  return ranges;
}

/** Returns absolute [start,end) ranges for all image tokens in the flat text. */
export function getImageTokenRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const tokenRe = /\[\[IMAGE\|[^\]]+\]\]|\[\[IMAGE:[^\]]+\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (parseImageToken(match[0])) {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

/** Returns absolute [start,end) ranges for all atomic non-text tokens. */
export function getAtomicTokenRanges(text: string): Array<{ start: number; end: number }> {
  return [...getImageTokenRanges(text), ...getTableTokenRanges(text), ...getPageBreakTokenRanges(text)].sort(
    (a, b) => a.start - b.start,
  );
}

/** Get the table token at/around the given cursor offset. */
export function getTableTokenAtOffset(
  text: string,
  offset: number,
): ({ start: number; end: number } & TableTokenMeta) | null {
  for (const r of getTableTokenRanges(text)) {
    if (offset === r.start || offset === r.end || (offset > r.start && offset < r.end)) {
      const token = text.slice(r.start, r.end);
      const parsed = parseTableToken(token);
      if (parsed) return { ...parsed, start: r.start, end: r.end };
    }
  }
  return null;
}

/** Get the image token at/around the given cursor offset. */
export function getImageTokenAtOffset(
  text: string,
  offset: number,
): ({ start: number; end: number } & ImageTokenMeta) | null {
  for (const r of getImageTokenRanges(text)) {
    if (offset === r.start || offset === r.end || (offset > r.start && offset < r.end)) {
      const token = text.slice(r.start, r.end);
      const parsed = parseImageToken(token);
      if (parsed) return { ...parsed, start: r.start, end: r.end };
    }
  }
  return null;
}

/**
 * Toggle bullet list for every paragraph touched by the cursor / selection.
 * If ALL touched paragraphs already have a bullet prefix, removes it; otherwise adds it.
 * Uses indent-aware bullet formatting.
 */
export function toggleBulletRange(
  runs: Run[],
  selF: number,
  selT: number,
  fallbackFmt: RunFmt,
  bulletType: BulletType = 'bullet',
): { newRuns: Run[]; cursorDelta: (cursor: number) => number } {
  const text = runsToText(runs);
  const paras = text.split('\n');

  const touched: Array<{ pi: number; pStart: number }> = [];
  let off = 0;
  for (let pi = 0; pi < paras.length; pi++) {
    const pEnd = off + paras[pi].length;
    const overlaps = selF === selT ? selF >= off && selF <= pEnd : pEnd >= selF && off < selT;
    if (overlaps) touched.push({ pi, pStart: off });
    off += paras[pi].length + 1;
  }

  if (touched.length === 0) return { newRuns: runs, cursorDelta: () => 0 };

  // Check if all touched paragraphs already have bullets
  const removeMode = touched.every(({ pi }) => detectBulletPrefix(paras[pi]).hasBullet);

  let result = runs;
  const changes: Array<{ pos: number; delta: number }> = [];

  // For ordered lists, pre-compute sequential markers in forward order
  const seqMarker: string[] = new Array(touched.length).fill('');
  if (!removeMode && (bulletType === 'number' || bulletType === 'letter')) {
    let seq = 0;
    for (let i = 0; i < touched.length; i++) {
      if (!detectBulletPrefix(paras[touched[i].pi]).hasBullet) {
        seq++;
        seqMarker[i] =
          bulletType === 'number'
            ? String(seq)
            : String.fromCharCode('a'.charCodeAt(0) + Math.min(25, seq - 1));
      }
    }
  }

  // Process in reverse so earlier offsets stay valid
  for (let i = touched.length - 1; i >= 0; i--) {
    const { pi, pStart } = touched[i];
    const detected = detectBulletPrefix(paras[pi]);

    if (removeMode) {
      // Remove the entire bullet prefix (indent + bullet char + space)
      if (detected.hasBullet && detected.prefixLen > 0) {
        result = deleteRange(result, pStart, pStart + detected.prefixLen);
        changes.push({ pos: pStart, delta: -detected.prefixLen });
      }
    } else if (!detected.hasBullet) {
      // Add bullet prefix
      let prefix: string;
      if (bulletType === 'number' || bulletType === 'letter') {
        prefix = `${seqMarker[i]}. `;
      } else {
        const bulletChar = getBulletCharForLevel(0, bulletType);
        prefix = `${bulletChar} `;
      }
      const fmt = paras[pi].length > 0 ? getFormatAt(runs, pStart) : { ...fallbackFmt };
      result = insertRun(result, pStart, makeRun(prefix, { ...fmt }));
      changes.push({ pos: pStart, delta: prefix.length });
    }
  }

  const cursorDelta = (cursor: number): number => {
    let delta = 0;
    for (const change of changes) {
      if (change.pos <= cursor) delta += change.delta;
    }
    return delta;
  };

  return { newRuns: result, cursorDelta };
}

// ── Indentation & Bullet Types ────────────────────────────────────────────────
const BULLET_CHARS = ['•', '▪', '▸']; // 3 levels: circle, square, triangle

export type BulletType = 'bullet' | 'number' | 'letter';

export function getOrderedMarkerForLevel(level: number): string {
  if (level <= 0) return '1';
  if (level === 1) return 'a';
  return 'i';
}

/** Get bullet character for given indent level and type */
export function getBulletCharForLevel(level: number, bulletType: BulletType = 'bullet'): string {
  if (bulletType === 'bullet') return BULLET_CHARS[level % BULLET_CHARS.length];
  if (bulletType === 'number') return getOrderedMarkerForLevel(level);
  return '•';
}
