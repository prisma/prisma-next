import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

describe('PostgresControlAdapter', () => {
  it('has correct familyId and targetId', () => {
    const adapter = new PostgresControlAdapter();
    expect(adapter.familyId).toBe('sql');
    expect(adapter.targetId).toBe('postgres');
    expect(adapter.target).toBe('postgres');
  });

  describe('introspect', () => {
    it('introspects empty schema', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>() => ({ rows: [] as Row[] }),
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result).toEqual({
        tables: {},
        enums: {},
        extensions: [],
        annotations: {
          pg: {
            schema: 'public',
            version: expect.any(String),
          },
        },
      });
    });

    it('introspects schema with tables and columns', async () => {
      const adapter = new PostgresControlAdapter();
      let _queryCallCount = 0;
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          _queryCallCount++;
          if (sql.includes('information_schema.tables')) {
            return {
              rows: [{ table_name: 'user' }] as Row[],
            };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  column_name: 'email',
                  data_type: 'character varying',
                  udt_name: 'varchar',
                  is_nullable: 'NO',
                  character_maximum_length: 255,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
          }
          if (sql.includes('PRIMARY KEY')) {
            return {
              rows: [
                {
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1 on x86_64-pc-linux-gnu' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables).toHaveProperty('user');
      expect(result.tables['user']?.columns).toHaveProperty('id');
      expect(result.tables['user']?.columns).toHaveProperty('email');
      expect(result.tables['user']?.columns['id']?.nativeType).toBe('int4');
      expect(result.tables['user']?.columns['email']?.nativeType).toBe('character varying(255)');
      expect(result.tables['user']?.columns['id']?.nullable).toBe(false);
      expect(result.tables['user']?.primaryKey).toEqual({
        columns: ['id'],
        name: 'user_pkey',
      });
    });

    it('handles character varying without length', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'text_col',
                  data_type: 'character varying',
                  udt_name: 'varchar',
                  is_nullable: 'YES',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.columns['text_col']?.nativeType).toBe('character varying');
    });

    it('handles numeric with precision and scale', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'price',
                  data_type: 'numeric',
                  udt_name: 'numeric',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: 10,
                  numeric_scale: 2,
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.columns['price']?.nativeType).toBe('numeric(10,2)');
    });

    it('handles numeric with precision only', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'amount',
                  data_type: 'numeric',
                  udt_name: 'numeric',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: 10,
                  numeric_scale: null,
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.columns['amount']?.nativeType).toBe('numeric(10)');
    });

    it('handles numeric without precision', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'value',
                  data_type: 'numeric',
                  udt_name: 'numeric',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.columns['value']?.nativeType).toBe('numeric');
    });

    it('handles foreign keys', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'post' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  column_name: 'user_id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
          }
          if (sql.includes('PRIMARY KEY')) {
            return {
              rows: [
                {
                  constraint_name: 'post_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
          }
          if (sql.includes('FOREIGN KEY')) {
            return {
              rows: [
                {
                  constraint_name: 'post_user_id_fkey',
                  column_name: 'user_id',
                  ordinal_position: 1,
                  referenced_table_schema: 'public',
                  referenced_table_name: 'user',
                  referenced_column_name: 'id',
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['post']?.foreignKeys).toHaveLength(1);
      expect(result.tables['post']?.foreignKeys[0]).toEqual({
        columns: ['user_id'],
        referencedTable: 'user',
        referencedColumns: ['id'],
        name: 'post_user_id_fkey',
      });
    });

    it('handles unique constraints', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  column_name: 'email',
                  data_type: 'character varying',
                  udt_name: 'varchar',
                  is_nullable: 'NO',
                  character_maximum_length: 255,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
          }
          // Check for PRIMARY KEY query first (more specific)
          if (
            sql.includes("constraint_type = 'PRIMARY KEY'") &&
            !sql.includes("constraint_type = 'UNIQUE'")
          ) {
            return {
              rows: [
                {
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
          }
          if (sql.includes('FOREIGN KEY')) {
            return { rows: [] as Row[] };
          }
          // Check for UNIQUE query (excludes primary keys) - must have both UNIQUE constraint_type and NOT IN
          if (sql.includes("constraint_type = 'UNIQUE'") && sql.includes('NOT IN')) {
            return {
              rows: [
                {
                  constraint_name: 'user_email_key',
                  column_name: 'email',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.uniques).toHaveLength(1);
      expect(result.tables['user']?.uniques[0]).toEqual({
        columns: ['email'],
        name: 'user_email_key',
      });
    });

    it('handles indexes', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  column_name: 'name',
                  data_type: 'character varying',
                  udt_name: 'varchar',
                  is_nullable: 'NO',
                  character_maximum_length: 255,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
          }
          if (sql.includes('PRIMARY KEY')) {
            return {
              rows: [
                {
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
          }
          if (sql.includes('FOREIGN KEY')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('UNIQUE')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return {
              rows: [
                {
                  indexname: 'user_name_idx',
                  indisunique: false,
                  attname: 'name',
                  attnum: 2,
                },
              ] as Row[],
            };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.indexes).toHaveLength(1);
      expect(result.tables['user']?.indexes[0]).toEqual({
        columns: ['name'],
        name: 'user_name_idx',
        unique: false,
      });
    });

    it('skips index rows with null attname', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
          }
          if (sql.includes('PRIMARY KEY')) {
            return {
              rows: [
                {
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
          }
          if (sql.includes('FOREIGN KEY')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('UNIQUE')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return {
              rows: [
                {
                  indexname: 'user_idx',
                  indisunique: false,
                  attname: null,
                  attnum: 0,
                },
                {
                  indexname: 'user_idx',
                  indisunique: false,
                  attname: 'id',
                  attnum: 1,
                },
              ] as Row[],
            };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.indexes).toHaveLength(1);
      expect(result.tables['user']?.indexes[0]?.columns).toEqual(['id']);
    });

    it('handles extensions', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return {
              rows: [{ extname: 'uuid-ossp' }, { extname: 'pgcrypto' }] as Row[],
            };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.extensions).toEqual(['uuid-ossp', 'pgcrypto']);
    });

    it('handles custom schema name', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            expect(sql).toContain('$1');
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver, undefined, 'custom_schema');

      expect(result.annotations?.['pg']).toMatchObject({ schema: 'custom_schema' });
    });

    it('handles version string without match', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'Unknown database version' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.annotations?.['pg']).toMatchObject({ version: 'unknown' });
    });

    it('handles missing version result', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return { rows: [] as Row[] };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.annotations?.['pg']).toMatchObject({ version: 'unknown' });
    });

    it('handles table without primary key', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
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
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.primaryKey).toBeUndefined();
    });

    it('handles primary key without constraint name', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as Row[],
            };
          }
          if (sql.includes('PRIMARY KEY')) {
            return {
              rows: [
                {
                  constraint_name: '',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as Row[],
            };
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
          if (sql.includes('pg_enum')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.primaryKey).toEqual({
        columns: ['id'],
      });
      expect(result.tables['user']?.primaryKey?.name).toBeUndefined();
    });

    it('introspects enum types', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_enum')) {
            return {
              rows: [
                { enum_name: 'role', enum_value: 'USER', sort_order: 1 },
                { enum_name: 'role', enum_value: 'ADMIN', sort_order: 2 },
                { enum_name: 'role', enum_value: 'MODERATOR', sort_order: 3 },
                { enum_name: 'status', enum_value: 'ACTIVE', sort_order: 1 },
                { enum_name: 'status', enum_value: 'INACTIVE', sort_order: 2 },
              ] as Row[],
            };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.enums).toBeDefined();
      expect(result.enums?.['role']).toEqual({
        name: 'role',
        values: ['USER', 'ADMIN', 'MODERATOR'],
      });
      expect(result.enums?.['status']).toEqual({
        name: 'status',
        values: ['ACTIVE', 'INACTIVE'],
      });
    });

    it('preserves enum value order from pg_enum', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_enum')) {
            // Values returned out of order to verify sorting
            return {
              rows: [
                { enum_name: 'priority', enum_value: 'HIGH', sort_order: 2 },
                { enum_name: 'priority', enum_value: 'LOW', sort_order: 1 },
                { enum_name: 'priority', enum_value: 'CRITICAL', sort_order: 3 },
              ] as Row[],
            };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.enums?.['priority']?.values).toEqual(['LOW', 'HIGH', 'CRITICAL']);
    });

    it('returns empty enums when no enum types exist', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver: ControlDriverInstance<'sql', 'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('pg_enum')) {
            return { rows: [] as Row[] };
          }
          if (sql.includes('version()')) {
            return {
              rows: [{ version: 'PostgreSQL 15.1' }] as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.enums).toEqual({});
    });
  });
});
