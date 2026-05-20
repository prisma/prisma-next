/**
 * Codec-aware schema-default comparison: the verifier round-trips the
 * introspected raw literal through the column's codec (`decodeJson` →
 * `renderSqlLiteral`) so canonical Postgres / SQLite literal forms (e.g.
 * `'9007199254740991'::bigint`, `'2024-01-15 10:30:00+00'::timestamptz`)
 * collapse to the same contract-side canonical form the codec produced at
 * emit time. Without codec dispatch the comparison reduces to string
 * normalisation, which is too weak to reconcile the two forms.
 */
import type { JsonValue } from '@prisma-next/contract/types';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { SchemaDefaultValueParser } from '../src/core/schema-verify/verify-sql-schema';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

function makeCodec(overrides: {
  readonly id: string;
  readonly decodeJson: (json: JsonValue) => unknown;
  readonly renderSqlLiteral: (value: unknown) => string;
}): Codec {
  const stub = {
    id: overrides.id,
    encode: async (v: unknown) => v,
    decode: async (v: unknown) => v,
    encodeJson: (v: unknown) => v as JsonValue,
    decodeJson: overrides.decodeJson,
    renderSqlLiteral: overrides.renderSqlLiteral,
  };
  return stub as unknown as Codec;
}

function makeLookup(map: Record<string, Codec>): CodecLookup {
  return {
    get: (id) => map[id],
    targetTypesFor: () => undefined,
    metaFor: () => undefined,
    renderOutputTypeFor: () => undefined,
  };
}

/**
 * Mimics `parsePostgresDefaultValue` shape: extracts the JS-comparable value
 * out of a raw Postgres literal (strip `::type` cast and outer quotes for
 * string forms; recognise bare numerics and booleans; normalise space-form
 * timestamps to ISO-8601 UTC so the timestamptz codec's strict `decodeJson`
 * accepts them).
 */
const testValueParser: SchemaDefaultValueParser = (
  rawDefault: string,
  nativeType: string,
): JsonValue | undefined => {
  const trimmed = rawDefault.trim();

  // Strip outer cast `::type` (possibly quoted)
  const stripCast = (s: string): string => {
    const m = s.match(/^(.*?)\s*::\s*(?:"[^"]+"|[\w\s]+)(?:\(\d+(?:,\d+)?\))?$/);
    return m?.[1] ?? s;
  };

  const inner = stripCast(trimmed);

  // Timestamp-like native types: parse the inner string as a Date, return
  // canonical ISO-8601 UTC form for the strict timestamptz codec.
  if (/timestamp/i.test(nativeType)) {
    const stringMatch = inner.match(/^'((?:[^']|'')*)'$/);
    const str = stringMatch?.[1] ?? inner;
    const date = new Date(str.replace(/''/g, "'"));
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  // Booleans
  if (/^true$/i.test(inner)) return true;
  if (/^false$/i.test(inner)) return false;

  // Numerics: bare `9007199254740991` OR quoted `'9007199254740991'`
  const numericMatch = inner.match(/^'?(-?\d+(?:\.\d+)?)'?$/);
  if (numericMatch?.[1] !== undefined) {
    if (/^(?:int|bigint|smallint|numeric|float|real|double)/i.test(nativeType)) {
      const n = Number(numericMatch[1]);
      if (Number.isFinite(n)) return n;
    }
  }

  // JSON literals: `'{...}'::jsonb` → parsed object
  if (/json/i.test(nativeType)) {
    const stringMatch = inner.match(/^'((?:[^']|'')*)'$/);
    if (stringMatch?.[1] !== undefined) {
      try {
        return JSON.parse(stringMatch[1].replace(/''/g, "'"));
      } catch {
        return undefined;
      }
    }
  }

  // Quoted strings: strip outer quotes
  const stringMatch = inner.match(/^'((?:[^']|'')*)'$/);
  if (stringMatch?.[1] !== undefined) {
    return stringMatch[1].replace(/''/g, "'");
  }

  return undefined;
};

const bigintCodec = makeCodec({
  id: 'pg/int8@1',
  decodeJson: (json) => json,
  renderSqlLiteral: (value) => String(value),
});

const timestamptzCodec = makeCodec({
  id: 'pg/timestamptz@1',
  decodeJson: (json) => {
    if (typeof json !== 'string') throw new Error('expected ISO string');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(json)) {
      throw new Error(`Invalid ISO timestamp: ${json}`);
    }
    return new Date(json);
  },
  renderSqlLiteral: (value) => {
    const date = value as Date;
    return `'${date.toISOString()}'::timestamp with time zone`;
  },
});

const jsonbCodec = makeCodec({
  id: 'pg/jsonb@1',
  decodeJson: (json) => json,
  renderSqlLiteral: (value) => `'${JSON.stringify(value)}'::jsonb`,
});

const boolCodec = makeCodec({
  id: 'pg/bool@1',
  decodeJson: (json) => json,
  renderSqlLiteral: (value) => (value ? 'TRUE' : 'FALSE'),
});

const int4Codec = makeCodec({
  id: 'pg/int4@1',
  decodeJson: (json) => json,
  renderSqlLiteral: (value) => String(value),
});

describe('verifySqlSchema — codec-aware default comparison', () => {
  it('treats bigint contract default as equal to quoted-cast Postgres form via codec round-trip', () => {
    const contract = createTestContract({
      literal_defaults: createContractTable({
        big_count: {
          nativeType: 'bigint',
          codecId: 'pg/int8@1',
          nullable: false,
          default: { kind: 'expression', expression: '9007199254740991' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      literal_defaults: createSchemaTable('literal_defaults', {
        big_count: {
          nativeType: 'bigint',
          nullable: false,
          default: "'9007199254740991'::bigint",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({ 'pg/int8@1': bigintCodec }),
      parseSchemaDefaultValue: testValueParser,
    });

    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('treats timestamptz contract default as equal to space-separated Postgres form via codec round-trip', () => {
    const contract = createTestContract({
      event: createContractTable({
        scheduled_at: {
          nativeType: 'timestamp with time zone',
          codecId: 'pg/timestamptz@1',
          nullable: false,
          default: {
            kind: 'expression',
            expression: "'2024-01-15T10:30:00.000Z'::timestamp with time zone",
          },
        },
      }),
    });

    const schema = createTestSchemaIR({
      event: createSchemaTable('event', {
        scheduled_at: {
          nativeType: 'timestamp with time zone',
          nullable: false,
          default: "'2024-01-15 10:30:00+00'::timestamp with time zone",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({ 'pg/timestamptz@1': timestamptzCodec }),
      parseSchemaDefaultValue: testValueParser,
    });

    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('reports default_mismatch when codec round-trip produces a different canonical form', () => {
    const contract = createTestContract({
      event: createContractTable({
        scheduled_at: {
          nativeType: 'timestamp with time zone',
          codecId: 'pg/timestamptz@1',
          nullable: false,
          default: {
            kind: 'expression',
            expression: "'2024-01-15T10:30:00.000Z'::timestamp with time zone",
          },
        },
      }),
    });

    const schema = createTestSchemaIR({
      event: createSchemaTable('event', {
        scheduled_at: {
          nativeType: 'timestamp with time zone',
          nullable: false,
          default: "'2099-12-31 23:59:59+00'::timestamp with time zone",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({ 'pg/timestamptz@1': timestamptzCodec }),
      parseSchemaDefaultValue: testValueParser,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'default_mismatch',
        table: 'event',
        column: 'scheduled_at',
      }),
    );
  });

  it('treats JSONB defaults as equal even when schema returns the object with reordered keys', () => {
    const contract = createTestContract({
      literal_defaults: createContractTable({
        payload: {
          nativeType: 'jsonb',
          codecId: 'pg/jsonb@1',
          nullable: false,
          default: { kind: 'expression', expression: '\'{"a":1,"b":2}\'::jsonb' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      literal_defaults: createSchemaTable('literal_defaults', {
        payload: {
          nativeType: 'jsonb',
          nullable: false,
          // Postgres reserialised the JSONB with reordered keys
          default: '\'{"b":2,"a":1}\'::jsonb',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({ 'pg/jsonb@1': jsonbCodec }),
      parseSchemaDefaultValue: testValueParser,
    });

    // Both sides decode to a structurally equal object; codec.renderSqlLiteral
    // re-serialises both through `JSON.stringify` so the canonicals collapse to
    // the same key order (the one JSON.stringify produces on the parsed object).
    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('treats autoincrement contract default as equal to nextval schema default via the per-target normalizer', () => {
    // Autoincrement round-trip: contract `{ kind: 'autoincrement' }` against
    // Postgres-introspected `nextval('seq_name'::regclass)` form. The
    // existing per-target `normalizeDefault` path produces `{ kind:
    // 'autoincrement' }` from the raw default; the codec-aware compare
    // short-circuits to the autoincrement kind-equality branch before any
    // codec round-trip is attempted.
    const contract = createTestContract({
      literal_defaults: createContractTable({
        id: {
          nativeType: 'integer',
          codecId: 'pg/int4@1',
          nullable: false,
          default: { kind: 'autoincrement' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      literal_defaults: createSchemaTable('literal_defaults', {
        id: {
          nativeType: 'integer',
          nullable: false,
          default: "nextval('literal_defaults_id_seq'::regclass)",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({ 'pg/int4@1': int4Codec }),
      parseSchemaDefaultValue: testValueParser,
      normalizeDefault: (raw) =>
        /^nextval\s*\(/i.test(raw.trim()) ? { kind: 'autoincrement' } : undefined,
    });

    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('treats bool contract default TRUE as equal to schema-side bare true via codec round-trip', () => {
    const contract = createTestContract({
      literal_defaults: createContractTable({
        active: {
          nativeType: 'boolean',
          codecId: 'pg/bool@1',
          nullable: false,
          default: { kind: 'expression', expression: 'TRUE' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      literal_defaults: createSchemaTable('literal_defaults', {
        active: {
          nativeType: 'boolean',
          nullable: false,
          default: 'true',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({ 'pg/bool@1': boolCodec }),
      parseSchemaDefaultValue: testValueParser,
    });

    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('falls back to the legacy normalizer path when no codec or parser is supplied', () => {
    // No codecLookup or parseSchemaDefaultValue → the function must behave
    // exactly as it did before D9 (string-normalised compare via the
    // optional normalizer).
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          nullable: false,
          default: { kind: 'expression', expression: 'draft' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: 'draft' },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('falls back to the legacy normalizer path when the column codec is not in the lookup', () => {
    // Codec lookup misses → codec-aware compare cannot run; verifier falls
    // back to the legacy normalizer path so unknown codecs degrade
    // gracefully rather than reporting spurious mismatches.
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          codecId: 'pg/unknown@1',
          nullable: false,
          default: { kind: 'expression', expression: 'draft' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: { nativeType: 'text', nullable: false, default: "'draft'::text" },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      codecLookup: makeLookup({}),
      parseSchemaDefaultValue: testValueParser,
      normalizeDefault: (raw) => {
        const m = raw.trim().match(/^'((?:[^']|'')*)'(?:::.+)?$/);
        return m?.[1] !== undefined
          ? { kind: 'expression', expression: m[1].replace(/''/g, "'") }
          : { kind: 'expression', expression: raw.trim() };
      },
    });

    expect(result.schema.issues).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
});
