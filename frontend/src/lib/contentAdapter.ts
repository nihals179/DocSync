import { DEFAULT_RUN_FMT, detectBulletPrefix, parseImageToken, parseTableToken, runsToText, type Run } from '../components/editor/textModel';

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
                `font-family:${run.fontFamily}`,
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
    `font-family:${escapeHtml(run.fontFamily)}, sans-serif`,
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
      default: return 16;
    }
  }

  function pushRun(text: string, fmt: Run) {
    if (!text) return;
    runs.push({ ...fmt, text });
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
    if (tag === 'strong' || tag === 'b') next = { ...next, bold: true };
    if (tag === 'em' || tag === 'i') next = { ...next, italic: true };
    if (tag === 'u') next = { ...next, underline: true };
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? undefined;
      next = { ...next, href, color: '#2563eb', underline: true };
    }
    for (const child of Array.from(el.childNodes)) {
      walkInline(child, next);
    }
  }

  function walkBlock(el: Element) {
    const tag = el.tagName.toLowerCase();
    const htmlEl = el as HTMLElement;

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
          walkInline(c, fmt);
        }
        pushRun('\n', fmt);
      }
      return;
    }

    if (['h1', 'h2', 'h3', 'h4', 'p', 'div'].includes(tag)) {
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

    // Fallback: recurse into children
    for (const child of Array.from(el.children)) {
      walkBlock(child);
    }
  }

  for (const child of Array.from(doc.body.children)) {
    walkBlock(child);
  }

  // Trim trailing newlines
  while (runs.length > 0 && runs[runs.length - 1].text === '\n') runs.pop();

  return runs.length > 0 ? runs : [{ ...BASE, text: '' }];
}
