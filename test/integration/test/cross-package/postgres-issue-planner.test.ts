import { PostgresControlAdapter } from '@prisma-next/adapter-postgres/control';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import {
  type PostgresEnumStorageEntry,
  SqlStorage,
  type SqlStorageInput,
  type StorageTableInput,
} from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { planIssues } from '@prisma-next/target-postgres/issue-planner';
import type { CreateTableCall } from '@prisma-next/target-postgres/op-factory-call';
import { renderCallsToTypeScript } from '@prisma-next/target-postgres/render-typescript';
import {
  PostgresEnumType,
  PostgresSchema,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '@prisma-next/target-postgres/types';
import { applicationDomainOf } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

const testAdapter = new PostgresControlAdapter();

function makeContract(
  overrides: {
    entries?: {
      table?: Record<string, StorageTableInput>;
      type?: Record<string, PostgresEnumStorageEntry>;
    };
  } = {},
): Contract<SqlStorage> {
  const { table = {}, type } = overrides.entries ?? {};
  const unboundNs = postgresCreateNamespace(
    {
      id: UNBOUND_NAMESPACE_ID,
      entries: { table },
    },
    type,
  );
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:contract'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const defaultCtx = {
  schemaName: 'public',
  codecHooks: new Map(),
  storageTypes: {},
};

function makeSchemaWithEnum(
  nativeType: string,
  values: readonly string[],
  schemaName = UNBOUND_NAMESPACE_ID,
): SqlSchemaIR {
  // Introspection nests `enumTypes` by the *live* schema name the adapter
  // walked — the unbound coordinate resolves to `current_schema()` (`public`
  // here), never the `__unbound__` DDL-emit sentinel.
  const liveSchema = schemaName === UNBOUND_NAMESPACE_ID ? 'public' : schemaName;
  return {
    tables: {},
    annotations: {
      pg: {
        schema: liveSchema,
        enumTypes: {
          [liveSchema]: {
            [nativeType]: {
              kind: 'postgres-enum',
              codecId: 'pg/enum@1',
              nativeType,
              values,
              typeParams: { values },
            },
          },
        },
      },
    },
  };
}

describe('planIssues', () => {
  describe('missing_table', () => {
    it('emits CreateTableCall with columns', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        { kind: 'missing_table', table: 'user', message: 'Table "user" is missing' },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(1);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createTable',
        tableName: 'user',
        operationClass: 'additive',
      });
    });
  });

  describe('notNullBackfill call strategy', () => {
    it('emits AddColumnCall(nullable) + DataTransformCall + SetNotNullCall', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]).toMatchObject({ factoryName: 'addColumn' });
      expect(calls[1]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[2]).toMatchObject({ factoryName: 'setNotNull' });
    });

    it('DataTransformCall.toOp() throws PN-MIG-2001', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const dtCall = result.value.calls[1]!;
      expect(dtCall.factoryName).toBe('dataTransform');
      expect(() => dtCall.toOp()).toThrow(expect.objectContaining({ code: '2001', domain: 'MIG' }));
    });
  });

  describe('nullableTightening call strategy', () => {
    it('emits DataTransformCall + SetNotNullCall', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const fromContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'email',
          expected: 'NOT NULL',
          actual: 'NULL',
          message: 'Column "email" nullability mismatch: expected NOT NULL, got NULL',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'setNotNull' });
    });
  });

  describe('typeChange call strategy', () => {
    it('emits AlterColumnTypeCall for safe widening', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                age: { nativeType: 'int8', codecId: 'pg/int8@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const fromContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                age: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'type_mismatch',
          table: 'user',
          column: 'age',
          expected: 'int8',
          actual: 'int4',
          message: 'Type mismatch on "age"',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'alterColumnType' });
    });

    it('emits DataTransformCall + AlterColumnTypeCall for unsafe change', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                age: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const fromContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                age: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'type_mismatch',
          table: 'user',
          column: 'age',
          expected: 'text',
          actual: 'int4',
          message: 'Type mismatch on "age"',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'alterColumnType' });
    });
  });

  describe('enumChange call strategy', () => {
    it('emits AddEnumValuesCall for add-only', () => {
      const toContract = makeContract({
        entries: {
          table: {},
          type: {
            status: new PostgresEnumType({
              name: 'status',
              values: ['active', 'inactive', 'archived'],
            }),
          },
        },
      });
      const fromContract = makeContract({
        entries: {
          table: {},
          type: {
            status: new PostgresEnumType({
              name: 'status',
              values: ['active', 'inactive'],
            }),
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'enum_values_changed',
          namespaceId: UNBOUND_NAMESPACE_ID,
          typeName: 'status',
          addedValues: ['archived'],
          removedValues: [],
          message: 'Enum "status" values changed',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
        schema: makeSchemaWithEnum('status', ['active', 'inactive']),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'addEnumValues' });
    });

    it('emits DataTransformCall + rebuild recipe for removal', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: {
                  nativeType: 'status',
                  codecId: 'pg/enum@1',
                  nullable: false,
                  typeRef: 'status',
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          type: {
            status: new PostgresEnumType({
              name: 'status',
              values: ['active'],
            }),
          },
        },
      });
      const fromContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: {
                  nativeType: 'status',
                  codecId: 'pg/enum@1',
                  nullable: false,
                  typeRef: 'status',
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          type: {
            status: new PostgresEnumType({
              name: 'status',
              values: ['active', 'inactive'],
            }),
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'enum_values_changed',
          namespaceId: UNBOUND_NAMESPACE_ID,
          typeName: 'status',
          addedValues: [],
          removedValues: ['inactive'],
          message: 'Enum "status" values changed',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract,
        storageTypes: toContract.storage.types ?? {},
        schema: makeSchemaWithEnum('status', ['active', 'inactive']),
        policy: { allowedOperationClasses: ['additive', 'destructive', 'widening', 'data'] },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'createEnumType' });
      expect(calls.some((c) => c.factoryName === 'dropEnumType')).toBe(true);
      expect(calls.some((c) => c.factoryName === 'renameType')).toBe(true);
    });
  });

  describe('index_mismatch', () => {
    it('threads contract index type and options into CreateIndexCall when the index is missing', () => {
      const toContract = makeContract({
        entries: {
          table: {
            doc: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [{ columns: ['body'], type: 'gin', options: { fastupdate: false } }],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'index_mismatch',
          table: 'doc',
          expected: 'body',
          message: 'Table "doc" is missing index: body',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(1);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'doc',
        indexType: 'gin',
        options: { fastupdate: false },
      });
    });

    it('uses the contract index name when set', () => {
      const toContract = makeContract({
        entries: {
          table: {
            doc: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [
                {
                  columns: ['body'],
                  name: 'doc_body_bm25_idx',
                  type: 'bm25',
                  options: { key_field: 'id' },
                },
              ],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'index_mismatch',
          table: 'doc',
          expected: 'body',
          message: 'Table "doc" is missing index: body',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'doc',
        indexName: 'doc_body_bm25_idx',
        indexType: 'bm25',
        options: { key_field: 'id' },
      });
    });

    it('falls back to a default index name when the contract index has no name', () => {
      const toContract = makeContract({
        entries: {
          table: {
            doc: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [{ columns: ['body'] }],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'index_mismatch',
          table: 'doc',
          expected: 'body',
          message: 'Table "doc" is missing index: body',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'doc',
        indexName: 'doc_body_idx',
        indexType: undefined,
        options: undefined,
      });
    });
  });

  describe('foreign_key_mismatch', () => {
    it('returns foreignKeyConflict when the destination contract lacks a matching FK entry', () => {
      const toContract = makeContract({
        entries: {
          table: {
            order: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                user_id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'foreign_key_mismatch',
          table: 'order',
          expected: 'user_id -> user(id)',
          message: 'Foreign key on "order" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected notOk');
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]).toMatchObject({
        kind: 'foreignKeyConflict',
        summary: expect.stringContaining('not found in destination contract'),
        location: { table: 'order' },
      });
    });
  });

  describe('strategies override', () => {
    it('bypasses data-safety strategies when strategies: [] is passed', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
        strategies: [],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'addColumn' });
      expect(calls.some((c) => c.factoryName === 'dataTransform')).toBe(false);
      expect(calls.some((c) => c.factoryName === 'setNotNull')).toBe(false);
    });
  });

  describe('renderTypeScript round-trip', () => {
    it('renders calls to valid TypeScript', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_column',
          table: 'user',
          column: 'status',
          message: 'Column "status" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });
      if (!result.ok) throw new Error('expected ok');

      const ts = renderCallsToTypeScript(result.value.calls, {
        from: 'sha256:aaa',
        to: 'sha256:bbb',
      });

      expect(ts).toContain('export default class M extends Migration');
      expect(ts).toContain('addColumn(');
      expect(ts).toContain('this.dataTransform(');
      expect(ts).toContain('placeholder(');
      expect(ts).toContain('setNotNull(');
      expect(ts).toContain("from '@prisma-next/postgres/migration'");
    });
  });

  describe('missing_schema', () => {
    function makeNamespacedContract(
      namespaces: Record<string, { entries: { table: Record<string, StorageTableInput> } }>,
    ): Contract<SqlStorage> {
      const nsMap: SqlStorageInput['namespaces'] = {
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
        ...Object.fromEntries(
          Object.entries(namespaces).map(([id, ns]) => [
            id,
            new PostgresSchema({ id, entries: { table: ns.entries.table, type: {} } }),
          ]),
        ),
      };
      return {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:test'),
        storage: new SqlStorage({
          storageHash: coreHash('sha256:contract'),
          namespaces: nsMap,
        }),
        roots: {},
        domain: applicationDomainOf({ models: {} }),
        capabilities: {},
        extensionPacks: {},
        meta: {},
      };
    }

    it('translates missing_schema into a CreateSchemaCall classified as a dep', () => {
      const userTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      const toContract = makeNamespacedContract({
        auth: { entries: { table: { user: userTable } } },
      });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_schema',
          namespaceId: 'auth',
          message: 'Schema "auth" is missing from database',
        },
        {
          kind: 'missing_table',
          table: 'user',
          namespaceId: 'auth',
          message: 'Table "user" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls[0]).toMatchObject({ factoryName: 'createSchema', schemaName: 'auth' });
      const createSchemaIdx = calls.findIndex((c) => c.factoryName === 'createSchema');
      const createTableIdx = calls.findIndex((c) => c.factoryName === 'createTable');
      expect(createSchemaIdx).toBeGreaterThanOrEqual(0);
      expect(createTableIdx).toBeGreaterThanOrEqual(0);
      expect(createSchemaIdx).toBeLessThan(createTableIdx);
    });

    it('emits a CreateSchemaCall whose toOp emits CREATE SCHEMA IF NOT EXISTS', async () => {
      const toContract = makeNamespacedContract({ auth: { entries: { table: {} } } });
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_schema',
          namespaceId: 'auth',
          message: 'Schema "auth" is missing from database',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const call = result.value.calls[0]!;
      expect(call.factoryName).toBe('createSchema');
      const op = await call.toOp(testAdapter);
      expect(op.execute?.[0]?.sql).toContain('CREATE SCHEMA IF NOT EXISTS "auth"');
    });
  });

  describe('namespace coordinate on issues', () => {
    function makeMultiNamespaceContract(): Contract<SqlStorage> {
      const userTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      return {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:test'),
        storage: new SqlStorage({
          storageHash: coreHash('sha256:multi-namespace-contract'),
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
            tenant_a: new PostgresSchema({
              id: 'tenant_a',
              entries: { table: { users: userTable }, type: {} },
            }),
            tenant_b: new PostgresSchema({
              id: 'tenant_b',
              entries: { table: { users: userTable }, type: {} },
            }),
          },
        }),
        roots: {},
        domain: applicationDomainOf({ models: {} }),
        capabilities: {},
        extensionPacks: {},
        meta: {},
      };
    }

    it('surfaces an explicit conflict when an issue carries a stale namespaceId not present in the contract', () => {
      const toContract = makeMultiNamespaceContract();
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_table',
          table: 'users',
          namespaceId: 'tenant_c',
          message: 'Table "users" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected conflict');
      expect(result.failure).toHaveLength(1);
      const conflict = result.failure[0]!;
      expect(conflict.summary).toContain('users');
      expect(conflict.summary).toContain('tenant_c');
    });

    it('emits correctly-qualified DDL when an issue carries a valid namespaceId', () => {
      const toContract = makeMultiNamespaceContract();
      const issues: SchemaIssue[] = [
        {
          kind: 'missing_table',
          table: 'users',
          namespaceId: 'tenant_a',
          message: 'Table "users" is missing',
        },
      ];

      const result = planIssues({
        ...defaultCtx,
        issues,
        toContract,
        fromContract: null,
        storageTypes: toContract.storage.types ?? {},
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const createTableCall = result.value.calls[0] as CreateTableCall;
      expect(createTableCall.factoryName).toBe('createTable');
      expect(createTableCall.tableName).toBe('users');
      expect(createTableCall.schemaName).toBe('tenant_a');
    });
  });
});
