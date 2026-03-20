import { describe, expect, it } from 'vitest';
import { parseRawDefault } from '../src/raw-default-parser';

describe('parseRawDefault', () => {
  it('recognizes nextval (autoincrement)', () => {
    expect(parseRawDefault("nextval('user_id_seq'::regclass)")).toEqual({
      kind: 'function',
      expression: 'autoincrement()',
    });
  });

  it('recognizes now()', () => {
    expect(parseRawDefault('now()')).toEqual({ kind: 'function', expression: 'now()' });
  });

  it('recognizes CURRENT_TIMESTAMP', () => {
    expect(parseRawDefault('CURRENT_TIMESTAMP')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('recognizes clock_timestamp()', () => {
    expect(parseRawDefault('clock_timestamp()')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('recognizes gen_random_uuid()', () => {
    expect(parseRawDefault('gen_random_uuid()')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('recognizes uuid_generate_v4()', () => {
    expect(parseRawDefault('uuid_generate_v4()')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('recognizes boolean true', () => {
    expect(parseRawDefault('true')).toEqual({ kind: 'literal', value: true });
    expect(parseRawDefault('TRUE')).toEqual({ kind: 'literal', value: true });
  });

  it('recognizes boolean false', () => {
    expect(parseRawDefault('false')).toEqual({ kind: 'literal', value: false });
  });

  it('recognizes integer literals', () => {
    expect(parseRawDefault('42')).toEqual({ kind: 'literal', value: 42 });
    expect(parseRawDefault('-1')).toEqual({ kind: 'literal', value: -1 });
  });

  it('recognizes decimal literals', () => {
    expect(parseRawDefault('3.14')).toEqual({ kind: 'literal', value: 3.14 });
  });

  it('preserves large integer literals as tagged bigint values', () => {
    expect(parseRawDefault('9223372036854775807')).toEqual({
      kind: 'literal',
      value: { $type: 'bigint', value: '9223372036854775807' },
    });
  });

  it('recognizes string literals', () => {
    expect(parseRawDefault("'hello'")).toEqual({ kind: 'literal', value: 'hello' });
  });

  it('recognizes string literals with type cast', () => {
    expect(parseRawDefault("'hello'::text")).toEqual({ kind: 'literal', value: 'hello' });
  });

  it('unescapes single quotes in strings', () => {
    expect(parseRawDefault("'it''s'")).toEqual({ kind: 'literal', value: "it's" });
  });

  it('returns unrecognized function expressions as-is', () => {
    expect(parseRawDefault('my_func()')).toEqual({
      kind: 'function',
      expression: 'my_func()',
    });
  });

  it('trims whitespace', () => {
    expect(parseRawDefault('  true  ')).toEqual({ kind: 'literal', value: true });
  });
});
