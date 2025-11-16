import type { ControlPlaneDriver } from '@prisma-next/core-control-plane/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { codec, createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { introspectPostgresSchema } from '../src/exports/introspect';

/**
 * Creates a mock ControlPlaneDriver for testing.
 * Matches queries by checking if the SQL contains the pattern (to handle multi-line queries).
 */
function createMockDriver(responses: Array<{ sql: string; rows: unknown[] }>): ControlPlaneDriver {
  let callIndex = 0;
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
      _params?: readonly unknown[],
    ): Promise<{ readonly rows: Row[] }> {
      // Normalize SQL for matching (remove whitespace)
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      // Find matching response by checking if SQL contains the pattern
      // Prefer more specific patterns (longer) over shorter ones
      const matchingResponses = responses
        .map((r, idx) => ({
          response: r,
          index: idx,
          pattern: r.sql.replace(/\s+/g, ' ').trim(),
        }))
        .filter(({ pattern }) => normalizedSql.includes(pattern) || pattern.includes(normalizedSql))
        .sort((a, b) => b.pattern.length - a.pattern.length); // Prefer longer (more specific) patterns

      const response = matchingResponses[0]?.response;

      if (!response) {
        throw new Error(`Unexpected query call ${callIndex}: ${sql.substring(0, 200)}`);
      }
      callIndex++;
      return { rows: response.rows as Row[] };
    },
    async close(): Promise<void> {
      // No-op
    },
  };
}

/**
 * Creates a minimal codec registry with test codecs.
 */
function createTestCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  registry.register(
    codec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (v: number) => v,
      meta: {
        db: {
          sql: {
            postgres: {
              nativeType: 'integer',
            },
          },
        },
      },
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/text@1',
      targetTypes: ['text'],
      encode: (v: string) => v,
      decode: (v: string) => v,
      meta: {
        db: {
          sql: {
            postgres: {
              nativeType: 'text',
            },
          },
        },
      },
    }),
  );
  registry.register(
    codec({
      typeId: 'pg/bool@1',
      targetTypes: ['bool'],
      encode: (v: boolean) => v,
      decode: (v: boolean) => v,
      meta: {
        db: {
          sql: {
            postgres: {
              nativeType: 'boolean',
            },
          },
        },
      },
    }),
  );
  return registry;
}

describe('introspectPostgresSchema', () => {
  it('introspects simple table with columns', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT table_name',
        rows: [{ table_name: 'user' }],
      },
      {
        sql: 'SELECT column_name, data_type, udt_name, is_nullable',
        rows: [
          { column_name: 'id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
          {
            column_name: 'email',
            data_type: 'character varying',
            udt_name: 'varchar',
            is_nullable: 'NO',
          },
        ],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name',
        rows: [{ column_name: 'id', constraint_name: 'user_pkey' }],
      },
      {
        sql: 'SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [],
      },
      {
        sql: 'SELECT i.relname',
        rows: [],
      },
      {
        sql: 'SELECT extname',
        rows: [],
      },
    ]);

    const codecRegistry = createTestCodecRegistry();
    const schemaIR = await introspectPostgresSchema(driver, codecRegistry);

    expect(schemaIR.tables).toHaveProperty('user');
    expect(schemaIR.tables['user']?.columns).toHaveProperty('id');
    expect(schemaIR.tables['user']?.columns['id']?.typeId).toBe('pg/int4@1');
    expect(schemaIR.tables['user']?.columns['id']?.nativeType).toBe('integer');
    expect(schemaIR.tables['user']?.columns['id']?.nullable).toBe(false);
    expect(schemaIR.tables['user']?.primaryKey).toEqual({ columns: ['id'], name: 'user_pkey' });
  });

  it('introspects table with foreign keys', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT table_name',
        rows: [{ table_name: 'post' }],
      },
      {
        sql: 'SELECT column_name, data_type, udt_name, is_nullable',
        rows: [
          { column_name: 'id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
          { column_name: 'user_id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
        ],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name',
        rows: [{ column_name: 'id', constraint_name: 'user_pkey' }],
      },
      {
        sql: 'SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [
          {
            column_name: 'user_id',
            foreign_table_name: 'user',
            foreign_column_name: 'id',
            constraint_name: 'post_user_id_fkey',
            ordinal_position: 1,
          },
        ],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [],
      },
      {
        sql: 'SELECT i.relname',
        rows: [],
      },
      {
        sql: 'SELECT extname',
        rows: [],
      },
    ]);

    const codecRegistry = createTestCodecRegistry();
    const schemaIR = await introspectPostgresSchema(driver, codecRegistry);

    expect(schemaIR.tables['post']?.foreignKeys).toHaveLength(1);
    expect(schemaIR.tables['post']?.foreignKeys[0]?.columns).toEqual(['user_id']);
    expect(schemaIR.tables['post']?.foreignKeys[0]?.referencedTable).toBe('user');
    expect(schemaIR.tables['post']?.foreignKeys[0]?.referencedColumns).toEqual(['id']);
  });

  it('introspects extensions', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT table_name',
        rows: [],
      },
      {
        sql: 'SELECT extname',
        rows: [{ extname: 'vector' }, { extname: 'uuid-ossp' }],
      },
    ]);

    const codecRegistry = createTestCodecRegistry();
    const schemaIR = await introspectPostgresSchema(driver, codecRegistry);

    expect(schemaIR.extensions).toContain('vector');
    expect(schemaIR.extensions).toContain('uuid-ossp');
  });

  it('maps database types to codec IDs using codec registry', async () => {
    const driver = createMockDriver([
      {
        sql: 'SELECT table_name',
        rows: [{ table_name: 'test' }],
      },
      {
        sql: 'SELECT column_name, data_type, udt_name, is_nullable',
        rows: [
          { column_name: 'id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO' },
          { column_name: 'name', data_type: 'text', udt_name: 'text', is_nullable: 'YES' },
          { column_name: 'active', data_type: 'boolean', udt_name: 'bool', is_nullable: 'NO' },
        ],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name',
        rows: [],
      },
      {
        sql: 'SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [],
      },
      {
        sql: 'SELECT kcu.column_name, tc.constraint_name, kcu.ordinal_position',
        rows: [],
      },
      {
        sql: 'SELECT i.relname',
        rows: [],
      },
      {
        sql: 'SELECT extname',
        rows: [],
      },
    ]);

    const codecRegistry = createTestCodecRegistry();
    const schemaIR = await introspectPostgresSchema(driver, codecRegistry);

    expect(schemaIR.tables['test']?.columns['id']?.typeId).toBe('pg/int4@1');
    expect(schemaIR.tables['test']?.columns['id']?.nativeType).toBe('integer');
    expect(schemaIR.tables['test']?.columns['name']?.typeId).toBe('pg/text@1');
    expect(schemaIR.tables['test']?.columns['name']?.nativeType).toBe('text');
    expect(schemaIR.tables['test']?.columns['name']?.nullable).toBe(true);
    expect(schemaIR.tables['test']?.columns['active']?.typeId).toBe('pg/bool@1');
    expect(schemaIR.tables['test']?.columns['active']?.nativeType).toBe('boolean');
  });
});
