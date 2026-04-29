import type { Ctx } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  bitCodecForLength,
  charCodecForLength,
  intervalCodecForPrecision,
  numericCodecForParams,
  pgJsonbValueFactory,
  pgJsonValueFactory,
  timeCodecForPrecision,
  timestampCodecForPrecision,
  timestamptzCodecForPrecision,
  timetzCodecForPrecision,
  varbitCodecForLength,
  varcharCodecForLength,
} from '../src/core/parameterized-codec-factories';

const ctx: Ctx = { name: '<anon:T.c>', usedAt: [{ table: 'T', column: 'c' }] };

describe('charCodecForLength', () => {
  it('decode trims trailing CHAR padding', () => {
    const codec = charCodecForLength(8)(ctx);
    expect(codec.decode('hi      ')).toBe('hi');
  });

  it('encode passes the value through', () => {
    const codec = charCodecForLength(8)(ctx);
    expect(codec.encode?.('hi' as never)).toBe('hi');
  });

  it('reports id, traits, and targetTypes', () => {
    const codec = charCodecForLength(36)(ctx);
    expect(codec.id).toBe('pg/char@1');
    expect(codec.traits).toEqual(['equality', 'order', 'textual']);
    expect(codec.targetTypes).toEqual(['character']);
  });

  it('json round-trip is identity', () => {
    const codec = charCodecForLength(8)(ctx);
    const value = 'hi      ';
    expect(codec.encodeJson(value as never)).toBe(value);
    expect(codec.decodeJson(value)).toBe(value);
  });
});

describe('varcharCodecForLength', () => {
  it('decode passes wire through (no padding to trim)', () => {
    const codec = varcharCodecForLength(64)(ctx);
    expect(codec.decode('hello')).toBe('hello');
  });

  it('encode passes the value through', () => {
    const codec = varcharCodecForLength(64)(ctx);
    expect(codec.encode?.('hello' as never)).toBe('hello');
  });

  it('reports id and targetTypes', () => {
    const codec = varcharCodecForLength(64)(ctx);
    expect(codec.id).toBe('pg/varchar@1');
    expect(codec.targetTypes).toEqual(['character varying']);
  });
});

describe('bitCodecForLength', () => {
  it('round-trips a bit string', () => {
    const codec = bitCodecForLength(8)(ctx);
    expect(codec.encode?.('10101010' as never)).toBe('10101010');
    expect(codec.decode('10101010')).toBe('10101010');
  });

  it('reports id, traits, and targetTypes', () => {
    const codec = bitCodecForLength(8)(ctx);
    expect(codec.id).toBe('pg/bit@1');
    expect(codec.traits).toEqual(['equality', 'order']);
    expect(codec.targetTypes).toEqual(['bit']);
  });

  it('json round-trip is identity', () => {
    const codec = bitCodecForLength(8)(ctx);
    expect(codec.encodeJson('10101010' as never)).toBe('10101010');
    expect(codec.decodeJson('10101010')).toBe('10101010');
  });
});

describe('varbitCodecForLength', () => {
  it('round-trips a bit-varying string', () => {
    const codec = varbitCodecForLength(16)(ctx);
    expect(codec.encode?.('1010' as never)).toBe('1010');
    expect(codec.decode('1010')).toBe('1010');
  });

  it('targetTypes is bit varying', () => {
    const codec = varbitCodecForLength(16)(ctx);
    expect(codec.targetTypes).toEqual(['bit varying']);
  });

  it('json round-trip is identity', () => {
    const codec = varbitCodecForLength(16)(ctx);
    expect(codec.encodeJson('1010' as never)).toBe('1010');
    expect(codec.decodeJson('1010')).toBe('1010');
  });
});

describe('numericCodecForParams', () => {
  it('decode normalizes a number wire to string', () => {
    const codec = numericCodecForParams(10, 2)(ctx);
    // The factory accepts both `string` and `number` wires; the Codec
    // interface's `decode` is typed against `string`. Cast at the call site.
    expect((codec.decode as (wire: string | number) => string)(1.5)).toBe('1.5');
  });

  it('decode passes a string wire through', () => {
    const codec = numericCodecForParams(10, 2)(ctx);
    expect(codec.decode('1.5')).toBe('1.5');
  });

  it('encode passes a value through', () => {
    const codec = numericCodecForParams(10)(ctx);
    expect(codec.encode?.('1.5' as never)).toBe('1.5');
  });

  it('targetTypes includes both numeric aliases', () => {
    const codec = numericCodecForParams(10, 2)(ctx);
    expect(codec.id).toBe('pg/numeric@1');
    expect(codec.targetTypes).toEqual(['numeric', 'decimal']);
    expect(codec.traits).toEqual(['equality', 'order', 'numeric']);
  });

  it('json round-trip is identity', () => {
    const codec = numericCodecForParams(10, 2)(ctx);
    expect(codec.encodeJson('1.5' as never)).toBe('1.5');
    expect(codec.decodeJson('1.5')).toBe('1.5');
  });
});

describe('timestampCodecForPrecision', () => {
  it('decode normalizes a Date instance to ISO string', () => {
    const codec = timestampCodecForPrecision(3)(ctx);
    const date = new Date('2026-01-15T10:30:00.000Z');
    expect(codec.decode(date)).toBe('2026-01-15T10:30:00.000Z');
  });

  it('decode passes a string wire through', () => {
    const codec = timestampCodecForPrecision(3)(ctx);
    expect(codec.decode('2026-01-15 10:30:00')).toBe('2026-01-15 10:30:00');
  });

  it('encode passes the value through', () => {
    const codec = timestampCodecForPrecision(3)(ctx);
    expect(codec.encode?.('2026-01-15' as never)).toBe('2026-01-15');
  });

  it('reports id and targetTypes', () => {
    const codec = timestampCodecForPrecision(undefined)(ctx);
    expect(codec.id).toBe('pg/timestamp@1');
    expect(codec.targetTypes).toEqual(['timestamp']);
  });
});

describe('timestamptzCodecForPrecision', () => {
  it('decode normalizes a Date instance to ISO string', () => {
    const codec = timestamptzCodecForPrecision(6)(ctx);
    const date = new Date('2026-01-15T10:30:00.000Z');
    expect(codec.decode(date)).toBe('2026-01-15T10:30:00.000Z');
  });

  it('decode passes a string wire through', () => {
    const codec = timestamptzCodecForPrecision(6)(ctx);
    expect(codec.decode('2026-01-15 10:30:00+00')).toBe('2026-01-15 10:30:00+00');
  });

  it('reports id and targetTypes', () => {
    const codec = timestamptzCodecForPrecision(undefined)(ctx);
    expect(codec.id).toBe('pg/timestamptz@1');
    expect(codec.targetTypes).toEqual(['timestamptz']);
  });

  it('json round-trip is identity', () => {
    const codec = timestamptzCodecForPrecision(6)(ctx);
    expect(codec.encodeJson('2026-01-15T10:30:00.000Z' as never)).toBe('2026-01-15T10:30:00.000Z');
    expect(codec.decodeJson('2026-01-15T10:30:00.000Z')).toBe('2026-01-15T10:30:00.000Z');
  });
});

describe('timestampCodecForPrecision json surface', () => {
  it('json round-trip is identity', () => {
    const codec = timestampCodecForPrecision(3)(ctx);
    expect(codec.encodeJson('2026-01-15T10:30:00.000Z' as never)).toBe('2026-01-15T10:30:00.000Z');
    expect(codec.decodeJson('2026-01-15T10:30:00.000Z')).toBe('2026-01-15T10:30:00.000Z');
  });
});

describe('timeCodecForPrecision', () => {
  it('round-trips a time string', () => {
    const codec = timeCodecForPrecision(0)(ctx);
    expect(codec.encode?.('10:30:00' as never)).toBe('10:30:00');
    expect(codec.decode('10:30:00')).toBe('10:30:00');
  });

  it('reports id and targetTypes', () => {
    const codec = timeCodecForPrecision(0)(ctx);
    expect(codec.id).toBe('pg/time@1');
    expect(codec.targetTypes).toEqual(['time']);
  });

  it('json round-trip is identity', () => {
    const codec = timeCodecForPrecision(0)(ctx);
    expect(codec.encodeJson('10:30:00' as never)).toBe('10:30:00');
    expect(codec.decodeJson('10:30:00')).toBe('10:30:00');
  });
});

describe('timetzCodecForPrecision', () => {
  it('round-trips a timetz string', () => {
    const codec = timetzCodecForPrecision(3)(ctx);
    expect(codec.encode?.('10:30:00+00' as never)).toBe('10:30:00+00');
    expect(codec.decode('10:30:00+00')).toBe('10:30:00+00');
  });

  it('reports id and targetTypes', () => {
    const codec = timetzCodecForPrecision(3)(ctx);
    expect(codec.id).toBe('pg/timetz@1');
    expect(codec.targetTypes).toEqual(['timetz']);
  });

  it('json round-trip is identity', () => {
    const codec = timetzCodecForPrecision(3)(ctx);
    expect(codec.encodeJson('10:30:00+00' as never)).toBe('10:30:00+00');
    expect(codec.decodeJson('10:30:00+00')).toBe('10:30:00+00');
  });
});

describe('intervalCodecForPrecision', () => {
  it('decode passes a string wire through', () => {
    const codec = intervalCodecForPrecision(6)(ctx);
    expect(codec.decode('1 day')).toBe('1 day');
  });

  it('decode JSON-stringifies a structured wire (postgres node-pg interval shape)', () => {
    const codec = intervalCodecForPrecision(6)(ctx);
    // node-pg's interval rows arrive as a `{ days, hours, … }` object; the
    // factory accepts both shapes. The Codec interface's `decode` is typed
    // against `string`; cast at the call site to exercise the structured
    // wire branch.
    expect((codec.decode as (wire: string | Record<string, unknown>) => string)({ days: 1 })).toBe(
      '{"days":1}',
    );
  });

  it('encode passes the value through', () => {
    const codec = intervalCodecForPrecision(6)(ctx);
    expect(codec.encode?.('1 day' as never)).toBe('1 day');
  });

  it('reports id and targetTypes', () => {
    const codec = intervalCodecForPrecision(undefined)(ctx);
    expect(codec.id).toBe('pg/interval@1');
    expect(codec.targetTypes).toEqual(['interval']);
  });

  it('json round-trip is identity', () => {
    const codec = intervalCodecForPrecision(6)(ctx);
    expect(codec.encodeJson('1 day' as never)).toBe('1 day');
    expect(codec.decodeJson('1 day')).toBe('1 day');
  });
});

describe('pgJsonValueFactory / pgJsonbValueFactory', () => {
  it('json factory encode JSON-stringifies and decode JSON.parses string wire', () => {
    const codec = pgJsonValueFactory(ctx);
    expect(codec.id).toBe('pg/json@1');
    expect(codec.targetTypes).toEqual(['json']);
    expect(codec.encode?.({ a: 1 })).toBe('{"a":1}');
    expect(codec.decode('{"a":1}')).toEqual({ a: 1 });
  });

  it('json factory decode passes through a non-string wire (driver may pre-parse)', () => {
    const codec = pgJsonValueFactory(ctx);
    expect(codec.decode({ a: 1 })).toEqual({ a: 1 });
  });

  it('json factory encodeJson / decodeJson are wire-level identity', () => {
    const codec = pgJsonValueFactory(ctx);
    expect(codec.encodeJson({ a: 1 })).toEqual({ a: 1 });
    expect(codec.decodeJson({ a: 1 })).toEqual({ a: 1 });
  });

  it('jsonb factory is the same shape keyed under pg/jsonb@1', () => {
    const codec = pgJsonbValueFactory(ctx);
    expect(codec.id).toBe('pg/jsonb@1');
    expect(codec.targetTypes).toEqual(['jsonb']);
    expect(codec.encode?.({ a: 1 })).toBe('{"a":1}');
    expect(codec.decode('{"a":1}')).toEqual({ a: 1 });
  });
});
