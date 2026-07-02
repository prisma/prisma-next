/**
 * Result rendering for the REPL: psql-style box tables for row sets,
 * `util.inspect` for everything else. Tables are capped and measured in
 * display columns (string-width) so large result sets and wide characters
 * cannot freeze the session or break the borders.
 */
import { inspect } from 'node:util';
import stringWidth from 'string-width';
import { replPalette } from './palette';

export interface RenderOptions {
  readonly color: boolean;
  readonly elapsedMs?: number;
}

const MAX_CELL_WIDTH = 40;
const MAX_TABLE_ROWS = 50;

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

/** Truncates to a display-column budget, never splitting surrogate pairs. */
function truncate(text: string): string {
  const flattened = text.replaceAll('\n', ' ');
  if (stringWidth(flattened) <= MAX_CELL_WIDTH) return flattened;
  let out = '';
  let width = 0;
  for (const point of flattened) {
    const pointWidth = stringWidth(point);
    if (width + pointWidth > MAX_CELL_WIDTH - 1) break;
    out += point;
    width += pointWidth;
  }
  return `${out}…`;
}

/** Pads to a display-column width (string-width aware, unlike padEnd). */
function padCell(text: string, width: number): string {
  const pad = width - stringWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}

export function renderRowsTable(
  rows: readonly Record<string, unknown>[],
  opts: RenderOptions,
): string {
  const visibleRows = rows.slice(0, MAX_TABLE_ROWS);
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of visibleRows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  const footerParts = [`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`];
  if (rows.length > MAX_TABLE_ROWS) {
    footerParts.push(`showing first ${MAX_TABLE_ROWS}`);
  }
  if (opts.elapsedMs !== undefined) footerParts.push(`${Math.round(opts.elapsedMs)} ms`);
  const footer = footerParts.join(' · ');
  const palette = replPalette(opts.color);

  if (columns.length === 0) {
    return palette.dim(footer);
  }

  const widths = columns.map((col) => stringWidth(col));
  const cells = visibleRows.map((row) =>
    columns.map((col, i) => {
      const cell = truncate(formatCell(col in row ? row[col] : null));
      const width = stringWidth(cell);
      if (width > widths[i]!) widths[i] = width;
      return cell;
    }),
  );

  const horizontal = (left: string, mid: string, right: string) =>
    `${left}${widths.map((w) => '─'.repeat(w + 2)).join(mid)}${right}`;
  const renderLine = (values: readonly string[], styler?: (s: string) => string) =>
    `│${values
      .map((value, i) => {
        const padded = ` ${padCell(value, widths[i]!)} `;
        return styler ? styler(padded) : padded;
      })
      .join('│')}│`;

  const lines = [
    horizontal('┌', '┬', '┐'),
    renderLine(columns, palette.bold),
    horizontal('├', '┼', '┤'),
    ...cells.map((row) => renderLine(row)),
    horizontal('└', '┴', '┘'),
    palette.dim(footer),
  ];
  return lines.join('\n');
}

export function renderResultValue(value: unknown, opts: RenderOptions): string {
  if (Array.isArray(value) && value.every(isPlainRow)) {
    const rows: readonly Record<string, unknown>[] = value;
    // Rows without enumerable keys (Map/Set/class instances) would render as
    // an empty table; fall through to inspect so the values stay visible.
    if (rows.length === 0 || rows.some((row) => Object.keys(row).length > 0)) {
      return renderRowsTable(rows, opts);
    }
  }
  return inspect(value, { colors: opts.color, depth: 6, maxArrayLength: 50 });
}
