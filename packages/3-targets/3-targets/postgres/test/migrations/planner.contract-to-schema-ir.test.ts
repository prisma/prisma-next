import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type {
  CodecControlHooks,
  ComponentDatabaseDependency,
  MigrationPlannerResult,
  NativeTypeExpander,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import {
  contractToSchemaIR as contractToSchemaIRImpl,
  detectDestructiveChanges,
  extractCodecControlHooks,
} from '@prisma-next/family-sql/control';
import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresRenderDefault } from '../../src/exports/control';

const adapterCodecHooks = extractCodecControlHooks([postgresAdapterDescriptor]);
const expandParameterizedNativeType: NativeTypeExpander = (input) => {
  if (!input.codecId) return input.nativeType;
  const hooks = adapterCodecHooks.get(input.codecId);
  return hooks?.expandNativeType?.(input) ?? input.nativeType;
};

function col(overrides: Partial<StorageColumn> & { nativeType: string }): StorageColumn {
  return {
    codecId: 'pg/text@1',
    nullable: false,
    ...overrides,
  };
}

function table(
  overrides: Partial<StorageTable> & { columns: Record<string, StorageColumn> },
): StorageTable {
  return {
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

function createTestContract(
  storage: SqlStorage,
  overrides?: Partial<SqlContract<SqlStorage>>,
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:test'),
    profileHash: profileHash('sha256:profile'),
    storage,
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

function contractToSchemaIR(
  contract: SqlContract<SqlStorage> | null,
  options?: Omit<Parameters<typeof contractToSchemaIRImpl>[1], 'annotationNamespace'>,
) {
  return contractToSchemaIRImpl(contract, { annotationNamespace: 'pg', ...options });
}

function planFromStorages(from: SqlStorage | null, to: SqlStorage): MigrationPlannerResult {
  const toContract = createTestContract(to);
  const fromSchemaIR = contractToSchemaIR(from ? createTestContract(from) : null, {
    expandNativeType: expandParameterizedNativeType,
    renderDefault: postgresRenderDefault,
  });
  const planner = createPostgresMigrationPlanner();
  return planner.plan({
    contract: toContract,
    schema: fromSchemaIR,
    policy: { allowedOperationClasses: ['additive'] },
    frameworkComponents: [],
  });
}

describe('contractToSchemaIR → planner round-trip', () => {
  it('produces no ops when contract and schemaIR represent the same state', () => {
    const storage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ columns: ['name'] }],
          foreignKeys: [],
        },
      },
    };

    const contract = createTestContract(storage);
    const schemaIR = contractToSchemaIR(createTestContract(storage), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: schemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });

  it('detects additive changes from empty state', () => {
    const storage: SqlStorage = {
      tables: {
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
    };

    const contract = createTestContract(storage);
    const emptySchemaIR = contractToSchemaIR(null, {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: emptySchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations.length).toBeGreaterThan(0);
      const tableOp = result.plan.operations.find((op) => op.id.includes('user'));
      expect(tableOp).toBeDefined();
    }
  });

  it('detects incremental table addition', () => {
    const fromStorage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };

    const toStorage: SqlStorage = {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };

    const contract = createTestContract(toStorage);
    const fromSchemaIR = contractToSchemaIR(createTestContract(fromStorage), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const postOp = result.plan.operations.find((op) => op.id.includes('post'));
      expect(postOp).toBeDefined();
      const userOp = result.plan.operations.find(
        (op) => op.id.startsWith('table.') && op.id.includes('user'),
      );
      expect(userOp).toBeUndefined();
    }
  });

  it('handles default values in round-trip', () => {
    const storage: SqlStorage = {
      tables: {
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            status: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'literal', value: 'active' },
            },
            createdAt: {
              nativeType: 'timestamptz',
              codecId: 'pg/timestamptz@1',
              nullable: false,
              default: { kind: 'function', expression: 'now()' },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    };

    const contract = createTestContract(storage);
    const schemaIR = contractToSchemaIR(createTestContract(storage), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract,
      schema: schemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });
});

describe('planner — additive scenarios', () => {
  it('detects added column on existing table', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
            age: col({ nativeType: 'int4', codecId: 'pg/int4@1', nullable: true }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const addColOp = result.plan.operations.find((op) => op.id.includes('age'));
      expect(addColOp).toBeDefined();
      expect(addColOp!.label).toContain('age');
    }
  });

  it('detects added table', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            title: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const tableOp = result.plan.operations.find((op) => op.id.includes('post'));
      expect(tableOp).toBeDefined();
    }
  });

  it('detects multiple changes at once (table + unique + index)', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            title: col({ nativeType: 'text', codecId: 'pg/text@1' }),
            slug: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['slug'] }],
          indexes: [{ columns: ['title'] }],
        }),
      },
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations.length).toBeGreaterThanOrEqual(3);
      const ids = result.plan.operations.map((op) => op.id);
      expect(ids.some((id) => id.includes('post'))).toBe(true);
      expect(ids.some((id) => id.includes('unique') || id.includes('slug'))).toBe(true);
      expect(ids.some((id) => id.includes('index') || id.includes('title'))).toBe(true);
    }
  });

  it('returns no ops when storages are identical', () => {
    const storage: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const result = planFromStorages(storage, storage);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });
});

describe('detectDestructiveChanges', () => {
  it('rejects column removal with conflict', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const conflicts = detectDestructiveChanges(from, to);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('columnRemoved');
    expect(conflicts[0]!.summary).toContain('name');
  });

  it('rejects table removal with conflict', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const conflicts = detectDestructiveChanges(from, to);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('tableRemoved');
    expect(conflicts[0]!.summary).toContain('post');
  });

  it('rejects multiple destructive changes with all conflicts', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const conflicts = detectDestructiveChanges(from, to);

    expect(conflicts).toHaveLength(2);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds).toContain('columnRemoved');
    expect(kinds).toContain('tableRemoved');
  });
});

describe('planner — type and nullability change behavior', () => {
  it('rejects type change (text → int4) as non-additive conflict', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            name: col({ nativeType: 'int4', codecId: 'pg/int4@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
      const typeConflict = result.conflicts.find(
        (c) => c.summary.includes('name') || c.summary.includes('type'),
      );
      expect(typeConflict).toBeDefined();
    }
  });

  it('rejects nullability tightening (nullable → non-nullable) as non-additive conflict', () => {
    const from: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            bio: col({ nativeType: 'text', codecId: 'pg/text@1', nullable: true }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const to: SqlStorage = {
      tables: {
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            bio: col({ nativeType: 'text', codecId: 'pg/text@1', nullable: false }),
          },
          primaryKey: { columns: ['id'] },
        }),
      },
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
      const nullConflict = result.conflicts.find(
        (c) => c.summary.includes('bio') || c.summary.includes('null'),
      );
      expect(nullConflict).toBeDefined();
    }
  });
});

// --- Comprehensive incremental migration test (prisma-next-demo-like contract) ---

const pgvectorDependency: ComponentDatabaseDependency<unknown> = {
  id: 'postgres.extension.vector',
  label: 'Enable vector extension',
  install: [
    {
      id: 'extension.vector',
      label: 'Enable extension "vector"',
      summary: 'Ensures the vector extension is available for pgvector operations',
      operationClass: 'additive',
      target: { id: 'postgres' },
      precheck: [
        {
          description: 'verify extension "vector" is not already enabled',
          sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
        },
      ],
      execute: [
        {
          description: 'create extension "vector"',
          sql: 'CREATE EXTENSION IF NOT EXISTS vector',
        },
      ],
      postcheck: [
        {
          description: 'confirm extension "vector" is enabled',
          sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
        },
      ],
    },
  ],
};

function createPgvectorComponent(): SqlControlExtensionDescriptor<'postgres'> {
  return {
    kind: 'extension',
    id: 'pgvector',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    operationSignatures: () => [],
    databaseDependencies: { init: [pgvectorDependency] },
    create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
  };
}

function createAdapterHooksComponent(): TargetBoundComponentDescriptor<'sql', string> {
  const parameterizedTypeHooks: CodecControlHooks = {
    expandNativeType: expandParameterizedNativeType,
  };

  // Intentionally minimal test double for planner/contractToSchemaIR wiring.
  // Concrete enum hook behavior is covered in adapter enum-control-hooks tests.
  const enumHooks: CodecControlHooks = {
    planTypeOperations: ({ typeName, typeInstance, schema, schemaName }) => {
      const values = typeInstance.typeParams?.['values'] as string[] | undefined;
      if (!values || values.length === 0) return { operations: [] };

      const storageTypes = (schema.annotations?.['pg'] as Record<string, unknown> | undefined)?.[
        'storageTypes'
      ] as Record<string, unknown> | undefined;

      if (storageTypes?.[typeInstance.nativeType]) {
        return { operations: [] };
      }

      return {
        operations: [
          {
            id: `type.${typeName}`,
            label: `Create type ${typeName}`,
            operationClass: 'additive' as const,
            target: { id: 'postgres' },
            precheck: [],
            execute: [
              {
                description: `create type "${typeName}"`,
                sql: `CREATE TYPE "${schemaName ?? 'public'}"."${typeInstance.nativeType}" AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`,
              },
            ],
            postcheck: [],
          },
        ],
      };
    },
  };

  return {
    kind: 'adapter',
    id: 'test-adapter',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    types: {
      codecTypes: {
        controlPlaneHooks: {
          'sql/char@1': parameterizedTypeHooks,
          'pg/timestamptz@1': parameterizedTypeHooks,
          'pg/enum@1': enumHooks,
        },
      },
    },
  };
}

const DEMO_BASE_STORAGE: SqlStorage = {
  tables: {
    user: table({
      columns: {
        id: col({
          nativeType: 'character',
          codecId: 'sql/char@1',
          typeParams: { length: 36 },
        }),
        email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
        createdAt: col({
          nativeType: 'timestamptz',
          codecId: 'pg/timestamptz@1',
          default: { kind: 'function', expression: 'now()' },
        }),
        kind: col({
          nativeType: 'user_type',
          codecId: 'pg/enum@1',
          typeRef: 'user_type',
        }),
      },
      primaryKey: { columns: ['id'] },
      uniques: [{ columns: ['email'] }],
    }),
    post: table({
      columns: {
        id: col({
          nativeType: 'character',
          codecId: 'sql/char@1',
          typeParams: { length: 36 },
        }),
        title: col({ nativeType: 'text', codecId: 'pg/text@1' }),
        userId: col({
          nativeType: 'character',
          codecId: 'sql/char@1',
          typeParams: { length: 36 },
        }),
        createdAt: col({
          nativeType: 'timestamptz',
          codecId: 'pg/timestamptz@1',
          default: { kind: 'function', expression: 'now()' },
        }),
        embedding: col({
          nativeType: 'vector',
          codecId: 'pg/vector@1',
          nullable: true,
        }),
      },
      primaryKey: { columns: ['id'] },
      foreignKeys: [
        {
          columns: ['userId'],
          references: { table: 'user', columns: ['id'] },
          constraint: true,
          index: true,
        },
      ],
    }),
  },
  types: {
    user_type: {
      codecId: 'pg/enum@1',
      nativeType: 'user_type',
      typeParams: { values: ['admin', 'user'] },
    },
  },
};

function createDemoContract(
  storage: SqlStorage,
  overrides?: Partial<SqlContract<SqlStorage>>,
): SqlContract<SqlStorage> {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: coreHash('sha256:demo'),
    profileHash: profileHash('sha256:demo-profile'),
    storage,
    models: {},
    relations: {},
    mappings: {},
    capabilities: {},
    extensionPacks: { pgvector: {} },
    meta: {},
    sources: {},
    ...overrides,
  };
}

describe('incremental migration with full contract surface (extensions, enums, FKs)', () => {
  const frameworkComponents = [createPgvectorComponent(), createAdapterHooksComponent()];

  it('only emits ops for the actual change when adding a column to an existing table', () => {
    const toStorage: SqlStorage = {
      ...DEMO_BASE_STORAGE,
      tables: {
        ...DEMO_BASE_STORAGE.tables,
        user: table({
          ...DEMO_BASE_STORAGE.tables['user']!,
          columns: {
            ...DEMO_BASE_STORAGE.tables['user']!.columns,
            name: col({ nativeType: 'text', codecId: 'pg/text@1', nullable: true }),
          },
        }),
      },
    };

    const fromSchemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
      frameworkComponents,
    });
    const toContract = createDemoContract(toStorage);
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract: toContract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const opIds = result.plan.operations.map((op) => op.id);

    expect(opIds).toEqual(['column.user.name']);
    expect(opIds).not.toContain('extension.vector');
    expect(opIds.filter((id) => id.startsWith('type.'))).toHaveLength(0);
  });

  it('produces no ops when from and to storages are identical (with extensions and types)', () => {
    const fromSchemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
      frameworkComponents,
    });
    const toContract = createDemoContract(DEMO_BASE_STORAGE);
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract: toContract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    expect(result.plan.operations).toHaveLength(0);
  });

  it('emits all ops on initial migration from empty state', () => {
    const fromSchemaIR = contractToSchemaIR(null, {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const toContract = createDemoContract(DEMO_BASE_STORAGE);
    const planner = createPostgresMigrationPlanner();

    const result = planner.plan({
      contract: toContract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const opIds = result.plan.operations.map((op) => op.id);
    expect(opIds).toContain('extension.vector');
    expect(opIds.some((id) => id.startsWith('type.'))).toBe(true);
    expect(opIds.some((id) => id.startsWith('table.'))).toBe(true);
  });

  it('contractToSchemaIR derives dependencies from framework components', () => {
    const schemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
      frameworkComponents,
    });
    expect(schemaIR.dependencies).toContainEqual({ id: 'postgres.extension.vector' });
  });

  it('contractToSchemaIR derives annotations from contract storage types', () => {
    const schemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
      frameworkComponents,
    });
    const pgAnnotations = schemaIR.annotations?.['pg'] as Record<string, unknown> | undefined;
    const storageTypes = pgAnnotations?.['storageTypes'] as Record<string, unknown> | undefined;
    expect(storageTypes).toBeDefined();
    expect(storageTypes?.['user_type']).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'user_type',
    });
  });

  it('contractToSchemaIR defaults to empty dependencies when no framework components given', () => {
    const schemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    expect(schemaIR.dependencies).toEqual([]);
  });
});
