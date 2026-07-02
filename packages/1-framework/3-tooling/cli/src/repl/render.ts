/**
 * Result rendering for the REPL: psql-style box tables for row sets,
 * `util.inspect` for everything else.
 */
import { inspect } from 'node:util';
import { createColors } from 'colorette';

// `color` option is authoritative; see highlight.ts for why NO_COLOR is bypassed.
const { bold, dim } = createColors({ useColor: true });

export interface RenderOptions {
  readonly color: boolean;
  readonly elapsedMs?: number;
}

const MAX_CELL_WIDTH = 40;

function isPlainRow(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string): string {
  const flattened = text.replaceAll('\n', ' ');
  return flattened.length > MAX_CELL_WIDTH
    ? `${flattened.slice(0, MAX_CELL_WIDTH - 1)}…`
    : flattened;
}

export function renderRowsTable(
  rows: readonly Record<string, unknown>[],
  opts: RenderOptions,
): string {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  const footerParts = [`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`];
  if (opts.elapsedMs !== undefined) footerParts.push(`${Math.round(opts.elapsedMs)} ms`);
  const footer = footerParts.join(' · ');
  const dimmed = (text: string) => (opts.color ? dim(text) : text);
  const emphasized = (text: string) => (opts.color ? bold(text) : text);

  if (columns.length === 0) {
    return dimmed(footer);
  }

  const cells = rows.map((row) =>
    columns.map((col) => truncate(formatCell(col in row ? row[col] : null))),
  );
  const widths = columns.map((col, i) =>
    Math.max(col.length, ...cells.map((row) => row[i]!.length)),
  );

  const horizontal = (left: string, mid: string, right: string) =>
    `${left}${widths.map((w) => '─'.repeat(w + 2)).join(mid)}${right}`;
  const renderLine = (values: readonly string[], styler?: (s: string) => string) =>
    `│${values
      .map((value, i) => {
        const padded = ` ${value.padEnd(widths[i]!)} `;
        return styler ? styler(padded) : padded;
      })
      .join('│')}│`;

  const lines = [
    horizontal('┌', '┬', '┐'),
    renderLine(columns, emphasized),
    horizontal('├', '┼', '┤'),
    ...cells.map((row) => renderLine(row)),
    horizontal('└', '┴', '┘'),
    dimmed(footer),
  ];
  return lines.join('\n');
}

export function renderResultValue(value: unknown, opts: RenderOptions): string {
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainRow)) {
    return renderRowsTable(value, opts);
  }
  if (Array.isArray(value) && value.length === 0) {
    return renderRowsTable([], opts);
  }
  return inspect(value, { colors: opts.color, depth: 6, maxArrayLength: 50 });
}
