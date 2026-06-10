import type { Range, SourceFile } from '../src/source-file';
import type { GreenElement, GreenNode } from '../src/syntax/green';

function escapeForDebug(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
    .replaceAll('"', '\\"');
}

/**
 * Lossless, indented pretty-print of a green tree. Nodes render their
 * `SyntaxKind`; tokens render `Kind "escaped text"`. Trivia tokens are
 * included, so the rendering pins the full tree shape.
 */
export function printTree(node: GreenNode): string {
  const lines: string[] = [];
  const walk = (element: GreenElement, depth: number): void => {
    const indent = '  '.repeat(depth);
    if (element.type === 'token') {
      lines.push(`${indent}${element.kind} "${escapeForDebug(element.text)}"`);
      return;
    }
    lines.push(`${indent}${element.kind}`);
    for (const child of element.children) {
      walk(child, depth + 1);
    }
  };
  walk(node, 0);
  return lines.join('\n');
}

/**
 * Underline a diagnostic span with `~`, reading the source line(s) from
 * `sourceFile.text`. A zero-length span underlines a single position.
 */
export function highlight(sourceFile: SourceFile, range: Range): string {
  const lines = sourceFile.text.split('\n');
  const rendered: string[] = [];
  for (let line = range.start.line; line <= range.end.line; line++) {
    const lineText = lines[line] ?? '';
    const from = line === range.start.line ? range.start.character : 0;
    const to = line === range.end.line ? range.end.character : lineText.length;
    const isOnlyLine = range.start.line === range.end.line;
    const width = isOnlyLine && to === from ? 1 : Math.max(to - from, 0);
    rendered.push(lineText);
    rendered.push(`${' '.repeat(from)}${'~'.repeat(width)}`);
  }
  // Lead with a newline so Vitest's inline-snapshot serializer puts the
  // opening quote on its own line, keeping the source line and `~` underline
  // at the same indentation (otherwise the quote shifts the first line right).
  return `\n${rendered.join('\n')}`;
}
