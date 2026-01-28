import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import type { SqlContract, SqlStorage, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { introspectEnumStorageTypes, pgEnumControlHooks } from '../src/core/enum-control-hooks';

const ENUM_CODEC_ID = 'pg/enum@1';

function createContract(storage: Partial<SqlStorage>): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test' as never,
    storage: {
      tables: {},
      types: {},
      ...storage,
    } as SqlStorage,
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
  };
}

function createSchema(storageTypes?: Record<string, StorageTypeInstance>): SqlSchemaIR {
  if (!storageTypes) {
    return { tables: {}, extensions: [] };
  }

  return {
    tables: {},
    extensions: [],
    annotations: {
      pg: {
        storageTypes,
      },
    },
  };
}

describe('pgEnumControlHooks.planTypeOperations', () => {
  it('returns empty operations when values are missing', () => {
    const contract = createContract({
      types: {
        Role: { codecId: ENUM_CODEC_ID, nativeType: 'role', typeParams: {} },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: { codecId: ENUM_CODEC_ID, nativeType: 'role', typeParams: {} },
      contract,
      schema: createSchema(),
      schemaName: undefined,
      policy: { allow: () => true },
    });

    expect(result?.operations).toEqual([]);
  });

  it('creates enum type when schema is missing storage type', () => {
    const contract = createContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
      contract,
      schema: createSchema(),
      schemaName: undefined,
      policy: { allow: () => true },
    });

    expect(result?.operations).toMatchObject([
      {
        id: 'type.Role',
        label: 'Create type Role',
        operationClass: 'additive',
        execute: [
          {
            sql: 'CREATE TYPE "public"."role" AS ENUM (\'USER\', \'ADMIN\')',
          },
        ],
      },
    ]);
  });

  it('returns empty operations when values match', () => {
    const contract = createContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
    });

    const schema = createSchema({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
      contract,
      schema,
      schemaName: undefined,
      policy: { allow: () => true },
    });

    expect(result?.operations).toEqual([]);
  });

  it.each([
    {
      existing: ['A'],
      desired: ['A', 'B'],
      expectedSql: 'ALTER TYPE "public"."role" ADD VALUE \'B\' AFTER \'A\'',
    },
    {
      existing: ['A', 'C'],
      desired: ['A', 'B', 'C'],
      expectedSql: 'ALTER TYPE "public"."role" ADD VALUE \'B\' AFTER \'A\'',
    },
  ])('adds missing enum values for $desired', ({ existing, desired, expectedSql }) => {
    const contract = createContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: desired },
        },
      },
    });

    const schema = createSchema({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: existing },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: desired },
      },
      contract,
      schema,
      schemaName: undefined,
      policy: { allow: () => true },
    });

    expect(result?.operations).toMatchObject([
      {
        id: 'type.Role.value.B',
        operationClass: 'widening',
        execute: [{ sql: expectedSql }],
      },
    ]);
  });

  it('rebuilds enum when values are reordered', () => {
    const contract = createContract({
      tables: {
        user: {
          columns: {
            role: {
              codecId: ENUM_CODEC_ID,
              nativeType: 'role',
              nullable: false,
              typeRef: 'Role',
            },
            altRole: {
              codecId: ENUM_CODEC_ID,
              nativeType: 'role',
              nullable: false,
            },
          },
          primaryKey: { columns: ['role'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['B', 'A'] },
        },
      },
    });

    const schema = createSchema({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['A', 'B'] },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['B', 'A'] },
      },
      contract,
      schema,
      schemaName: 'public',
      policy: { allow: () => true },
    });

    expect(result?.operations).toHaveLength(1);
    const operation = result?.operations[0];
    expect(operation).toMatchObject({
      id: 'type.Role.rebuild',
      operationClass: 'destructive',
    });
    expect(operation?.execute).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: 'CREATE TYPE "public"."role__pn_rebuild" AS ENUM (\'B\', \'A\')',
        }),
        expect.objectContaining({
          sql: expect.stringContaining('ALTER TABLE "public"."user"'),
        }),
        expect.objectContaining({
          sql: expect.stringContaining('ALTER COLUMN "altRole"'),
        }),
        expect.objectContaining({
          sql: 'DROP TYPE "public"."role"',
        }),
        expect.objectContaining({
          sql: 'ALTER TYPE "public"."role__pn_rebuild" RENAME TO "role"',
        }),
      ]),
    );
  });
});

describe('pgEnumControlHooks.verifyType', () => {
  it('returns empty list when values are missing', () => {
    const schema = createSchema();
    const issues = pgEnumControlHooks.verifyType?.({
      typeName: 'Role',
      typeInstance: { codecId: ENUM_CODEC_ID, nativeType: 'role', typeParams: {} },
      schema,
      schemaName: undefined,
    });

    expect(issues).toEqual([]);
  });

  it('reports missing type', () => {
    const schema = createSchema();
    const issues = pgEnumControlHooks.verifyType?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER'] },
      },
      schema,
      schemaName: undefined,
    });

    expect(issues).toMatchObject([
      {
        kind: 'type_missing',
        typeName: 'Role',
        message: 'Type "Role" is missing from database',
      },
    ]);
  });

  it('reports mismatched enum values', () => {
    const schema = createSchema({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER'] },
      },
    });

    const issues = pgEnumControlHooks.verifyType?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['ADMIN'] },
      },
      schema,
      schemaName: undefined,
    });

    expect(issues).toMatchObject([
      {
        kind: 'type_values_mismatch',
        typeName: 'Role',
        expected: 'ADMIN',
        actual: 'USER',
      },
    ]);
  });
});

describe('pgEnumControlHooks.introspectTypes', () => {
  it('introspects enum storage types', async () => {
    const driver: ControlDriverInstance<'sql', string> = {
      familyId: 'sql',
      targetId: 'postgres',
      query: async () => ({
        rows: [
          { schema_name: 'public', type_name: 'role', values: ['USER', 'ADMIN'] },
          { schema_name: 'public', type_name: 'invalid', values: [1, 2] },
        ],
      }),
      close: async () => {},
    };

    if (!pgEnumControlHooks.introspectTypes) {
      throw new Error('introspectTypes missing');
    }

    const types = await pgEnumControlHooks.introspectTypes({ driver, schemaName: 'public' });
    const viaWrapper = await introspectEnumStorageTypes({ driver, schemaName: 'public' });

    expect({ types, viaWrapper }).toMatchObject({
      types: {
        role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
      viaWrapper: {
        role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
    });
  });
});
