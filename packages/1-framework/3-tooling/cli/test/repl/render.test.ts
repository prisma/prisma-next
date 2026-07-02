import { describe, expect, it } from 'vitest';
import { renderResultValue, renderRowsTable } from '../../src/repl/render';

const noColor = { color: false };

describe('renderRowsTable', () => {
  it('renders rows as a box table with headers', () => {
    const out = renderRowsTable(
      [
        { id: 1, email: 'ada@corp.io' },
        { id: 2, email: 'bob@corp.io' },
      ],
      noColor,
    );
    expect(out).toContain('id');
    expect(out).toContain('email');
    expect(out).toContain('ada@corp.io');
    expect(out).toContain('┌');
    expect(out).toContain('┘');
  });

  it('reports the row count', () => {
    const out = renderRowsTable([{ a: 1 }], noColor);
    expect(out).toContain('1 row');
    const out2 = renderRowsTable([{ a: 1 }, { a: 2 }], noColor);
    expect(out2).toContain('2 rows');
  });

  it('includes elapsed time when provided', () => {
    const out = renderRowsTable([{ a: 1 }], { color: false, elapsedMs: 12 });
    expect(out).toContain('12 ms');
  });

  it('unions columns across rows', () => {
    const out = renderRowsTable([{ a: 1 }, { b: 2 }], noColor);
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('renders null as null and dates as ISO strings', () => {
    const out = renderRowsTable([{ x: null, d: new Date('2026-01-02T03:04:05Z') }], noColor);
    expect(out).toContain('null');
    expect(out).toContain('2026-01-02T03:04:05');
  });

  it('inlines nested objects compactly and truncates long values', () => {
    const out = renderRowsTable(
      [{ tags: [{ label: 'x'.repeat(100) }], meta: { deep: true } }],
      noColor,
    );
    expect(out).toContain('…');
    expect(out).toContain('{"deep":true}');
  });

  it('renders zero rows with an empty note', () => {
    const out = renderRowsTable([], noColor);
    expect(out).toContain('0 rows');
  });
});

describe('renderRowsTable: hardening', () => {
  it('caps large result sets and notes the cap in the footer', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: i }));
    const out = renderRowsTable(rows, noColor);
    expect(out).toContain('120 rows');
    expect(out).toContain('showing first 50');
    expect(out).not.toContain('│ 51');
  });

  it('measures widths in display columns for wide characters', () => {
    const out = renderRowsTable([{ name: '田中' }, { name: 'bo' }], noColor);
    const lines = out.split('\n');
    const borderWidths = new Set(
      lines
        .filter((l) => l.startsWith('┌') || l.startsWith('└') || l.startsWith('├'))
        .map((l) => l.length),
    );
    expect(borderWidths.size).toBe(1);
  });

  it('truncates without splitting surrogate pairs', () => {
    const out = renderRowsTable([{ x: '💥'.repeat(30) }], noColor);
    expect(out).toContain('…');
    expect(out).not.toContain('�');
  });
});

describe('renderResultValue', () => {
  it('falls back to inspect for rows without enumerable keys', () => {
    const out = renderResultValue([new Map([['a', 1]])], noColor);
    expect(out).not.toContain('┌');
    expect(out).toContain('Map');
  });

  it('renders arrays of plain objects as tables', () => {
    const out = renderResultValue([{ id: 1 }], noColor);
    expect(out).toContain('┌');
  });

  it('renders scalars via inspect', () => {
    expect(renderResultValue(42, noColor)).toBe('42');
    expect(renderResultValue('hi', noColor)).toBe("'hi'");
  });

  it('renders undefined as dim placeholder text', () => {
    expect(renderResultValue(undefined, noColor)).toBe('undefined');
  });

  it('renders non-row arrays via inspect', () => {
    expect(renderResultValue([1, 2, 3], noColor)).toContain('[ 1, 2, 3 ]');
  });

  it('renders plain objects via inspect', () => {
    expect(renderResultValue({ a: 1 }, noColor)).toContain('a: 1');
  });
});
