import { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

describe('PostgresMigrationPlanner - enums', () => {
  const contract = createEnumContract(['USER', 'ADMIN']);

  it('plans enum creation before table creation', () => {
    const planner = createPostgresMigrationPlanner();
    const schema: SqlSchemaIR = { tables: {}, extensions: [] };

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }
    const ids = result.plan.operations.map((op) => op.id);
    expect(ids[0]).toBe('enum.Role.create');
    expect(ids).toContain('table.user');
  });

  it('plans append-only enum value additions', () => {
    const planner = createPostgresMigrationPlanner();
    const schema: SqlSchemaIR = {
      tables: {
        user: buildSchemaTable(),
      },
      enums: {
        Role: { name: 'Role', values: ['USER'] },
      },
      extensions: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }
    expect(result.plan.operations.map((op) => op.id)).toContain('enum.Role.add.ADMIN');
  });

  it('plans enum drop when schema contains an unused enum missing from contract', () => {
    const planner = createPostgresMigrationPlanner();
    const schema: SqlSchemaIR = {
      tables: {
        user: buildSchemaTable(),
      },
      enums: {
        Role: { name: 'Role', values: ['USER', 'ADMIN'] },
        Extra: { name: 'Extra', values: ['A'] },
      },
      extensions: [],
    };

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      return;
    }
    expect(result.plan.operations.map((op) => op.id)).toContain('enum.Extra.drop');
  });

  it('surfaces conflicts when enum changes are not append-only', () => {
    const planner = createPostgresMigrationPlanner();
    const schema: SqlSchemaIR = {
      tables: {
        user: buildSchemaTable(),
      },
      enums: {
        Role: { name: 'Role', values: ['ADMIN', 'USER'] },
      },
      extensions: [],
    };

    const verify = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: new Map(),
      frameworkComponents: [],
    });
    expect(verify.schema.issues.some((issue) => issue.kind === 'enum_values_mismatch')).toBe(true);

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      frameworkComponents: [],
    });

    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'typeMismatch',
          }),
        ]),
      );
    }
  });
});

function createEnumContract(values: readonly string[]): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:contract',
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            role: {
              nativeType: 'Role',
              codecId: 'pg/enum@1',
              nullable: false,
              typeParams: { values: [...values] },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      types: {
        Role: {
          codecId: 'pg/enum@1',
          nativeType: 'Role',
          typeParams: { values: [...values] },
        },
      },
    },
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

function buildSchemaTable(): SqlSchemaIR['tables'][string] {
  return {
    name: 'user',
    columns: {
      id: { name: 'id', nativeType: 'uuid', nullable: false },
      role: { name: 'role', nativeType: 'Role', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    foreignKeys: [],
    indexes: [],
  };
}
