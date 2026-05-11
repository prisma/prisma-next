import type { ContractSourceDiagnostic } from '@prisma-next/config/config-types';
import type { PslSpan } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { parseObjectLiteralStringMap } from '../src/psl-attribute-parsing';

const span: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 1, line: 1, column: 2 },
};

function callParse(raw: string): {
  result: Record<string, string> | undefined;
  diagnostics: ContractSourceDiagnostic[];
} {
  const diagnostics: ContractSourceDiagnostic[] = [];
  const result = parseObjectLiteralStringMap({
    raw,
    diagnostics,
    sourceId: 'schema.prisma',
    span,
    entityLabel: 'model User @@index',
  });
  return { result, diagnostics };
}

describe('parseObjectLiteralStringMap', () => {
  it('parses a single-key object literal', () => {
    const { result, diagnostics } = callParse('{ tokenizer: "ngram" }');
    expect(result).toEqual({ tokenizer: 'ngram' });
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a multi-key object literal', () => {
    const { result, diagnostics } = callParse('{ a: "one", b: "two", c: "three" }');
    expect(result).toEqual({ a: 'one', b: 'two', c: 'three' });
    expect(diagnostics).toHaveLength(0);
  });

  it('returns an empty record for an empty object literal', () => {
    const { result, diagnostics } = callParse('{}');
    expect(result).toEqual({});
    expect(diagnostics).toHaveLength(0);
  });

  it('returns an empty record when only whitespace inside the braces', () => {
    const { result, diagnostics } = callParse('{   }');
    expect(result).toEqual({});
    expect(diagnostics).toHaveLength(0);
  });

  it('tolerates a trailing comma', () => {
    const { result, diagnostics } = callParse('{ a: "1", b: "2", }');
    expect(result).toEqual({ a: '1', b: '2' });
    expect(diagnostics).toHaveLength(0);
  });

  it('preserves commas that appear inside quoted values', () => {
    const { result, diagnostics } = callParse('{ list: "a,b,c" }');
    expect(result).toEqual({ list: 'a,b,c' });
    expect(diagnostics).toHaveLength(0);
  });

  it('preserves colons that appear inside quoted keys-or-values', () => {
    const { result, diagnostics } = callParse('{ url: "https://example.com" }');
    expect(result).toEqual({ url: 'https://example.com' });
    expect(diagnostics).toHaveLength(0);
  });

  it('tracks bracket depth when separating entries', () => {
    const { result, diagnostics } = callParse('{ list: "[a,b]", other: "x" }');
    expect(result).toEqual({ list: '[a,b]', other: 'x' });
    expect(diagnostics).toHaveLength(0);
  });

  it('handles escaped quotes inside string values', () => {
    const { result, diagnostics } = callParse('{ s: "hello \\"world\\"" }');
    expect(result).toEqual({ s: 'hello \\"world\\"' });
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects input that does not start with {', () => {
    const { result, diagnostics } = callParse('key: "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_ARGUMENT');
    expect(diagnostics[0]?.message).toMatch(/object literal/);
  });

  it('rejects input that does not end with }', () => {
    const { result, diagnostics } = callParse('{ key: "value"');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('PSL_INVALID_ATTRIBUTE_ARGUMENT');
  });

  it('rejects an entry that is missing a colon', () => {
    const { result, diagnostics } = callParse('{ noColonHere }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/colon/);
  });

  it('rejects an entry whose key is empty', () => {
    const { result, diagnostics } = callParse('{ : "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/bare identifier/);
  });

  it('rejects an entry whose key starts with a digit', () => {
    const { result, diagnostics } = callParse('{ 1abc: "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/bare identifier/);
  });

  it('rejects an entry whose key contains punctuation', () => {
    const { result, diagnostics } = callParse('{ "quoted-key": "value" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/bare identifier/);
  });

  it('rejects a boolean leaf value', () => {
    const { result, diagnostics } = callParse('{ enabled: true }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/quoted string literal/);
  });

  it('rejects a numeric leaf value', () => {
    const { result, diagnostics } = callParse('{ count: 42 }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/quoted string literal/);
  });

  it('rejects a bare identifier leaf value', () => {
    const { result, diagnostics } = callParse('{ ref: someName }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/quoted string literal/);
  });

  it('rejects duplicate keys', () => {
    const { result, diagnostics } = callParse('{ a: "1", a: "2" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/more than once/);
  });

  it('stops at the first diagnostic', () => {
    const { result, diagnostics } = callParse('{ 1bad: "x", 2bad: "y" }');
    expect(result).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
  });
});
