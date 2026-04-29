import type { Ctx } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  allPostgresParameterizedCodecs,
  pgBitCodec,
  pgCharCodec,
  pgEnumCodec,
  pgIntervalCodec,
  pgJsonbLegacyCodec,
  pgJsonLegacyCodec,
  pgNumericCodec,
  pgTimeCodec,
  pgTimestampCodec,
  pgTimestamptzCodec,
  pgTimetzCodec,
  pgVarbitCodec,
  pgVarcharCodec,
  sqlCharCodec,
  sqlTimestampCodec,
  sqlVarcharCodec,
} from '../src/codecs/postgres-codec-descriptors';

const ctx: Ctx = { name: '<anon:T.c>', usedAt: [{ table: 'T', column: 'c' }] };

describe('descriptor factory invocations', () => {
  it('sqlCharCodec.factory yields a working pg/char@1 codec', () => {
    const codec = sqlCharCodec.factory({ length: 36 })(ctx);
    expect(codec.id).toBe('pg/char@1');
    expect(codec.decode('hi    ')).toBe('hi');
  });

  it('sqlVarcharCodec.factory yields a working pg/varchar@1 codec', () => {
    const codec = sqlVarcharCodec.factory({ length: 64 })(ctx);
    expect(codec.id).toBe('pg/varchar@1');
    expect(codec.decode('hello')).toBe('hello');
  });

  it('pgCharCodec.factory yields a working pg/char@1 codec', () => {
    const codec = pgCharCodec.factory({ length: 36 })(ctx);
    expect(codec.id).toBe('pg/char@1');
  });

  it('pgVarcharCodec.factory yields a working pg/varchar@1 codec', () => {
    const codec = pgVarcharCodec.factory({ length: 64 })(ctx);
    expect(codec.id).toBe('pg/varchar@1');
  });

  it('pgBitCodec.factory yields a working pg/bit@1 codec', () => {
    const codec = pgBitCodec.factory({ length: 8 })(ctx);
    expect(codec.id).toBe('pg/bit@1');
  });

  it('pgVarbitCodec.factory yields a working pg/varbit@1 codec', () => {
    const codec = pgVarbitCodec.factory({ length: 16 })(ctx);
    expect(codec.id).toBe('pg/varbit@1');
  });

  it('pgNumericCodec.factory passes both precision and scale through', () => {
    const codec = pgNumericCodec.factory({ precision: 10, scale: 2 })(ctx);
    expect(codec.id).toBe('pg/numeric@1');
    expect(codec.decode('1.5')).toBe('1.5');
  });

  it('pgNumericCodec.factory works with precision-only', () => {
    const codec = pgNumericCodec.factory({ precision: 10 })(ctx);
    expect(codec.id).toBe('pg/numeric@1');
  });

  it('sqlTimestampCodec.factory delegates to timestampCodecForPrecision (under the pg id)', () => {
    // The descriptor's `codecId` is `sql/timestamp@1` (registration key); the
    // resolved codec instance is the same one `timestampCodecForPrecision`
    // returns, which carries `id = 'pg/timestamp@1'`. The two id slots play
    // different roles — registration vs runtime identity — and intentionally
    // diverge here since the SQL codec aliases the postgres one.
    const codec = sqlTimestampCodec.factory({ precision: 3 })(ctx);
    expect(codec.id).toBe('pg/timestamp@1');
    expect(sqlTimestampCodec.codecId).toBe('sql/timestamp@1');
  });

  it('pgTimestampCodec.factory yields a working pg/timestamp@1 codec with no precision', () => {
    const codec = pgTimestampCodec.factory({})(ctx);
    expect(codec.id).toBe('pg/timestamp@1');
  });

  it('pgTimestamptzCodec.factory yields a working pg/timestamptz@1 codec', () => {
    const codec = pgTimestamptzCodec.factory({ precision: 6 })(ctx);
    expect(codec.id).toBe('pg/timestamptz@1');
  });

  it('pgTimeCodec.factory yields a working pg/time@1 codec', () => {
    const codec = pgTimeCodec.factory({ precision: 0 })(ctx);
    expect(codec.id).toBe('pg/time@1');
  });

  it('pgTimetzCodec.factory yields a working pg/timetz@1 codec', () => {
    const codec = pgTimetzCodec.factory({ precision: 3 })(ctx);
    expect(codec.id).toBe('pg/timetz@1');
  });

  it('pgIntervalCodec.factory yields a working pg/interval@1 codec', () => {
    const codec = pgIntervalCodec.factory({ precision: 6 })(ctx);
    expect(codec.id).toBe('pg/interval@1');
  });
});

describe('descriptor paramsSchema validation', () => {
  it('lengthParamsSchema accepts a positive integer', () => {
    const result = pgCharCodec.paramsSchema['~standard'].validate({ length: 36 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('lengthParamsSchema rejects a non-positive length', () => {
    const result = pgCharCodec.paramsSchema['~standard'].validate({ length: 0 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });

  it('precisionParamsSchema accepts an absent precision', () => {
    const result = pgTimestampCodec.paramsSchema['~standard'].validate({});
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('precisionParamsSchema rejects an out-of-range precision', () => {
    const result = pgTimestampCodec.paramsSchema['~standard'].validate({ precision: 99 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });

  it('numericParamsSchema accepts precision + scale', () => {
    const result = pgNumericCodec.paramsSchema['~standard'].validate({ precision: 10, scale: 2 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('numericParamsSchema rejects negative precision', () => {
    const result = pgNumericCodec.paramsSchema['~standard'].validate({ precision: -1 });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });

  it('enumParamsSchema accepts a string array', () => {
    const result = pgEnumCodec.paramsSchema['~standard'].validate({ values: ['A', 'B'] });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('enumParamsSchema rejects non-array values', () => {
    const result = pgEnumCodec.paramsSchema['~standard'].validate({ values: 'A' });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeDefined();
  });
});

describe('placeholder factories (registration-only)', () => {
  it('pgEnumCodec.factory throws when invoked (legacy registry owns enum runtime)', () => {
    const factory = pgEnumCodec.factory({ values: ['A', 'B'] });
    expect(() => factory(ctx)).toThrow(/registration-only/);
  });

  it('pgJsonLegacyCodec.factory throws when invoked (runtime descriptor owns instantiation)', () => {
    const factory = pgJsonLegacyCodec.factory({ schemaJson: { type: 'object' } });
    expect(() => factory(ctx)).toThrow(/registration-only/);
  });

  it('pgJsonbLegacyCodec.factory throws when invoked', () => {
    const factory = pgJsonbLegacyCodec.factory({ schemaJson: { type: 'object' } });
    expect(() => factory(ctx)).toThrow(/registration-only/);
  });
});

describe('legacy JSON / JSONB renderer (handles serialized typeParams)', () => {
  it('renders the `type` source string when present', () => {
    expect(pgJsonLegacyCodec.renderOutputType!({ type: 'AuditPayload' })).toBe('AuditPayload');
  });

  it('renders a TS type expression from the `schemaJson` when no `type` source is present', () => {
    const rendered = pgJsonLegacyCodec.renderOutputType!({
      schemaJson: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    });
    expect(rendered).toBe('{ name: string }');
  });

  it('returns "unknown" when neither `type` nor `schemaJson` are present', () => {
    expect(pgJsonLegacyCodec.renderOutputType!({})).toBe('unknown');
  });

  it('jsonb legacy renderer handles the same shapes', () => {
    expect(pgJsonbLegacyCodec.renderOutputType!({ type: 'Doc' })).toBe('Doc');
  });

  it('legacy paramsSchema accepts the serialized shape with both fields', () => {
    const result = pgJsonLegacyCodec.paramsSchema['~standard'].validate({
      schemaJson: { type: 'object' },
      type: 'AuditPayload',
    });
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });

  it('legacy paramsSchema accepts an empty params object', () => {
    const result = pgJsonLegacyCodec.paramsSchema['~standard'].validate({});
    if (result instanceof Promise) throw new Error('expected sync validator');
    expect(result.issues).toBeUndefined();
  });
});

describe('allPostgresParameterizedCodecs registry', () => {
  it('contains every parameterized Postgres codec id', () => {
    const ids = new Set(allPostgresParameterizedCodecs.map((d) => d.codecId));
    expect(ids).toContain('sql/char@1');
    expect(ids).toContain('sql/varchar@1');
    expect(ids).toContain('sql/timestamp@1');
    expect(ids).toContain('pg/char@1');
    expect(ids).toContain('pg/varchar@1');
    expect(ids).toContain('pg/numeric@1');
    expect(ids).toContain('pg/bit@1');
    expect(ids).toContain('pg/varbit@1');
    expect(ids).toContain('pg/timestamp@1');
    expect(ids).toContain('pg/timestamptz@1');
    expect(ids).toContain('pg/time@1');
    expect(ids).toContain('pg/timetz@1');
    expect(ids).toContain('pg/interval@1');
    expect(ids).toContain('pg/enum@1');
  });

  it('every entry exposes a renderOutputType function', () => {
    for (const descriptor of allPostgresParameterizedCodecs) {
      expect(typeof descriptor.renderOutputType).toBe('function');
    }
  });
});
