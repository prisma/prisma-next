import { describe, expect, it } from 'vitest';
import { parseRawDefault } from '../../src/core/psl-contract-infer/raw-default-parser';

describe('parseRawDefault', () => {
  it('recognizes nextval (autoincrement)', () => {
    expect(parseRawDefault("nextval('user_id_seq'::regclass)")).toEqual({
      kind: 'autoincrement',
    });
  });

  it('recognizes now()', () => {
    expect(parseRawDefault('now()')).toEqual({ kind: 'expression', expression: 'now()' });
  });

  it('recognizes CURRENT_TIMESTAMP', () => {
    expect(parseRawDefault('CURRENT_TIMESTAMP')).toEqual({
      kind: 'expression',
      expression: 'now()',
    });
  });

  it('recognizes clock_timestamp()', () => {
    expect(parseRawDefault('clock_timestamp()')).toEqual({
      kind: 'expression',
      expression: 'clock_timestamp()',
    });
  });

  it('recognizes timestamp-cast now() defaults', () => {
    expect(parseRawDefault('now()::timestamp')).toEqual({
      kind: 'expression',
      expression: 'now()',
    });
    expect(parseRawDefault("('now'::text)::timestamp without time zone")).toEqual({
      kind: 'expression',
      expression: 'now()',
    });
  });

  it('recognizes timestamp-cast clock_timestamp() defaults', () => {
    expect(parseRawDefault('clock_timestamp()::timestamp with time zone')).toEqual({
      kind: 'expression',
      expression: 'clock_timestamp()',
    });
  });

  it('preserves timestamp string literals when they are not canonical time functions', () => {
    expect(parseRawDefault("'2024-01-01 00:00:00'::timestamp")).toEqual({
      kind: 'expression',
      expression: '2024-01-01 00:00:00',
    });
  });

  it('recognizes gen_random_uuid()', () => {
    expect(parseRawDefault('gen_random_uuid()')).toEqual({
      kind: 'expression',
      expression: 'gen_random_uuid()',
    });
  });

  it('recognizes uuid_generate_v4()', () => {
    expect(parseRawDefault('uuid_generate_v4()')).toEqual({
      kind: 'expression',
      expression: 'gen_random_uuid()',
    });
  });

  it('recognizes boolean true', () => {
    expect(parseRawDefault('true')).toEqual({ kind: 'expression', expression: 'true' });
    expect(parseRawDefault('TRUE')).toEqual({ kind: 'expression', expression: 'true' });
  });

  it('recognizes boolean false', () => {
    expect(parseRawDefault('false')).toEqual({ kind: 'expression', expression: 'false' });
  });

  it('recognizes NULL literals', () => {
    expect(parseRawDefault('NULL::jsonb')).toEqual({ kind: 'expression', expression: 'NULL' });
  });

  it('recognizes integer literals', () => {
    expect(parseRawDefault('42')).toEqual({ kind: 'expression', expression: '42' });
    expect(parseRawDefault('-1')).toEqual({ kind: 'expression', expression: '-1' });
  });

  it('recognizes decimal literals', () => {
    expect(parseRawDefault('3.14')).toEqual({ kind: 'expression', expression: '3.14' });
  });

  it('parses large integer literals as expression strings without precision loss', () => {
    const result = parseRawDefault('9223372036854775807');
    expect(result).toEqual({
      kind: 'expression',
      expression: '9223372036854775807',
    });
  });

  it('recognizes string literals', () => {
    expect(parseRawDefault("'hello'")).toEqual({ kind: 'expression', expression: 'hello' });
  });

  it('recognizes string literals with type cast', () => {
    expect(parseRawDefault("'hello'::text")).toEqual({ kind: 'expression', expression: 'hello' });
  });

  it('preserves jsonb string defaults as raw expressions when native type context matters', () => {
    expect(parseRawDefault("'{}'::jsonb", 'jsonb')).toEqual({
      kind: 'expression',
      expression: "'{}'::jsonb",
    });
  });

  it('parses inline json literals when no cast is present', () => {
    expect(parseRawDefault('\'{"enabled":true}\'', 'json')).toEqual({
      kind: 'expression',
      expression: '{"enabled":true}',
    });
  });

  it('falls back to string literals when inline json parsing fails', () => {
    expect(parseRawDefault("'not-json'", 'jsonb')).toEqual({
      kind: 'expression',
      expression: 'not-json',
    });
  });

  it('unescapes single quotes in strings', () => {
    expect(parseRawDefault("'it''s'")).toEqual({ kind: 'expression', expression: "it's" });
  });

  it('returns unrecognized function expressions as-is', () => {
    expect(parseRawDefault('my_func()')).toEqual({
      kind: 'expression',
      expression: 'my_func()',
    });
  });

  it('trims whitespace', () => {
    expect(parseRawDefault('  true  ')).toEqual({ kind: 'expression', expression: 'true' });
  });
});
