import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import { parsePostgresDefault } from '../src/core/default-normalizer';

const createMockDriver = (
  columns: Array<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    column_default: string | null;
  }>,
): ControlDriverInstance<'sql', 'postgres'> => ({
  familyId: 'sql',
  targetId: 'postgres',
  query: async <Row = Record<string, unknown>>(sql: string) => {
    if (sql.includes('information_schema.tables')) {
      return { rows: [{ table_name: 'user' }] as Row[] };
    }
    if (sql.includes('information_schema.columns')) {
      // Add table_name to each column for batched query grouping
      return { rows: columns.map((col) => ({ ...col, table_name: 'user' })) as Row[] };
    }
    if (sql.includes('PRIMARY KEY')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('FOREIGN KEY')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('UNIQUE')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('pg_indexes')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('pg_extension')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('version()')) {
      return { rows: [{ version: 'PostgreSQL 15.1' }] as Row[] };
    }
    return { rows: [] as Row[] };
  },
  close: async () => {},
});

describe('PostgresControlAdapter column defaults', () => {
  it('stores raw default expressions from database', async () => {
    const adapter = new PostgresControlAdapter();
    const mockDriver = createMockDriver([
      {
        column_name: 'id',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: "nextval('user_id_seq'::regclass)",
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp',
        udt_name: 'timestamp',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'now()',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp',
        udt_name: 'timestamp',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'CURRENT_TIMESTAMP',
      },
      {
        column_name: 'tracked_at',
        data_type: 'timestamp',
        udt_name: 'timestamp',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'clock_timestamp()',
      },
      {
        column_name: 'uuid',
        data_type: 'uuid',
        udt_name: 'uuid',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'gen_random_uuid()',
      },
      {
        column_name: 'active',
        data_type: 'boolean',
        udt_name: 'bool',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'true',
      },
      {
        column_name: 'disabled',
        data_type: 'boolean',
        udt_name: 'bool',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'false',
      },
      {
        column_name: 'count',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: '42',
      },
      {
        column_name: 'ratio',
        data_type: 'numeric',
        udt_name: 'numeric',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: 10,
        numeric_scale: 2,
        column_default: '3.14',
      },
      {
        column_name: 'name',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'NO',
        character_maximum_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        column_default: "'Hello''s'::text",
      },
      {
        column_name: 'note',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: "'plain text'",
      },
      {
        column_name: 'fallback',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'uuid_generate_v4()',
      },
      {
        column_name: 'no_default',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: null,
      },
    ]);

    const result = await adapter.introspect(mockDriver);
    const columns = result.tables['user']?.columns ?? {};

    // Defaults are stored as raw strings from the database
    expect(columns['id']).toMatchObject({
      default: "nextval('user_id_seq'::regclass)",
    });
    expect(columns['created_at']).toMatchObject({
      default: 'now()',
    });
    expect(columns['updated_at']).toMatchObject({
      default: 'CURRENT_TIMESTAMP',
    });
    expect(columns['tracked_at']).toMatchObject({
      default: 'clock_timestamp()',
    });
    expect(columns['uuid']).toMatchObject({
      default: 'gen_random_uuid()',
    });
    expect(columns['active']).toMatchObject({
      default: 'true',
    });
    expect(columns['disabled']).toMatchObject({
      default: 'false',
    });
    expect(columns['count']).toMatchObject({
      default: '42',
    });
    expect(columns['ratio']).toMatchObject({
      default: '3.14',
    });
    expect(columns['name']).toMatchObject({
      default: "'Hello''s'::text",
    });
    expect(columns['note']).toMatchObject({
      default: "'plain text'",
    });
    expect(columns['fallback']).toMatchObject({
      default: 'uuid_generate_v4()',
    });
    expect(columns['no_default']).not.toHaveProperty('default');
  });
});

describe('parsePostgresDefault normalizer', () => {
  it('normalizes common default expressions', () => {
    // Autoincrement patterns
    expect(parsePostgresDefault("nextval('user_id_seq'::regclass)")).toEqual({
      kind: 'function',
      expression: 'autoincrement()',
    });

    // Timestamp functions
    expect(parsePostgresDefault('now()')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(parsePostgresDefault('CURRENT_TIMESTAMP')).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(parsePostgresDefault('clock_timestamp()')).toEqual({
      kind: 'function',
      expression: 'now()',
    });

    // UUID function
    expect(parsePostgresDefault('gen_random_uuid()')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });

    // Boolean literals
    expect(parsePostgresDefault('true')).toEqual({
      kind: 'literal',
      value: true,
    });
    expect(parsePostgresDefault('false')).toEqual({
      kind: 'literal',
      value: false,
    });

    // Numeric literals
    expect(parsePostgresDefault('42')).toEqual({
      kind: 'literal',
      value: 42,
    });
    expect(parsePostgresDefault('3.14')).toEqual({
      kind: 'literal',
      value: 3.14,
    });
    expect(parsePostgresDefault('-123.45')).toEqual({
      kind: 'literal',
      value: -123.45,
    });

    // String literals (type casts are stripped)
    expect(parsePostgresDefault("'hello'::text")).toEqual({
      kind: 'literal',
      value: 'hello',
    });
    expect(parsePostgresDefault('\'ok\'::"BillingState"')).toEqual({
      kind: 'literal',
      value: 'ok',
    });
    expect(parsePostgresDefault("'Hello''s'::text")).toEqual({
      kind: 'literal',
      value: "Hello's",
    });
    expect(parsePostgresDefault("'plain text'")).toEqual({
      kind: 'literal',
      value: 'plain text',
    });

    // uuid_generate_v4() from uuid-ossp extension is normalized to gen_random_uuid()
    expect(parsePostgresDefault('uuid_generate_v4()')).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });
});

describe('parsePostgresDefault strips type casts from string literals', () => {
  it('strips ::text cast from simple string literal', () => {
    expect(parsePostgresDefault("'ready'::text")).toEqual({
      kind: 'literal',
      value: 'ready',
    });
  });

  it('strips ::character varying cast', () => {
    expect(parsePostgresDefault("'hello'::character varying")).toEqual({
      kind: 'literal',
      value: 'hello',
    });
  });

  it('strips ::character varying(255) cast with length', () => {
    expect(parsePostgresDefault("'hello'::character varying(255)")).toEqual({
      kind: 'literal',
      value: 'hello',
    });
  });

  it('strips quoted enum cast like ::"MyEnum"', () => {
    expect(parsePostgresDefault('\'active\'::"StatusEnum"')).toEqual({
      kind: 'literal',
      value: 'active',
    });
  });

  it('strips quoted camelCase enum cast like ::"EnvironmentModelKind"', () => {
    expect(parsePostgresDefault('\'ready\'::"EnvironmentModelKind"')).toEqual({
      kind: 'literal',
      value: 'ready',
    });
  });

  it('preserves plain string literal without cast', () => {
    expect(parsePostgresDefault("'plain text'")).toEqual({
      kind: 'literal',
      value: 'plain text',
    });
  });

  it('strips cast from string with escaped quotes', () => {
    expect(parsePostgresDefault("'it''s ready'::text")).toEqual({
      kind: 'literal',
      value: "it's ready",
    });
  });

  it('strips ::varchar cast', () => {
    expect(parsePostgresDefault("'default_value'::varchar")).toEqual({
      kind: 'literal',
      value: 'default_value',
    });
  });

  it('strips ::bpchar cast (blank-padded char)', () => {
    expect(parsePostgresDefault("'Y'::bpchar")).toEqual({
      kind: 'literal',
      value: 'Y',
    });
  });

  it('strips cast from empty string literal', () => {
    expect(parsePostgresDefault("''::text")).toEqual({
      kind: 'literal',
      value: '',
    });
  });
});

describe('parsePostgresDefault parses JSON literals for json/jsonb columns', () => {
  it('parses object literal for jsonb native type', () => {
    expect(parsePostgresDefault('\'{"key": "default"}\'::jsonb', 'jsonb')).toEqual({
      kind: 'literal',
      value: { key: 'default' },
    });
  });

  it('parses array literal for jsonb native type', () => {
    expect(parsePostgresDefault('\'["alpha", "beta"]\'::jsonb', 'jsonb')).toEqual({
      kind: 'literal',
      value: ['alpha', 'beta'],
    });
  });

  it('parses object literal for json native type', () => {
    expect(parsePostgresDefault('\'{"ok": true}\'::json', 'json')).toEqual({
      kind: 'literal',
      value: { ok: true },
    });
  });

  it('falls back to string when JSON parsing fails', () => {
    expect(parsePostgresDefault("'not-json'::jsonb", 'jsonb')).toEqual({
      kind: 'literal',
      value: 'not-json',
    });
  });
});
