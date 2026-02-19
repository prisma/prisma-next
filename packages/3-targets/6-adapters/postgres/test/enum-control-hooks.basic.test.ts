import type { ControlDriverInstance } from '@prisma-next/core-control-plane/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { timeouts } from '@prisma-next/test-utils';
import { expectNarrowedType } from '@prisma-next/test-utils/typed-expectations';
import { describe, expect, it } from 'vitest';
import { parsePostgresArray, pgEnumControlHooks } from '../src/core/enum-control-hooks';
import { createTestContract, createTestSchema, ENUM_CODEC_ID } from './test-utils';

describe('parsePostgresArray', () => {
  it('returns array as-is when input is already a string array', () => {
    expect(parsePostgresArray(['USER', 'ADMIN'])).toEqual(['USER', 'ADMIN']);
  });

  it('parses PostgreSQL array literal format', () => {
    expect(parsePostgresArray('{USER,ADMIN}')).toEqual(['USER', 'ADMIN']);
  });

  it('handles empty PostgreSQL array literal', () => {
    expect(parsePostgresArray('{}')).toEqual([]);
  });

  it('handles single value PostgreSQL array literal', () => {
    expect(parsePostgresArray('{USER}')).toEqual(['USER']);
  });

  it('trims whitespace from values', () => {
    expect(parsePostgresArray('{ USER , ADMIN }')).toEqual(['USER', 'ADMIN']);
  });

  it('returns null for non-array non-string values', () => {
    expect(parsePostgresArray(123)).toBeNull();
    expect(parsePostgresArray(null)).toBeNull();
    expect(parsePostgresArray(undefined)).toBeNull();
    expect(parsePostgresArray({ key: 'value' })).toBeNull();
  });

  it('returns null for strings not in array format', () => {
    expect(parsePostgresArray('USER')).toBeNull();
    expect(parsePostgresArray('USER,ADMIN')).toBeNull();
  });

  it('returns null for arrays containing non-strings', () => {
    expect(parsePostgresArray([1, 2, 3])).toBeNull();
    expect(parsePostgresArray(['USER', 123])).toBeNull();
  });

  it('handles quoted values containing commas', () => {
    expect(parsePostgresArray('{"has,comma",ADMIN}')).toEqual(['has,comma', 'ADMIN']);
  });

  it('handles quoted values with escaped double quotes', () => {
    expect(parsePostgresArray('{"say \\"hello\\"",ADMIN}')).toEqual(['say "hello"', 'ADMIN']);
  });

  it('handles quoted values with escaped backslashes', () => {
    expect(parsePostgresArray('{"path\\\\dir",ADMIN}')).toEqual(['path\\dir', 'ADMIN']);
  });

  it('handles mixed quoted and unquoted values', () => {
    expect(parsePostgresArray('{SIMPLE,"has,comma","with \\"quotes\\"",PLAIN}')).toEqual([
      'SIMPLE',
      'has,comma',
      'with "quotes"',
      'PLAIN',
    ]);
  });
});

describe('pgEnumControlHooks.planTypeOperations', () => {
  it('returns empty operations when values are missing', () => {
    const contract = createTestContract({
      types: {
        Role: { codecId: ENUM_CODEC_ID, nativeType: 'role', typeParams: {} },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: { codecId: ENUM_CODEC_ID, nativeType: 'role', typeParams: {} },
      contract,
      schema: createTestSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    });

    expect(result?.operations).toEqual([]);
  });

  it('creates enum type when schema is missing storage type', () => {
    const contract = createTestContract({
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
      schema: createTestSchema(),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
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
    const contract = createTestContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
    });

    const schema = createTestSchema({
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
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    });

    expect(result?.operations).toEqual([]);
  });

  it.each([
    {
      existing: ['A'],
      desired: ['A', 'B'],
      expectedSql: 'ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS \'B\' AFTER \'A\'',
    },
    {
      existing: ['A', 'C'],
      desired: ['A', 'B', 'C'],
      expectedSql: 'ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS \'B\' AFTER \'A\'',
    },
  ])('adds missing enum values for $desired', ({ existing, desired, expectedSql }) => {
    const contract = createTestContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: desired },
        },
      },
    });

    const schema = createTestSchema({
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
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    });

    expect(result?.operations).toMatchObject([
      {
        id: 'type.Role.value.B',
        operationClass: 'widening',
        execute: [{ sql: expectedSql }],
      },
    ]);
  });

  it('adds missing enum value before existing when only next exists', () => {
    const contract = createTestContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: ['A', 'B'] },
        },
      },
    });

    const schema = createTestSchema({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['B'] },
      },
    });

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['A', 'B'] },
      },
      contract,
      schema,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    });

    expect(result?.operations).toMatchObject([
      {
        id: 'type.Role.value.A',
        operationClass: 'widening',
        execute: [
          {
            sql: 'ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS \'A\' BEFORE \'B\'',
          },
        ],
      },
    ]);
  });

  it(
    'rebuilds enum when values are reordered',
    () => {
      const contract = createTestContract({
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

      const schema = createTestSchema({
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
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      });

      expect(result?.operations).toHaveLength(1);
      const operation = result?.operations[0];
      expect(operation).toMatchObject({
        id: 'type.Role.rebuild',
        operationClass: 'destructive',
      });
      // Verify execute steps include orphan cleanup and all rebuild steps
      expect(operation?.execute).toEqual(
        expect.arrayContaining([
          // First: clean up any orphaned temp type from failed previous migrations
          expect.objectContaining({
            sql: 'DROP TYPE IF EXISTS "public"."role__pn_rebuild"',
          }),
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
    },
    timeouts.databaseOperation,
  );

  it('throws when enum value exceeds length limit', () => {
    const longValue = 'a'.repeat(64);
    const contract = createTestContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: [longValue] },
        },
      },
    });

    expect(() =>
      pgEnumControlHooks.planTypeOperations?.({
        typeName: 'Role',
        typeInstance: {
          codecId: ENUM_CODEC_ID,
          nativeType: 'role',
          typeParams: { values: [longValue] },
        },
        contract,
        schema: createTestSchema(),
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      }),
    ).toThrow('exceeds PostgreSQL');
  });

  it('throws when enum type name is too long for rebuild', () => {
    const longTypeName = 'a'.repeat(60);
    const contract = createTestContract({
      types: {
        Role: {
          codecId: ENUM_CODEC_ID,
          nativeType: longTypeName,
          typeParams: { values: ['B', 'A'] },
        },
      },
    });

    const schema = createTestSchema({
      [longTypeName]: {
        codecId: ENUM_CODEC_ID,
        nativeType: longTypeName,
        typeParams: { values: ['A', 'B'] },
      },
    });

    expect(() =>
      pgEnumControlHooks.planTypeOperations?.({
        typeName: 'Role',
        typeInstance: {
          codecId: ENUM_CODEC_ID,
          nativeType: longTypeName,
          typeParams: { values: ['B', 'A'] },
        },
        contract,
        schema,
        schemaName: 'public',
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      }),
    ).toThrow('too long for rebuild operation');
  });

  it('includes schema-only enum columns in rebuild prechecks', () => {
    const contract = createTestContract({
      tables: {
        user: {
          columns: {
            role: {
              codecId: ENUM_CODEC_ID,
              nativeType: 'role',
              nullable: false,
              typeRef: 'Role',
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
          typeParams: { values: ['USER'] },
        },
      },
    });

    const schema: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            role: { name: 'role', nativeType: 'role', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        audit: {
          name: 'audit',
          columns: {
            role: { name: 'role', nativeType: 'role', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
      annotations: {
        pg: {
          storageTypes: {
            role: {
              codecId: ENUM_CODEC_ID,
              nativeType: 'role',
              typeParams: { values: ['USER', 'ADMIN'] },
            },
          },
        },
      },
    };

    const result = pgEnumControlHooks.planTypeOperations?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER'] },
      },
      contract,
      schema,
      schemaName: 'public',
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    });

    expect(result?.operations).toHaveLength(1);
    expect(result?.operations[0]?.id).toBe('type.Role.rebuild');
    expect(result?.operations[0]?.precheck).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining(
            'ensure no rows in audit.role contain removed values',
          ),
        }),
      ]),
    );
  });
});

describe('pgEnumControlHooks.verifyType', () => {
  it('returns empty list when values are missing', () => {
    const schema = createTestSchema();
    const issues = pgEnumControlHooks.verifyType?.({
      typeName: 'Role',
      typeInstance: { codecId: ENUM_CODEC_ID, nativeType: 'role', typeParams: {} },
      schema,
    });

    expect(issues).toEqual([]);
  });

  it('reports missing type', () => {
    const schema = createTestSchema();
    const issues = pgEnumControlHooks.verifyType?.({
      typeName: 'Role',
      typeInstance: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER'] },
      },
      schema,
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
    const schema = createTestSchema({
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
  function createMockDriver(
    rows: Array<{ schema_name: string; type_name: string; values: unknown }>,
  ): ControlDriverInstance<'sql', string> {
    return {
      familyId: 'sql',
      targetId: 'postgres',
      query: async <Row>() => ({ rows }) as { readonly rows: Row[] },
      close: async () => {},
    };
  }

  it('introspects enum storage types', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'role', values: ['USER', 'ADMIN'] },
    ]);

    expectNarrowedType(pgEnumControlHooks.introspectTypes, 'introspectTypes missing');

    const types = await pgEnumControlHooks.introspectTypes({ driver, schemaName: 'public' });

    expect(types).toMatchObject({
      role: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    });
  });

  it('introspects enum with PostgreSQL array string format', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'status', values: '{PENDING,ACTIVE,CLOSED}' },
    ]);

    expectNarrowedType(pgEnumControlHooks.introspectTypes, 'introspectTypes missing');

    const types = await pgEnumControlHooks.introspectTypes({ driver, schemaName: 'public' });

    expect(types).toMatchObject({
      status: {
        codecId: ENUM_CODEC_ID,
        nativeType: 'status',
        typeParams: { values: ['PENDING', 'ACTIVE', 'CLOSED'] },
      },
    });
  });

  it('throws when enum values cannot be parsed', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'invalid', values: [1, 2] },
    ]);

    expectNarrowedType(pgEnumControlHooks.introspectTypes, 'introspectTypes missing');

    await expect(
      pgEnumControlHooks.introspectTypes({ driver, schemaName: 'public' }),
    ).rejects.toThrow('Failed to parse enum values for type "invalid"');
  });

  it('throws with descriptive message showing the unexpected format', async () => {
    const driver = createMockDriver([
      { schema_name: 'public', type_name: 'broken', values: { nested: 'object' } },
    ]);

    expectNarrowedType(pgEnumControlHooks.introspectTypes, 'introspectTypes missing');

    await expect(
      pgEnumControlHooks.introspectTypes({ driver, schemaName: 'public' }),
    ).rejects.toThrow('unexpected format: {"nested":"object"}');
  });

  it('defaults schema name to public when undefined', async () => {
    const expectedRows = [{ schema_name: 'public', type_name: 'role', values: ['USER'] }];
    const driver: ControlDriverInstance<'sql', string> = {
      familyId: 'sql',
      targetId: 'postgres',
      query: async <Row>(_sql: string, params?: unknown[]) => {
        expect(params).toEqual(['public']);
        return { rows: expectedRows } as { readonly rows: Row[] };
      },
      close: async () => {},
    };

    expectNarrowedType(pgEnumControlHooks.introspectTypes, 'introspectTypes missing');
    const types = await pgEnumControlHooks.introspectTypes({ driver });
    expect(types['role']?.nativeType).toBe('role');
  });
});
