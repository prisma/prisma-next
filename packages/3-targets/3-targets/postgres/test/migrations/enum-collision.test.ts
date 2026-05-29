import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { MigrationOperationPolicy } from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { PostgresEnumStorageEntry, StorageTableInput } from '@prisma-next/sql-contract/types';
import { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { PG_ENUM_CODEC_ID } from '@prisma-next/target-postgres/codec-ids';
import { describe, expect, it } from 'vitest';
import { enumStorageCompoundKey } from '../../src/core/migrations/enum-planning';
import { planIssues } from '../../src/core/migrations/issue-planner';
import {
  AddEnumValuesCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  DropEnumTypeCall,
} from '../../src/core/migrations/op-factory-call';
import { nativeEnumPlanCallStrategy } from '../../src/core/migrations/planner-strategies';
import { PostgresSchema, PostgresUnboundSchema } from '../../src/core/postgres-schema';
import { PostgresEnumType } from '../../src/exports/types';

const defaultCtx = {
  schemaName: 'public',
  codecHooks: new Map(),
  storageTypes: {},
};

function enumEntry(values: readonly string[], nativeType?: string): PostgresEnumType {
  return new PostgresEnumType({
    name: 'Status',
    values,
    ...(nativeType !== undefined ? { nativeType } : {}),
  });
}

function makeCollisionContract(
  overrides: {
    audit?: { enum?: PostgresEnumType; tables?: Record<string, StorageTableInput> };
    public?: { enum?: PostgresEnumType; tables?: Record<string, StorageTableInput> };
  } = {},
): Contract<SqlStorage> {
  const auditEnum = overrides.audit?.enum;
  const publicEnum = overrides.public?.enum;
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:enum-collision'),
    storage: new SqlStorage({
      storageHash: coreHash('sha256:enum-collision-contract'),
      namespaces: {
        audit: new PostgresSchema({
          id: 'audit',
          tables: overrides.audit?.tables ?? {},
          ...(auditEnum !== undefined ? { enum: { Status: auditEnum } } : {}),
        }),
        public: new PostgresSchema({
          id: 'public',
          tables: overrides.public?.tables ?? {},
          ...(publicEnum !== undefined ? { enum: { Status: publicEnum } } : {}),
        }),
      },
    }),
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

function makeLiveEnumSchema(
  entries: ReadonlyArray<{ schemaName: string; nativeType: string; values: readonly string[] }>,
): SqlSchemaIR {
  const storageTypes: Record<
    string,
    { codecId: string; nativeType: string; typeParams: { values: readonly string[] } }
  > = {};
  for (const entry of entries) {
    storageTypes[enumStorageCompoundKey(entry.schemaName, entry.nativeType)] = {
      codecId: PG_ENUM_CODEC_ID,
      nativeType: entry.nativeType,
      typeParams: { values: entry.values },
    };
  }
  return {
    tables: {},
    annotations: { pg: { storageTypes } },
  };
}

function planEnumCalls(options: {
  toContract: Contract<SqlStorage>;
  fromContract?: Contract<SqlStorage> | null;
  schema: SqlSchemaIR;
  issues?: SchemaIssue[];
  policy?: MigrationOperationPolicy;
}) {
  const result = planIssues({
    ...defaultCtx,
    strategies: [nativeEnumPlanCallStrategy],
    issues: options.issues ?? [],
    toContract: options.toContract,
    fromContract: options.fromContract ?? null,
    schema: options.schema,
    storageTypes: options.toContract.storage.types ?? {},
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected planIssues ok');
  return result.value.calls;
}

describe('enum namespace collision planning', () => {
  describe('pre-fix regression: two-namespace same enum name', () => {
    it('produces two CreateEnumTypeCall instances against an empty live schema', () => {
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['open', 'closed']) },
        public: { enum: enumEntry(['draft', 'published']) },
      });

      const calls = planEnumCalls({ toContract, schema: { tables: {} } });
      const createCalls = calls.filter((c) => c instanceof CreateEnumTypeCall);

      expect(createCalls).toHaveLength(2);
      expect(createCalls.map((c) => c.schemaName).sort()).toEqual(['audit', 'public']);
    });
  });

  describe('introduce path', () => {
    it('creates one enum per namespace schema when both share the TypeScript name', () => {
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['a', 'b']) },
        public: { enum: enumEntry(['x', 'y']) },
      });

      const calls = planEnumCalls({ toContract, schema: { tables: {} } });
      const bySchema = new Map(
        calls
          .filter((c): c is CreateEnumTypeCall => c instanceof CreateEnumTypeCall)
          .map((c) => [c.schemaName, c] as const),
      );

      expect(bySchema.get('audit')?.values).toEqual(['a', 'b']);
      expect(bySchema.get('public')?.values).toEqual(['x', 'y']);
    });
  });

  describe('add_values path', () => {
    it('adds values only on the namespace whose live enum is missing members', () => {
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['open', 'closed', 'archived']) },
        public: { enum: enumEntry(['draft', 'published']) },
      });
      const schema = makeLiveEnumSchema([
        { schemaName: 'audit', nativeType: 'Status', values: ['open', 'closed'] },
        { schemaName: 'public', nativeType: 'Status', values: ['draft', 'published'] },
      ]);

      const calls = planEnumCalls({ toContract, schema });
      const addCalls = calls.filter((c): c is AddEnumValuesCall => c instanceof AddEnumValuesCall);

      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]?.schemaName).toBe('audit');
      expect(addCalls[0]?.values).toEqual(['archived']);
    });
  });

  describe('rebuild path', () => {
    it('rebuilds only the namespace whose values diverge', () => {
      const logEntryTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          priority: {
            nativeType: 'Status',
            codecId: 'pg/enum@1',
            nullable: false,
            typeRef: 'Status',
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      const postTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          status: {
            nativeType: 'Status',
            codecId: 'pg/enum@1',
            nullable: false,
            typeRef: 'Status',
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['low']), tables: { log_entry: logEntryTable } },
        public: { enum: enumEntry(['draft', 'published']), tables: { post: postTable } },
      });
      const schema = makeLiveEnumSchema([
        { schemaName: 'audit', nativeType: 'Status', values: ['low', 'high'] },
        { schemaName: 'public', nativeType: 'Status', values: ['draft', 'published'] },
      ]);
      const policy: MigrationOperationPolicy = {
        allowedOperationClasses: ['additive', 'destructive', 'widening', 'data'],
      };

      const calls = planEnumCalls({ toContract, schema, policy });
      const alterCalls = calls.filter(
        (c): c is AlterColumnTypeCall => c instanceof AlterColumnTypeCall,
      );
      const dropCalls = calls.filter((c): c is DropEnumTypeCall => c instanceof DropEnumTypeCall);

      expect(alterCalls).toHaveLength(1);
      expect(alterCalls[0]?.schemaName).toBe('audit');
      expect(alterCalls[0]?.tableName).toBe('log_entry');
      expect(dropCalls).toHaveLength(1);
      expect(dropCalls[0]?.schemaName).toBe('audit');
      expect(calls.some((c) => c instanceof CreateEnumTypeCall && c.schemaName === 'public')).toBe(
        false,
      );
    });
  });

  describe('same nativeType collision', () => {
    it('resolves live enums distinctly when both namespaces share nativeType user_role', () => {
      const sharedNative = 'user_role';
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['admin', 'viewer'], sharedNative) },
        public: { enum: enumEntry(['member', 'guest'], sharedNative) },
      });
      const schema = makeLiveEnumSchema([
        { schemaName: 'audit', nativeType: sharedNative, values: ['admin'] },
        { schemaName: 'public', nativeType: sharedNative, values: ['member'] },
      ]);

      const calls = planEnumCalls({ toContract, schema });
      const addCalls = calls.filter((c): c is AddEnumValuesCall => c instanceof AddEnumValuesCall);

      expect(addCalls).toHaveLength(2);
      expect(addCalls.map((c) => c.schemaName).sort()).toEqual(['audit', 'public']);
      expect(addCalls.find((c) => c.schemaName === 'audit')?.values).toEqual(['viewer']);
      expect(addCalls.find((c) => c.schemaName === 'public')?.values).toEqual(['guest']);
    });
  });

  describe('drop scenario', () => {
    it('scopes rebuild drop to the rebuilt namespace when the sibling enum is unchanged', () => {
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['only']) },
        public: { enum: enumEntry(['kept']) },
      });
      const schema = makeLiveEnumSchema([
        { schemaName: 'audit', nativeType: 'Status', values: ['only', 'removed'] },
        { schemaName: 'public', nativeType: 'Status', values: ['kept'] },
      ]);
      const policy: MigrationOperationPolicy = {
        allowedOperationClasses: ['additive', 'destructive', 'widening', 'data'],
      };

      const calls = planEnumCalls({ toContract, schema, policy });
      const dropCalls = calls.filter((c): c is DropEnumTypeCall => c instanceof DropEnumTypeCall);

      expect(dropCalls).toHaveLength(1);
      expect(dropCalls[0]?.schemaName).toBe('audit');
    });
  });

  describe('cross-namespace column binding: public enum, unbound-namespace table', () => {
    // The authoring builder places contract-level `types:` enums in the
    // default `public` namespace, while a model's table lands in the unbound
    // namespace. A column there carries a bare `typeRef` that must still bind
    // to the `public` enum so the rebuild migrates it (regression for the
    // D2 `nsId === namespaceId` over-narrowing).
    it('rebuilds the public enum and migrates the unbound-namespace column', () => {
      const userTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
      };
      const toContract: Contract<SqlStorage> = {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:public-enum-unbound-col'),
        storage: new SqlStorage({
          storageHash: coreHash('sha256:public-enum-unbound-col'),
          namespaces: {
            public: new PostgresSchema({
              id: 'public',
              tables: {},
              enum: {
                status: new PostgresEnumType({ name: 'status', values: ['active', 'archived'] }),
              },
            }),
            [UNBOUND_NAMESPACE_ID]: new PostgresUnboundSchema({
              id: UNBOUND_NAMESPACE_ID,
              tables: { user: userTable },
            }),
          },
        }),
        roots: {},
        models: {},
        capabilities: {},
        extensionPacks: {},
        meta: {},
      };
      // Live enum has a value the contract drops → forces the rebuild recipe.
      const schema = makeLiveEnumSchema([
        { schemaName: 'public', nativeType: 'status', values: ['active', 'pending', 'archived'] },
      ]);
      const policy: MigrationOperationPolicy = {
        allowedOperationClasses: ['additive', 'destructive', 'widening', 'data'],
      };

      const calls = planEnumCalls({ toContract, schema, policy });
      const alterCalls = calls.filter(
        (c): c is AlterColumnTypeCall => c instanceof AlterColumnTypeCall,
      );
      const createCalls = calls.filter(
        (c): c is CreateEnumTypeCall => c instanceof CreateEnumTypeCall,
      );
      const dropCalls = calls.filter((c): c is DropEnumTypeCall => c instanceof DropEnumTypeCall);

      expect(alterCalls).toHaveLength(1);
      expect(alterCalls[0]?.tableName).toBe('user');
      expect(alterCalls[0]?.schemaName).toBe('public');
      // Rebuild recipe creates the temp type and drops the old one — both in
      // the enum's `public` schema, not the column's unbound coordinate.
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.schemaName).toBe('public');
      expect(dropCalls).toHaveLength(1);
      expect(dropCalls[0]?.schemaName).toBe('public');
    });
  });

  describe('verifier — same-name enums across namespaces', () => {
    // Regression for the verifier collapsing `storageTypes` by bare enum name:
    // two namespaces declaring the same enum name must each be verified with
    // their own namespace coordinate, not last-write-wins down to one.
    it('emits a distinct issue per namespace for a same-name enum', () => {
      const toContract = makeCollisionContract({
        audit: { enum: enumEntry(['open', 'closed']) },
        public: { enum: enumEntry(['draft', 'published']) },
      });

      // Both enums absent from the (empty) live schema → one type_missing each.
      const result = verifySqlSchema({
        contract: toContract,
        schema: { tables: {} },
        strict: false,
        typeMetadataRegistry: new Map(),
        frameworkComponents: [],
        resolveExistingEnumValues: (_schema, _enumType: PostgresEnumStorageEntry) => null,
      });

      const enumIssues = result.schema.issues.filter(
        (issue) => issue.kind === 'type_missing' && issue.typeName === 'Status',
      );
      expect(enumIssues).toHaveLength(2);
      expect(
        enumIssues.map((issue) => ('namespaceId' in issue ? issue.namespaceId : undefined)).sort(),
      ).toEqual(['audit', 'public']);
    });
  });
});
