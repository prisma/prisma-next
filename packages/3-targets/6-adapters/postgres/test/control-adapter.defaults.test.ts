import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

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
      return { rows: columns as Row[] };
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
  it('parses common default expressions', async () => {
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

    expect(columns['id']).toMatchObject({
      default: { kind: 'function', expression: 'autoincrement()' },
    });
    expect(columns['created_at']).toMatchObject({
      default: { kind: 'function', expression: 'now()' },
    });
    expect(columns['updated_at']).toMatchObject({
      default: { kind: 'function', expression: 'now()' },
    });
    expect(columns['tracked_at']).toMatchObject({
      default: { kind: 'function', expression: 'now()' },
    });
    expect(columns['uuid']).toMatchObject({
      default: { kind: 'function', expression: 'uuid()' },
    });
    expect(columns['active']).toMatchObject({
      default: { kind: 'literal', value: true },
    });
    expect(columns['disabled']).toMatchObject({
      default: { kind: 'literal', value: false },
    });
    expect(columns['count']).toMatchObject({
      default: { kind: 'literal', value: 42 },
    });
    expect(columns['ratio']).toMatchObject({
      default: { kind: 'literal', value: 3.14 },
    });
    expect(columns['name']).toMatchObject({
      default: { kind: 'literal', value: "Hello's" },
    });
    expect(columns['note']).toMatchObject({
      default: { kind: 'literal', value: 'plain text' },
    });
    expect(columns['fallback']).toMatchObject({
      default: { kind: 'function', expression: 'uuid_generate_v4()' },
    });
    expect(columns['no_default']).not.toHaveProperty('default');
  });
});
