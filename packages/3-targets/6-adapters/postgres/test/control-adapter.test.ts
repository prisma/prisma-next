import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

type QueryHandler = {
  readonly match: (sql: string) => boolean;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
};

function includes(fragment: string): (sql: string) => boolean {
  return (sql) => sql.includes(fragment);
}

function createMockDriver(
  handlers: ReadonlyArray<QueryHandler>,
): ControlDriverInstance<'sql', 'postgres'> {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row = Record<string, unknown>>(sql: string) => {
      const handler = handlers.find((entry) => entry.match(sql));
      return { rows: (handler?.rows ?? []) as Row[] };
    },
    close: async () => {},
  };
}

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
        extensions: [],
        annotations: {
          pg: {
            schema: 'public',
            version: expect.any(String),
          },
        },
      });
    });

    it('introspects enum storage types', async () => {
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
                {
                  schema_name: 'public',
                  type_name: 'role',
                  values: ['USER', 'ADMIN'],
                },
              ] as Row[],
            };
          }
          if (sql.includes('version()')) {
            return { rows: [{ version: 'PostgreSQL 16.1' }] as Row[] };
          }
          return { rows: [] as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.annotations?.['pg']).toMatchObject({
        storageTypes: {
          role: {
            codecId: 'pg/enum@1',
            nativeType: 'role',
            typeParams: { values: ['USER', 'ADMIN'] },
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
                  table_name: 'user',
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  table_name: 'user',
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
                  table_name: 'user',
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
          if (sql.includes('pg_enum')) {
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
                  table_name: 'user',
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
                  table_name: 'user',
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
                  table_name: 'user',
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
                  table_name: 'user',
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

    it('uses formatted_type for bit length', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'flags',
              data_type: 'bit',
              udt_name: 'bit',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'bit(8)',
            },
          ],
        },
        { match: includes('PRIMARY KEY'), rows: [] },
        { match: includes('FOREIGN KEY'), rows: [] },
        { match: includes('UNIQUE'), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('pg_enum'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.columns['flags']?.nativeType).toBe('bit(8)');
    });

    it('handles foreign keys', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'post' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'post',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'post',
              column_name: 'user_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes('PRIMARY KEY'),
          rows: [
            {
              table_name: 'post',
              constraint_name: 'post_pkey',
              column_name: 'id',
              ordinal_position: 1,
            },
          ],
        },
        {
          match: includes('FOREIGN KEY'),
          rows: [
            {
              table_name: 'post',
              constraint_name: 'post_user_id_fkey',
              column_name: 'user_id',
              ordinal_position: 1,
              referenced_table_schema: 'public',
              referenced_table_name: 'user',
              referenced_column_name: 'id',
            },
          ],
        },
        { match: includes('UNIQUE'), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['post']?.foreignKeys).toEqual([
        {
          columns: ['user_id'],
          referencedTable: 'user',
          referencedColumns: ['id'],
          name: 'post_user_id_fkey',
        },
      ]);
    });

    it('handles multi-column foreign keys', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'order' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'order',
              column_name: 'user_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'order',
              column_name: 'account_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes('PRIMARY KEY'),
          rows: [
            {
              table_name: 'order',
              constraint_name: 'order_pkey',
              column_name: 'user_id',
              ordinal_position: 1,
            },
          ],
        },
        {
          match: includes('FOREIGN KEY'),
          rows: [
            {
              table_name: 'order',
              constraint_name: 'order_account_fkey',
              column_name: 'user_id',
              ordinal_position: 1,
              referenced_table_schema: 'public',
              referenced_table_name: 'account',
              referenced_column_name: 'user_id',
            },
            {
              table_name: 'order',
              constraint_name: 'order_account_fkey',
              column_name: 'account_id',
              ordinal_position: 2,
              referenced_table_schema: 'public',
              referenced_table_name: 'account',
              referenced_column_name: 'id',
            },
          ],
        },
        { match: includes('UNIQUE'), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['order']?.foreignKeys).toEqual([
        {
          columns: ['user_id', 'account_id'],
          referencedTable: 'account',
          referencedColumns: ['user_id', 'id'],
          name: 'order_account_fkey',
        },
      ]);
    });

    it('handles unique constraints', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'email',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes('PRIMARY KEY'),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'id',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes('FOREIGN KEY'), rows: [] },
        {
          match: (sql) => sql.includes("constraint_type = 'UNIQUE'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_email_key',
              column_name: 'email',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.uniques).toEqual([
        {
          columns: ['email'],
          name: 'user_email_key',
        },
      ]);
    });

    it('handles multi-column unique constraints', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'email',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'tenant_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes('PRIMARY KEY'),
          rows: [],
        },
        { match: includes('FOREIGN KEY'), rows: [] },
        {
          match: (sql) => sql.includes("constraint_type = 'UNIQUE'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_email_tenant_key',
              column_name: 'email',
              ordinal_position: 1,
            },
            {
              table_name: 'user',
              constraint_name: 'user_email_tenant_key',
              column_name: 'tenant_id',
              ordinal_position: 2,
            },
          ],
        },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.uniques).toEqual([
        {
          columns: ['email', 'tenant_id'],
          name: 'user_email_tenant_key',
        },
      ]);
    });

    it('handles indexes', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'name',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes('PRIMARY KEY'),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'id',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes('FOREIGN KEY'), rows: [] },
        { match: includes('UNIQUE'), rows: [] },
        {
          match: includes('pg_indexes'),
          rows: [
            {
              tablename: 'user',
              indexname: 'user_name_idx',
              indisunique: false,
              attname: 'name',
              attnum: 2,
            },
          ],
        },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.indexes).toEqual([
        {
          columns: ['name'],
          name: 'user_name_idx',
          unique: false,
        },
      ]);
    });

    it('handles multi-column indexes', async () => {
      const adapter = new PostgresControlAdapter();
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'email',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'tenant_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes('PRIMARY KEY'),
          rows: [],
        },
        { match: includes('FOREIGN KEY'), rows: [] },
        { match: includes('UNIQUE'), rows: [] },
        {
          match: includes('pg_indexes'),
          rows: [
            {
              tablename: 'user',
              indexname: 'user_email_tenant_idx',
              indisunique: false,
              attname: 'email',
              attnum: 1,
            },
            {
              tablename: 'user',
              indexname: 'user_email_tenant_idx',
              indisunique: false,
              attname: 'tenant_id',
              attnum: 2,
            },
          ],
        },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('version()'), rows: [{ version: 'PostgreSQL 15.1' }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(result.tables['user']?.indexes).toEqual([
        {
          columns: ['email', 'tenant_id'],
          name: 'user_email_tenant_idx',
          unique: false,
        },
      ]);
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
                  table_name: 'user',
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
                  table_name: 'user',
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
                  tablename: 'user',
                  indexname: 'user_idx',
                  indisunique: false,
                  attname: null,
                  attnum: 0,
                },
                {
                  tablename: 'user',
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
                  table_name: 'user',
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
                  table_name: 'user',
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
                  table_name: 'user',
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
  });
});
