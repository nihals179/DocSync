// ── Text model ─────────────────────────────────────────────────────────────
import { toRunFmt } from './runFmt';

/** A single contiguous run of text with its own formatting */
export type Run = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  lineSpacing: number;
  fontFamily: string;
  color: string;
  highlightColor: string | null;
};

export type RunFmt = Omit<Run, 'text'>;

export const DEFAULT_RUN_FMT: RunFmt = {
  bold: false,
  italic: false,
  underline: false,
  fontSize: 16,
  lineSpacing: 1.5,
  fontFamily: 'Raleway',
  color: '#1e293b',
  highlightColor: null,
};

export const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function buildFont(size: number, bold: boolean, italic: boolean, family: string): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}, ${FONT_STACK}`;
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
    a.fontSize === b.fontSize &&
    a.lineSpacing === b.lineSpacing &&
    a.fontFamily === b.fontFamily &&
    a.color === b.color &&
    a.highlightColor === b.highlightColor
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
  if ((/[0-9]/.test(marker) || /[a-z]/i.test(marker)) && dot === '.') {
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
export type ImagePosition = 'move' | 'fixed';
export type ImageTokenMeta = {
  src: string;
  widthPct: number;
  align: ImageAlign;
  rotationDeg: number;
  wrap: ImageWrap;
  alt: string;
  position: ImagePosition;
};

const LEGACY_IMAGE_TOKEN_RE = /^\[\[IMAGE:(.+)\]\]$/;
const IMAGE_TOKEN_RE = /^\[\[IMAGE\|(.+)\]\]$/;

function clampImageWidthPct(n: number): number {
  return Math.max(25, Math.min(100, Math.round(n)));
}

function clampImageRotationDeg(n: number): number {
  const normalized = Math.round(Number.isFinite(n) ? n : 0) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function parseImageWrap(value: string | undefined): ImageWrap {
  if (value === 'inline' || value === 'front' || value === 'wrap') return value;
  if (value === 'left' || value === 'right') return 'wrap';
  return 'break';
}

function parseImagePosition(value: string | undefined): ImagePosition {
  return value === 'fixed' ? 'fixed' : 'move';
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
    const position = parseImagePosition(fields.get('pos'));
    let alt = fields.get('alt') ?? '';
    try {
      alt = decodeURIComponent(alt);
    } catch {
      alt = alt.trim();
    }
    if (!decodedSrc) return null;
    return {
      src: decodedSrc,
      widthPct,
      align,
      rotationDeg,
      wrap,
      alt,
      position,
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
      position: 'move',
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
  const position = parseImagePosition(meta.position);
  const alt = encodeURIComponent(meta.alt.trim());
  return `[[IMAGE|src=${src}|w=${widthPct}|a=${meta.align}|rot=${rotationDeg}|wrap=${wrap}|pos=${position}|alt=${alt}]]`;
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
      const bulletChar = getBulletCharForLevel(0, bulletType);
      const prefix = bulletType === 'number' ? `${bulletChar}. ` : `${bulletChar} `;
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
