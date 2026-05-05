import { DEFAULT_RUN_FMT, FONT_STACK, buildTableToken, detectBulletPrefix, parseImageToken, parseTableToken, runsToText, type Run } from '../components/editor/textModel';

const TABLE_PLACEHOLDER_PREFIX = '__DOCSYNC_TABLE_BLOCK_';

function decodeHtmlEntities(value: string): string {
  if (!value) return '';
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceDocsyncHtmlTokens(value: string): string {
  const withTables = value.replace(
    /<div\b[^>]*data-docsync-table-token="([^"]+)"[^>]*>[\s\S]*?<\/div>/gi,
    (_match, encodedToken: string) => `\n\n${decodeUriComponentSafe(encodedToken)}\n\n`,
  );

  return withTables.replace(
    /<img\b[^>]*data-docsync-token-source="([^"]+)"[^>]*>/gi,
    (_match, encodedToken: string) => decodeUriComponentSafe(encodedToken),
  );
}

function renderImageToken(token: string): string {
  const image = parseImageToken(token);
  if (!image) return escapeHtml(token);

  const align = image.align ?? 'left';
  const widthPct = Math.max(1, Math.min(100, image.widthPct ?? 100));
  const rotationDeg = Number.isFinite(image.rotationDeg) ? image.rotationDeg : 0;
  const tokenAttr = encodeURIComponent(token);
  const alt = escapeHtml(image.alt ?? '');
  const src = escapeHtml(image.src);
  const imgStyle = [
    `max-width:${widthPct}%`,
    'height:auto',
    rotationDeg !== 0 ? `transform:rotate(${rotationDeg}deg)` : '',
  ]
    .filter(Boolean)
    .join('; ');

  if (image.wrap === 'inline') {
    return `<img src="${src}" alt="${alt}" data-docsync-token-source="${tokenAttr}" style="${imgStyle}; vertical-align:middle;" />`;
  }

  return `<div style="text-align:${align}; margin:8px 0;"><img src="${src}" alt="${alt}" data-docsync-token-source="${tokenAttr}" style="${imgStyle};" /></div>`;
}

function renderInlineTextWithImageTokens(value: string): string {
  if (!value) return '';
  let out = '';
  let cursor = 0;

  while (cursor < value.length) {
    const open = value.indexOf('[[', cursor);
    if (open === -1) {
      out += escapeHtml(value.slice(cursor));
      break;
    }

    if (open > cursor) {
      out += escapeHtml(value.slice(cursor, open));
    }

    const close = value.indexOf(']]', open);
    if (close === -1) {
      out += escapeHtml(value.slice(open));
      break;
    }

    const token = value.slice(open, close + 2);
    if (parseImageToken(token)) {
      out += renderImageToken(token);
    } else {
      out += escapeHtml(token);
    }
    cursor = close + 2;
  }

  return out;
}

function renderTableToken(token: string): string {
  const table = parseTableToken(token);
  if (!table) return `<p>${escapeHtml(token)}</p>`;

  const tableAttr = encodeURIComponent(token);
  const borderWidth = Math.max(0, table.borderWidth ?? 1);
  const borderColor = table.borderColor ?? '#cbd5e1';
  const tableStyle = [
    'width:100%',
    'border-collapse:collapse',
    borderWidth > 0 && borderColor ? `border:${borderWidth}px solid ${borderColor}` : 'border:none',
    'margin:8px 0',
  ].join('; ');

  const rows = Array.from({ length: table.rows }, (_, rowIndex) => {
    const cells = Array.from({ length: table.columns }, (_, colIndex) => {
      const cellRuns = table.cells?.[rowIndex]?.[colIndex] ?? [];
      const primaryFmt = cellRuns[0] ? { ...DEFAULT_RUN_FMT, ...cellRuns[0] } : { ...DEFAULT_RUN_FMT };
      const style = [
        borderWidth > 0 && borderColor ? `border:${borderWidth}px solid ${borderColor}` : 'border:none',
        'padding:6px 8px',
        `text-align:${primaryFmt.textAlign ?? 'left'}`,
        `line-height:${primaryFmt.lineSpacing ?? 1.5}`,
      ].join('; ');

      const raw = runsToText(cellRuns);
      const cellHtml = cellRuns.length > 0
        ? cellRuns
            .map((run) => {
              const runStyle = [
                `font-family:${run.fontFamily}, ${FONT_STACK}`,
                `font-size:${run.fontSize}px`,
                `color:${run.color}`,
                `font-weight:${run.bold ? 700 : 400}`,
                `font-style:${run.italic ? 'italic' : 'normal'}`,
                `text-decoration:${run.underline ? 'underline' : 'none'}`,
                run.highlightColor ? `background-color:${run.highlightColor}` : '',
              ]
                .filter(Boolean)
                .join('; ');
              const runText = renderInlineTextWithImageTokens(run.text).replace(/\n/g, '<br/>');
              return `<span style="${runStyle}">${runText}</span>`;
            })
            .join('')
        : renderInlineTextWithImageTokens(raw).replace(/\n/g, '<br/>');

      return `<td style="${style}">${cellHtml || '&nbsp;'}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<div data-docsync-table-token="${tableAttr}"><table style="${tableStyle}"><tbody>${rows}</tbody></table></div>`;
}

function replaceTableTokensWithPlaceholders(text: string): { normalized: string; tables: string[] } {
  let normalized = '';
  const tables: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf('[[', cursor);
    if (open === -1) {
      normalized += text.slice(cursor);
      break;
    }

    normalized += text.slice(cursor, open);
    const close = text.indexOf(']]', open);
    if (close === -1) {
      normalized += text.slice(open);
      break;
    }

    const token = text.slice(open, close + 2);
    if (parseTableToken(token)) {
      const idx = tables.length;
      tables.push(renderTableToken(token));
      normalized += `\n\n${TABLE_PLACEHOLDER_PREFIX}${idx}__\n\n`;
    } else {
      normalized += token;
    }
    cursor = close + 2;
  }

  return { normalized, tables };
}

export function htmlToCanvasText(value: string): string {
  if (!value) return '';
  const withDocsyncTokens = replaceDocsyncHtmlTokens(value);
  return decodeHtmlEntities(
    withDocsyncTokens
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function canvasTextToHtml(value: string): string {
  const normalizedInput = value.replace(/\r\n/g, '\n').trim();
  if (!normalizedInput) return '';

  const { normalized, tables } = replaceTableTokensWithPlaceholders(normalizedInput);
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const tableMatch = block.match(new RegExp(`^${TABLE_PLACEHOLDER_PREFIX}(\\d+)__$`));
      if (tableMatch) {
        const idx = Number.parseInt(tableMatch[1], 10);
        return tables[idx] ?? '';
      }
      return `<p>${renderInlineTextWithImageTokens(block).replace(/\n/g, '<br/>')}</p>`;
    })
    .filter(Boolean);

  return blocks.join('');
}

// ── Runs-based HTML serializer ────────────────────────────────────────────────
// Converts Run[] (full formatting data) to semantic HTML preserving every
// toolbar option: bold, italic, underline, font family, font size, text color,
// highlight color, line spacing, text type (heading level), bullet/number lists,
// indentation, images and tables.

function splitRunsByLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i].length > 0) {
        lines[lines.length - 1].push({ ...run, text: parts[i] });
      }
    }
  }
  return lines;
}

function stripLeadingChars(runs: Run[], count: number): Run[] {
  const result: Run[] = [];
  let rem = count;
  for (const run of runs) {
    if (rem <= 0) {
      result.push(run);
      continue;
    }
    if (rem >= run.text.length) {
      rem -= run.text.length;
      continue;
    }
    result.push({ ...run, text: run.text.slice(rem) });
    rem = 0;
  }
  return result;
}

function headingTagFromFontSize(fontSize: number): string {
  if (fontSize >= 38) return 'h1';
  if (fontSize >= 30) return 'h2';
  if (fontSize >= 24) return 'h3';
  if (fontSize >= 20) return 'h4';
  return 'p';
}

function renderRunSpan(run: Run): string {
  if (!run.text) return '';

  // Delegate token-bearing runs to existing inline renderer
  if (run.text.includes('[[')) {
    return renderInlineTextWithImageTokens(run.text);
  }

  const styles: string[] = [
    `font-family:${escapeHtml(run.fontFamily)}, ${FONT_STACK}`,
    `font-size:${run.fontSize}px`,
    `line-height:${run.lineSpacing}`,
    `color:${escapeHtml(run.color)}`,
  ];
  if (run.bold) styles.push('font-weight:700');
  if (run.italic) styles.push('font-style:italic');
  if (run.underline) styles.push('text-decoration:underline');
  if (run.highlightColor) styles.push(`background-color:${escapeHtml(run.highlightColor)}`);

  const text = escapeHtml(run.text);
  const inner = `<span style="${styles.join('; ')}">${text}</span>`;
  if (run.href) {
    const safeHref = escapeHtml(run.href);
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">${inner}</a>`;
  }
  return inner;
}

/**
 * Converts the editor's Run[] (full formatting) to semantic HTML.
 * Every toolbar option is encoded: bold/italic/underline, font family/size,
 * text color, highlight color, line spacing, text type (h1–h4/p),
 * bullet and numbered lists with indent levels, images and tables.
 */
export function canvasRunsToHtml(runs: Run[]): string {
  if (!runs || runs.length === 0) return '';

  const lines = splitRunsByLines(runs);
  const blocks: string[] = [];

  type BulletItem = { indent: number; html: string };
  type BulletGroup = { tag: 'ul' | 'ol'; olType: '1' | 'a'; items: BulletItem[] };
  let bulletGroup: BulletGroup | null = null;

  const flushBulletGroup = () => {
    if (!bulletGroup) return;
    const openTag =
      bulletGroup.tag === 'ul'
        ? 'ul style="padding-left:20px; margin:4px 0;"'
        : `ol type="${bulletGroup.olType}" style="padding-left:20px; margin:4px 0;"`;
    const closeTag = bulletGroup.tag;
    const liItems = bulletGroup.items
      .map(
        (item) =>
          `<li style="margin-left:${item.indent * 20}px">${item.html}</li>`,
      )
      .join('');
    blocks.push(`<${openTag}>${liItems}</${closeTag}>`);
    bulletGroup = null;
  };

  for (const lineRuns of lines) {
    const lineText = lineRuns.map((r) => r.text).join('');

    // Blank line — emit a spacer paragraph to preserve spacing
    if (!lineText.trim()) {
      flushBulletGroup();
      blocks.push('<p style="margin:0; line-height:1.5;">&nbsp;</p>');
      continue;
    }

    // Whole-line table token
    const trimmed = lineText.trim();
    if (trimmed.startsWith('[[TABLE|') && trimmed.endsWith(']]')) {
      flushBulletGroup();
      blocks.push(renderTableToken(trimmed));
      continue;
    }

    const bullet = detectBulletPrefix(lineText);
    const firstRunFontSize = lineRuns.find((r) => r.text.trim())?.fontSize ?? 16;

    if (bullet.hasBullet) {
      const level = Math.max(0, Math.floor(bullet.indentLen / 2));
      const contentRuns = stripLeadingChars(lineRuns, bullet.prefixLen);
      const contentHtml = contentRuns.map(renderRunSpan).join('');
      const isOrdered =
        bullet.listType === 'number' || bullet.listType === 'letter';
      const tag: 'ul' | 'ol' = isOrdered ? 'ol' : 'ul';
      const olType: '1' | 'a' = bullet.listType === 'letter' ? 'a' : '1';

      if (!bulletGroup) {
        bulletGroup = { tag, olType, items: [] };
      } else if (bulletGroup.tag !== tag) {
        flushBulletGroup();
        bulletGroup = { tag, olType, items: [] };
      }
      bulletGroup.items.push({ indent: level, html: contentHtml });
    } else {
      flushBulletGroup();
      const headingTag = headingTagFromFontSize(firstRunFontSize);
      const marginLeft = bullet.indentLen > 0 ? bullet.indentLen * 8 : 0;
      const styleAttr = marginLeft > 0 ? ` style="margin-left:${marginLeft}px"` : '';
      const contentRuns =
        bullet.indentLen > 0 ? stripLeadingChars(lineRuns, bullet.indentLen) : lineRuns;
      const contentHtml = contentRuns.map(renderRunSpan).join('');
      blocks.push(`<${headingTag}${styleAttr}>${contentHtml}</${headingTag}>`);
    }
  }

  flushBulletGroup();
  return blocks.join('');
}

/**
 * Parses HTML (as produced by canvasRunsToHtml) back into a Run[] array,
 * preserving bold, italic, underline, font family/size, color, highlight,
 * line spacing, heading levels, bullet/number lists, and links.
 */
export function htmlToRuns(html: string): Run[] {
  if (!html || !html.trim()) return [];

  const doc = new DOMParser().parseFromString(html, 'text/html');

  const BASE: Run = {
    text: '',
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

  const runs: Run[] = [];

  function patchStyle(base: Run, el: HTMLElement): Run {
    const s = el.style;
    const out = { ...base };
    if (s.fontFamily) {
      const fam = s.fontFamily.replace(/['"]/g, '').split(',')[0].trim();
      if (fam) out.fontFamily = fam;
    }
    if (s.fontSize) {
      const px = parseFloat(s.fontSize);
      if (!isNaN(px) && px > 0) out.fontSize = px;
    }
    if (s.lineHeight) {
      const lh = parseFloat(s.lineHeight);
      if (!isNaN(lh) && lh > 0) out.lineSpacing = lh;
    }
    if (s.color) out.color = s.color;
    const bg = s.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') out.highlightColor = bg;
    if (s.fontWeight === '700' || s.fontWeight === 'bold') out.bold = true;
    else if (s.fontWeight === '400' || s.fontWeight === 'normal') out.bold = false;
    if (s.fontStyle === 'italic') out.italic = true;
    else if (s.fontStyle === 'normal') out.italic = false;
    const td = s.textDecoration;
    if (td && td.includes('underline')) out.underline = true;
    else if (td === 'none') out.underline = false;
    return out;
  }

  function fontSizeFromTag(tag: string): number {
    switch (tag) {
      case 'h1': return 38;
      case 'h2': return 30;
      case 'h3': return 24;
      case 'h4': return 20;
      case 'h5': return 18;
      case 'h6': return 16;
      default: return 16;
    }
  }

  function pushRun(text: string, fmt: Run) {
    if (!text) return;
    runs.push({ ...fmt, text });
  }

  function inferBorderWidth(el: HTMLElement, fallback: number): number {
    const widthFromProp = parseFloat(el.style.borderWidth);
    if (!Number.isNaN(widthFromProp) && Number.isFinite(widthFromProp)) {
      return Math.max(0, Math.round(widthFromProp));
    }
    const borderMatch = (el.style.border || '').match(/(\d+(?:\.\d+)?)px/i);
    if (borderMatch) {
      const px = parseFloat(borderMatch[1]);
      if (!Number.isNaN(px) && Number.isFinite(px)) return Math.max(0, Math.round(px));
    }
    return fallback;
  }

  function inferBorderColor(el: HTMLElement, fallback: string | null): string | null {
    if (el.style.borderColor) return el.style.borderColor;
    return fallback;
  }

  function tableElementToToken(tableEl: HTMLTableElement): string | null {
    const rowElements = Array.from(tableEl.querySelectorAll('tr'));
    if (rowElements.length === 0) return null;

    const columnCount = Math.max(
      ...rowElements.map((row) => row.querySelectorAll('th,td').length),
      0,
    );
    if (columnCount <= 0) return null;

    const tableBorderWidth = inferBorderWidth(tableEl, 1);
    const tableBorderColor = inferBorderColor(tableEl, '#cbd5e1');
    const tableFmt = patchStyle({ ...BASE }, tableEl);
    const tableWidthRaw = (tableEl.style.width || '').trim();
    let tableWidthPx: number | undefined;
    if (tableWidthRaw.endsWith('px')) {
      const parsed = Number.parseFloat(tableWidthRaw.slice(0, -2));
      if (Number.isFinite(parsed) && parsed > 0) {
        tableWidthPx = Math.round(parsed);
      }
    }

    function collectCellRuns(node: Node, fmt: Run, bucket: Run[]) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/\u00a0/g, ' ');
        if (text) bucket.push({ ...fmt, text });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      let next = patchStyle(fmt, el);

      // void elements
      if (tag === 'br') { bucket.push({ ...next, text: '\n' }); return; }
      if (tag === 'wbr') return;

      // text-level semantics — same rules as walkInline (WHATWG §4.5)
      if (tag === 'strong' || tag === 'b' || tag === 'th') next = { ...next, bold: true };
      if (tag === 'em' || tag === 'i') next = { ...next, italic: true };
      if (tag === 'u' || tag === 'ins') next = { ...next, underline: true };
      if (tag === 'cite' || tag === 'dfn' || tag === 'var') next = { ...next, italic: true };
      if (tag === 'code' || tag === 'kbd' || tag === 'samp') next = { ...next, fontFamily: 'monospace' };
      if (tag === 'mark') next = { ...next, highlightColor: next.highlightColor ?? '#fef08a' };
      if (tag === 'small') next = { ...next, fontSize: Math.max(10, Math.round(next.fontSize * 0.85)) };
      if (tag === 'sub' || tag === 'sup') next = { ...next, fontSize: Math.max(10, Math.round(next.fontSize * 0.75)) };
      if (tag === 'a') {
        const href = el.getAttribute('href') ?? undefined;
        next = { ...next, href, color: '#2563eb', underline: true };
      }
      // <q> — inline quotation with typographic marks (WHATWG §4.5.7)
      if (tag === 'q') {
        bucket.push({ ...fmt, text: '“' });
        for (const child of Array.from(el.childNodes)) collectCellRuns(child, next, bucket);
        bucket.push({ ...fmt, text: '”' });
        return;
      }

      // block elements inside cells emit a trailing newline (WHATWG §4.4)
      const isCellBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'address'].includes(tag);
      if (isCellBlock) {
        for (const child of Array.from(el.childNodes)) collectCellRuns(child, next, bucket);
        if (bucket.length > 0 && bucket[bucket.length - 1].text !== '\n') {
          bucket.push({ ...next, text: '\n' });
        }
        return;
      }

      // lists inside cells (WHATWG §4.4.6/§4.4.8)
      if (tag === 'ul' || tag === 'ol') {
        let counter = 0;
        for (const child of Array.from(el.children)) {
          if (child.tagName.toLowerCase() !== 'li') continue;
          counter++;
          const liEl = child as HTMLElement;
          const liFmt = patchStyle(next, liEl);
          bucket.push({ ...liFmt, text: tag === 'ul' ? '• ' : `${counter}. ` });
          for (const c of Array.from(liEl.childNodes)) collectCellRuns(c, liFmt, bucket);
          if (bucket.length > 0 && bucket[bucket.length - 1].text !== '\n') {
            bucket.push({ ...liFmt, text: '\n' });
          }
        }
        return;
      }

      for (const child of Array.from(el.childNodes)) {
        collectCellRuns(child, next, bucket);
      }
    }

    const cells: Run[][][] = Array.from({ length: rowElements.length }, (_, rowIndex) => {
      const rowEl = rowElements[rowIndex] as HTMLElement;
      const rowFmt = patchStyle({ ...tableFmt }, rowEl);
      const cellElements = Array.from(rowElements[rowIndex].children).filter((child) => {
        const tag = child.tagName.toLowerCase();
        return tag === 'th' || tag === 'td';
      }) as HTMLElement[];

      return Array.from({ length: columnCount }, (_, colIndex) => {
        const cell = cellElements[colIndex] as HTMLElement | undefined;
        if (!cell) return [];

        const cellFmt = patchStyle({ ...rowFmt }, cell);
        const baseCellFmt =
          cell.tagName.toLowerCase() === 'th' ? { ...cellFmt, bold: true } : cellFmt;
        const cellRuns: Run[] = [];

        for (const child of Array.from(cell.childNodes)) {
          collectCellRuns(child, baseCellFmt, cellRuns);
        }

        if (cellRuns.length === 0) {
          const fallbackText = (cell.textContent ?? '').replace(/\u00a0/g, ' ').trim();
          if (!fallbackText) return [];
          return [{ ...baseCellFmt, text: fallbackText }];
        }

        return cellRuns;
      });
    });

    const cellBorders: Record<string, { width: number; color: string | null }> = {};
    rowElements.forEach((rowEl, rowIndex) => {
      const cellElements = Array.from(rowEl.children).filter((child) => {
        const tag = child.tagName.toLowerCase();
        return tag === 'th' || tag === 'td';
      });
      cellElements.forEach((cellEl, colIndex) => {
        const htmlCell = cellEl as HTMLElement;
        cellBorders[`${rowIndex}:${colIndex}`] = {
          width: inferBorderWidth(htmlCell, tableBorderWidth),
          color: inferBorderColor(htmlCell, tableBorderColor),
        };
      });
    });

    return buildTableToken({
      rows: rowElements.length,
      columns: columnCount,
      cells,
      widthPx: tableWidthPx,
      borderWidth: tableBorderWidth,
      borderColor: tableBorderColor,
      cellBorders,
      rowBorders: {},
      columnBorders: {},
      borderSegments: {},
    });
  }

  function walkInline(node: Node, fmt: Run) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\u00a0/g, ' ');
      if (text) pushRun(text, fmt);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    let next = patchStyle(fmt, el);
    // <br> is a void element representing a line break (WHATWG §4.4.11)
    if (tag === 'br') { pushRun('\n', fmt); return; }

    // Text-level semantic elements (WHATWG §4.5)
    if (tag === 'strong' || tag === 'b') next = { ...next, bold: true };
    if (tag === 'em' || tag === 'i') next = { ...next, italic: true };
    if (tag === 'u' || tag === 'ins') next = { ...next, underline: true };
    if (tag === 'cite' || tag === 'dfn' || tag === 'var') next = { ...next, italic: true };
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') next = { ...next, fontFamily: 'monospace' };
    if (tag === 'mark') next = { ...next, highlightColor: next.highlightColor ?? '#fef08a' };
    if (tag === 'small') next = { ...next, fontSize: Math.max(10, Math.round(next.fontSize * 0.85)) };
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? undefined;
      next = { ...next, href, color: '#2563eb', underline: true };
    }

    // <q> — quoted text with typographic quotation marks (WHATWG §4.5.7)
    if (tag === 'q') {
      pushRun('\u201c', fmt);
      for (const child of Array.from(el.childNodes)) walkInline(child, next);
      pushRun('\u201d', fmt);
      return;
    }
    // <sub>/<sup> — subscript/superscript (WHATWG §4.5.19) — inline, reduced font size
    if (tag === 'sub' || tag === 'sup') {
      next = { ...next, fontSize: Math.max(10, Math.round(next.fontSize * 0.75)) };
    }
    // <wbr> — word-break opportunity (WHATWG §4.5.27) — void element, no output
    if (tag === 'wbr') return;
    for (const child of Array.from(el.childNodes)) {
      walkInline(child, next);
    }
  }

  function walkBlock(el: Element) {
    const tag = el.tagName.toLowerCase();
    const htmlEl = el as HTMLElement;

    if (tag === 'div' && htmlEl.dataset.docsyncTableToken) {
      const decodedToken = decodeUriComponentSafe(htmlEl.dataset.docsyncTableToken);
      if (parseTableToken(decodedToken)) {
        pushRun(decodedToken, { ...BASE });
        pushRun('\n', { ...BASE });
        return;
      }
    }

    if (tag === 'table') {
      const token = tableElementToToken(htmlEl as HTMLTableElement);
      if (token) {
        pushRun(token, { ...BASE });
        pushRun('\n', { ...BASE });
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      let counter = 0;
      for (const child of Array.from(el.children)) {
        if (child.tagName.toLowerCase() !== 'li') continue;
        counter++;
        const liEl = child as HTMLElement;
        const fmt = patchStyle({ ...BASE }, liEl);
        const prefix = tag === 'ul' ? '• ' : `${counter}. `;
        pushRun(prefix, fmt);
        for (const c of Array.from(liEl.childNodes)) {
          // nested list — walk as block so items get proper prefixes (WHATWG §4.4.6/§4.4.8)
          if (
            c.nodeType === Node.ELEMENT_NODE &&
            ['ul', 'ol'].includes((c as HTMLElement).tagName.toLowerCase())
          ) {
            walkBlock(c as Element);
          } else {
            walkInline(c, fmt);
          }
        }
        pushRun('\n', fmt);
      }
      return;
    }

    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div'].includes(tag)) {
      const inner = htmlEl.textContent ?? '';
      // Spacer paragraph
      if (inner === '\u00a0' || inner.trim() === '') {
        pushRun('\n', { ...BASE });
        return;
      }
      const fontSize = fontSizeFromTag(tag);
      const isBold = ['h1', 'h2', 'h3', 'h4'].includes(tag);
      const baseFmt = patchStyle({ ...BASE, fontSize, bold: isBold }, htmlEl);
      for (const child of Array.from(el.childNodes)) {
        walkInline(child, baseFmt);
      }
      pushRun('\n', baseFmt);
      return;
    }

    // <pre> — preformatted text, monospace font, whitespace preserved (WHATWG §4.4.3)
    if (tag === 'pre') {
      const preFmt = patchStyle({ ...BASE, fontFamily: 'monospace' }, htmlEl);
      const text = (htmlEl.textContent ?? '').replace(/\u00a0/g, ' ');
      if (text.trim()) {
        pushRun(text.trimEnd(), preFmt);
        pushRun('\n', preFmt);
      }
      return;
    }

    // <blockquote> — block quotation, recurse its block children (WHATWG §4.4.4)
    if (tag === 'blockquote') {
      for (const child of Array.from(el.children)) walkBlock(child);
      return;
    }

    // <hr> — thematic break, emit a blank line (WHATWG §4.4.2)
    if (tag === 'hr') {
      pushRun('\n', { ...BASE });
      return;
    }

    // <dl> — description list: <dt> bold, <dd> indented (WHATWG §4.4.9)
    if (tag === 'dl') {
      for (const child of Array.from(el.children)) {
        const ct = child.tagName.toLowerCase();
        const childEl = child as HTMLElement;
        const childFmt = patchStyle({ ...BASE }, childEl);
        if (ct === 'dt') {
          for (const c of Array.from(childEl.childNodes)) walkInline(c, { ...childFmt, bold: true });
          pushRun('\n', { ...childFmt, bold: true });
        } else if (ct === 'dd') {
          pushRun('    ', childFmt);
          for (const c of Array.from(childEl.childNodes)) walkInline(c, childFmt);
          pushRun('\n', childFmt);
        }
      }
      return;
    }

    // <figure> — figcaption as italic small text, other children as blocks (WHATWG §4.4.12)
    if (tag === 'figure') {
      for (const child of Array.from(el.children)) {
        if (child.tagName.toLowerCase() === 'figcaption') {
          const capFmt = patchStyle({ ...BASE, fontSize: 14, italic: true }, child as HTMLElement);
          for (const c of Array.from((child as HTMLElement).childNodes)) walkInline(c, capFmt);
          pushRun('\n', capFmt);
        } else {
          walkBlock(child);
        }
      }
      return;
    }

    // <address> — contact info, conventionally italic (WHATWG §4.3.10)
    if (tag === 'address') {
      const addrFmt = patchStyle({ ...BASE, italic: true }, htmlEl);
      for (const child of Array.from(el.childNodes)) walkInline(child, addrFmt);
      pushRun('\n', addrFmt);
      return;
    }

    // <menu> — list of commands, treat as unordered list (WHATWG §4.4.7)
    if (tag === 'menu') {
      for (const child of Array.from(el.children)) {
        if (child.tagName.toLowerCase() !== 'li') continue;
        const liEl = child as HTMLElement;
        const fmt = patchStyle({ ...BASE }, liEl);
        pushRun('• ', fmt);
        for (const c of Array.from(liEl.childNodes)) walkInline(c, fmt);
        pushRun('\n', fmt);
      }
      return;
    }

    // <details>/<summary> — disclosure widget (WHATWG §4.11.1)
    if (tag === 'details') {
      for (const child of Array.from(el.children)) {
        if (child.tagName.toLowerCase() === 'summary') {
          const sumFmt = patchStyle({ ...BASE, bold: true }, child as HTMLElement);
          for (const c of Array.from((child as HTMLElement).childNodes)) walkInline(c, sumFmt);
          pushRun('\n', sumFmt);
        } else {
          walkBlock(child);
        }
      }
      return;
    }

    // Fallback: structural/sectioning container (WHATWG §4.3) — route each child node
    // correctly so text nodes in sectioning elements are never silently dropped.
    // Block children go through walkBlock; inline content is collected and flushed as a paragraph.
    {
      const BLOCK_TAGS = new Set([
        'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'menu',
        'table', 'pre', 'blockquote', 'hr', 'dl', 'figure', 'section',
        'article', 'aside', 'header', 'footer', 'main', 'nav', 'address',
        'details', 'dialog', 'fieldset', 'form', 'search',
      ]);
      const containerFmt = patchStyle({ ...BASE }, htmlEl);
      const inlineBuf: Node[] = [];
      const flushInline = () => {
        if (inlineBuf.length === 0) return;
        const hasText = inlineBuf.some(n => (n.textContent ?? '').replace(/\u00a0/g, ' ').trim().length > 0);
        if (hasText) {
          for (const n of inlineBuf) walkInline(n, containerFmt);
          pushRun('\n', containerFmt);
        }
        inlineBuf.length = 0;
      };
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          inlineBuf.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (BLOCK_TAGS.has((child as HTMLElement).tagName.toLowerCase())) {
            flushInline();
            walkBlock(child as Element);
          } else {
            inlineBuf.push(child);
          }
        }
      }
      flushInline();
    }
  }

  for (const child of Array.from(doc.body.children)) {
    walkBlock(child);
  }

  // Trim trailing newlines
  while (runs.length > 0 && runs[runs.length - 1].text === '\n') runs.pop();

  return runs.length > 0 ? runs : [{ ...BASE, text: '' }];
}
