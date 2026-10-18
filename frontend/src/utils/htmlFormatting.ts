// ── HTML syntax highlighting helpers ─────────────────────────────────────────
const VOID_TAGS = new Set(['br','hr','img','input','meta','link','area','base','col','embed','param','source','track','wbr']);

export function prettyPrintHtml(html: string): string {
  const parts: string[] = [];
  let depth = 0;
  const ind = () => '  '.repeat(depth);
  const re = /<(!--[\s\S]*?--|[^>]+)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[2] !== undefined) {
      const text = m[2];
      // Drop only formatting-only whitespace; preserve intentional spaces.
      if (text.trim().length === 0 && /[\n\r\t]/.test(text)) continue;
      // Indent text lines only when doing so is safe (no intentional edge spaces).
      if (text) {
        const hasEdgeSpaces = /^\s|\s$/.test(text);
        parts.push(hasEdgeSpaces ? text : ind() + text);
      }
    } else {
      const inner = m[1];
      if (inner.startsWith('/')) {
        depth = Math.max(0, depth - 1);
        parts.push(ind() + `<${inner}>`);
      } else if (inner.startsWith('!--')) {
        parts.push(ind() + `<${inner}>`);
      } else {
        const tagName = inner.match(/^([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase() ?? '';
        const isSelfClose = inner.endsWith('/') || VOID_TAGS.has(tagName);
        parts.push(ind() + `<${inner}>`);
        if (!isSelfClose) depth++;
      }
    }
  }
  return parts.join('\n');
}

export function colorizeHtml(html: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let result = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      const next = html.indexOf('<', i);
      const slice = next === -1 ? html.slice(i) : html.slice(i, next);
      const trimmed = slice.trim();
      result += trimmed
        ? `<span style="color:#e2e8f0">${esc(slice)}</span>`
        : esc(slice);
      i = next === -1 ? html.length : next;
      continue;
    }
    const close = html.indexOf('>', i);
    if (close === -1) { result += esc(html.slice(i)); break; }
    const inner = html.slice(i + 1, close);
    const isClosing = inner.startsWith('/');
    const tagContent = isClosing ? inner.slice(1) : inner;
    const nm = tagContent.match(/^([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)/);
    if (!nm) {
      result += `<span style="color:#94a3b8">&lt;${esc(inner)}&gt;</span>`;
      i = close + 1;
      continue;
    }
    const tagName = nm[1];
    const rest = nm[2];
    const coloredAttrs = rest.replace(
      /(\s+)([a-zA-Z][a-zA-Z0-9\-:_]*)(?:="([^"]*)")?(\s*\/)?/g,
      (_full, space, name, val) => {
        if (val !== undefined)
          return `${space}<span style="color:#7dd3fc">${esc(name)}</span>=<span style="color:#fbbf24">"${esc(val)}"</span>`;
        return `${space}<span style="color:#7dd3fc">${esc(name)}</span>`;
      },
    );
    const lt = `<span style="color:#475569">&lt;</span>`;
    const gt = `<span style="color:#475569">&gt;</span>`;
    const tagColor = isClosing ? '#fb7185' : '#34d399';
    result += `${lt}<span style="color:${tagColor}">${isClosing ? '/' : ''}${esc(tagName)}</span>${coloredAttrs}${gt}`;
    i = close + 1;
  }
  return result;
}
