import { describe, expect, it } from 'vitest';
import { getPositionalArgument, parseQuotedStringLiteral } from '../src/attribute-helpers';
import type { PslAttribute } from '../src/types';

function makeAttribute(args: PslAttribute['args']): PslAttribute {
  const span = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } };
  return { name: 'test', args, span };
}

describe('getPositionalArgument', () => {
  it('returns first positional argument by default', () => {
    const attr = makeAttribute([{ kind: 'positional', value: 'hello' }]);
    expect(getPositionalArgument(attr)).toBe('hello');
  });

  it('returns positional argument at given index', () => {
    const attr = makeAttribute([
      { kind: 'positional', value: 'first' },
      { kind: 'positional', value: 'second' },
    ]);
    expect(getPositionalArgument(attr, 1)).toBe('second');
  });

  it('returns undefined when no positional arguments exist', () => {
    const attr = makeAttribute([{ kind: 'named', name: 'key', value: 'val' }]);
    expect(getPositionalArgument(attr)).toBeUndefined();
  });

  it('returns undefined when index is out of range', () => {
    const attr = makeAttribute([{ kind: 'positional', value: 'only' }]);
    expect(getPositionalArgument(attr, 5)).toBeUndefined();
  });

  it('skips named arguments when counting positional ones', () => {
    const attr = makeAttribute([
      { kind: 'named', name: 'x', value: 'skip' },
      { kind: 'positional', value: 'target' },
    ]);
    expect(getPositionalArgument(attr, 0)).toBe('target');
  });
});

describe('parseQuotedStringLiteral', () => {
  it('parses double-quoted string', () => {
    expect(parseQuotedStringLiteral('"hello"')).toBe('hello');
  });

  it('parses single-quoted string', () => {
    expect(parseQuotedStringLiteral("'world'")).toBe('world');
  });

  it('returns undefined for unquoted value', () => {
    expect(parseQuotedStringLiteral('hello')).toBeUndefined();
  });

  it('returns undefined for mismatched quotes', () => {
    expect(parseQuotedStringLiteral('"hello\'')).toBeUndefined();
  });

  it('handles empty quoted string', () => {
    expect(parseQuotedStringLiteral('""')).toBe('');
  });

  it('trims whitespace before parsing', () => {
    expect(parseQuotedStringLiteral('  "trimmed"  ')).toBe('trimmed');
  });
});
