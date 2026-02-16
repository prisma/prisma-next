import { describe, expect, it } from 'vitest';
import {
  PG_ARRAY_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TIME_CODEC_ID,
} from '../src/core/codec-ids';
import { expandParameterizedNativeType } from '../src/core/parameterized-types';

describe('expandParameterizedNativeType', () => {
  it('returns nativeType when typeParams missing', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'character varying',
      codecId: PG_CHAR_CODEC_ID,
    });

    expect(result).toBe('character varying');
  });

  it('returns nativeType when codecId missing', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'character varying',
      typeParams: { length: 32 },
    });

    expect(result).toBe('character varying');
  });

  it('expands length-parameterized types', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'character',
      codecId: PG_CHAR_CODEC_ID,
      typeParams: { length: 12 },
    });

    expect(result).toBe('character(12)');
  });

  it('expands length-parameterized sql/varchar types', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'character varying',
      codecId: 'sql/varchar@1',
      typeParams: { length: 32 },
    });

    expect(result).toBe('character varying(32)');
  });

  it('returns nativeType for invalid length parameter', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'character',
      codecId: PG_CHAR_CODEC_ID,
      typeParams: { length: -1 },
    });

    expect(result).toBe('character');
  });

  it('expands numeric precision and scale', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'numeric',
      codecId: PG_NUMERIC_CODEC_ID,
      typeParams: { precision: 10, scale: 2 },
    });

    expect(result).toBe('numeric(10,2)');
  });

  it('expands numeric precision without scale', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'numeric',
      codecId: PG_NUMERIC_CODEC_ID,
      typeParams: { precision: 4 },
    });

    expect(result).toBe('numeric(4)');
  });

  it('returns nativeType for invalid numeric parameters', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'numeric',
      codecId: PG_NUMERIC_CODEC_ID,
      typeParams: { precision: 1.5, scale: 2 },
    });

    expect(result).toBe('numeric');
  });

  it('expands temporal precision types', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'time',
      codecId: PG_TIME_CODEC_ID,
      typeParams: { precision: 6 },
    });

    expect(result).toBe('time(6)');
  });

  it('returns nativeType for invalid temporal precision', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'interval',
      codecId: PG_INTERVAL_CODEC_ID,
      typeParams: { precision: -2 },
    });

    expect(result).toBe('interval');
  });

  it('returns nativeType for unknown codecId', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'custom',
      codecId: 'pg/custom@1',
      typeParams: { length: 2 },
    });

    expect(result).toBe('custom');
  });

  it('expands array type from elementNativeType param', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'int4[]',
      codecId: PG_ARRAY_CODEC_ID,
      typeParams: { element: 'pg/int4@1', elementNativeType: 'int4' },
    });

    expect(result).toBe('int4[]');
  });

  it('returns nativeType for array when elementNativeType missing', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'text[]',
      codecId: PG_ARRAY_CODEC_ID,
      typeParams: { element: 'pg/text@1' },
    });

    expect(result).toBe('text[]');
  });

  it('constructs array nativeType from elementNativeType when nativeType lacks suffix', () => {
    const result = expandParameterizedNativeType({
      nativeType: 'timestamp',
      codecId: PG_ARRAY_CODEC_ID,
      typeParams: { element: 'pg/timestamp@1', elementNativeType: 'timestamp' },
    });

    expect(result).toBe('timestamp[]');
  });
});
