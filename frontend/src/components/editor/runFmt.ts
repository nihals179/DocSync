import type { Run, RunFmt } from './textModel';

export function toRunFmt(run: Run): RunFmt {
  return {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    textAlign: run.textAlign ?? 'left',
    fontSize: run.fontSize,
    lineSpacing: run.lineSpacing,
    fontFamily: run.fontFamily,
    color: run.color,
    highlightColor: run.highlightColor,
    href: run.href,
  };
}
