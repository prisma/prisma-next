import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { MigrationPlannerResult } from '@prisma-next/core-control-plane/types';
import { contractToSchemaIR, detectDestructiveChanges } from '@prisma-next/family-sql/control';
import type {
  SqlContract,
  SqlStorage,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';

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
    mappings: { codecTypes: {}, operationTypes: {} },
    capabilities: {},
    extensionPacks: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

function planFromStorages(from: SqlStorage | null, to: SqlStorage): MigrationPlannerResult {
  const toContract = createTestContract(to);
  const fromSchemaIR = contractToSchemaIR(from ?? { tables: {} });
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
    const schemaIR = contractToSchemaIR(storage);
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
    const emptySchemaIR = contractToSchemaIR({ tables: {} });
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
    const fromSchemaIR = contractToSchemaIR(fromStorage);
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
              default: { kind: 'literal', expression: "'active'" },
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
    const schemaIR = contractToSchemaIR(storage);
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
