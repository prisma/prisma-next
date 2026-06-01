import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  assertReturningCapability,
  hasContractCapability,
  isToOneCardinality,
  resolveIncludeRelation,
  resolveModelRelations,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumn,
  resolveRowIdentityColumns,
  resolveUpsertConflictColumns,
} from '../src/collection-contract';
import { buildMixedPolyContract, getTestContract, withPatchedDomainModels } from './helpers';
import { unboundTables } from './unbound-tables';

describe('collection-contract capability detection', () => {
  it('detects top-level capability flags', () => {
    const contract = getTestContract();
    const withTopLevelCapability = {
      ...contract,
      capabilities: { returning: true },
    } as unknown as typeof contract;

    expect(hasContractCapability(withTopLevelCapability, 'returning')).toBe(true);
  });

  it('detects target-scoped capability flags from generated contracts', () => {
    const contract = getTestContract();
    const withTargetCapability = {
      ...contract,
      capabilities: {
        postgres: {
          returning: true,
          lateral: true,
        },
      },
    } as typeof contract;

    expect(hasContractCapability(withTargetCapability, 'returning')).toBe(true);
    expect(hasContractCapability(withTargetCapability, 'lateral')).toBe(true);
  });

  it('assertReturningCapability accepts target-scoped returning flags', () => {
    const contract = getTestContract();
    const withTargetCapability = {
      ...contract,
      capabilities: {
        postgres: {
          returning: true,
        },
      },
    } as typeof contract;

    expect(() => assertReturningCapability(withTargetCapability, 'create()')).not.toThrow();
  });

  it('assertReturningCapability throws when returning is unavailable', () => {
    const contract = { ...getTestContract(), capabilities: {} };
    expect(() => assertReturningCapability(contract, 'create()')).toThrow(
      /requires contract capability "returning"/,
    );
  });

  it('resolveIncludeRelation() reads relation metadata from model.relations', () => {
    const contract = getTestContract();

    expect(resolveIncludeRelation(contract, 'User', 'posts')).toEqual({
      relatedModelName: 'Post',
      relatedTableName: 'posts',
      targetColumn: 'user_id',
      localColumn: 'id',
      cardinality: '1:N',
    });
  });

  it('keeps the 1:1 profile relation backed by a unique child key', () => {
    const contract = getTestContract();

    expect(unboundTables(contract.storage)['profiles']!.uniques).toContainEqual({
      columns: ['user_id'],
    });
  });

  it('resolveIncludeRelation() throws for missing or malformed relations', () => {
    const contract = getTestContract();

    expect(() => resolveIncludeRelation(contract, 'User', 'missing')).toThrow(/not found/);

    const malformed = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: '__unbound__' },
            on: { localFields: 'id', targetFields: ['userId'] },
          },
        },
      },
    }));

    expect(() => resolveIncludeRelation(malformed, 'User', 'posts')).toThrow(/not found/);
  });

  it('resolveIncludeRelation() handles incomplete relation metadata', () => {
    const contract = getTestContract();

    const incompleteRelation = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: '__unbound__' },
            cardinality: 'unsupported',
            on: {
              localFields: [],
              targetFields: [],
            },
          },
        },
      },
    }));

    expect(() => resolveIncludeRelation(incompleteRelation, 'User', 'posts')).toThrow(
      /incomplete join metadata/,
    );
  });

  it('resolveUpsertConflictColumns() maps explicit criteria and falls back to primary key', () => {
    const contract = getTestContract();

    expect(resolveUpsertConflictColumns(contract, 'Post', { userId: 'x', title: 'y' })).toEqual([
      'user_id',
      'title',
    ]);
    expect(resolveUpsertConflictColumns(contract, 'Post', undefined)).toEqual(['id']);
    expect(resolveUpsertConflictColumns(contract, 'Post', {})).toEqual(['id']);
  });

  it('resolveUpsertConflictColumns() falls back for unmapped fields and unknown models', () => {
    const contract = getTestContract();

    expect(resolveUpsertConflictColumns(contract, 'Post', { unknownField: 'x' })).toEqual([
      'unknownField',
    ]);
    expect(resolveUpsertConflictColumns(contract, 'UnknownModel', { custom: 1 })).toEqual([
      'custom',
    ]);
  });

  it('resolveModelTableName() resolves from storage.table and throws when missing', () => {
    const contract = getTestContract();

    expect(resolveModelTableName(contract, 'User')).toBe('users');
    expect(() => resolveModelTableName(contract, 'UnknownModel')).toThrow(
      'Model "UnknownModel" not found in contract',
    );
    expect(resolvePrimaryKeyColumn(contract, 'users')).toBe('id');
    expect(resolvePrimaryKeyColumn(contract, 'unknown_table')).toBe('id');
  });

  it('resolveModelTableName() reads from storage.table and throws for invalid values', () => {
    const contract = getTestContract();
    const withStorageFallback = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as { storage: Record<string, unknown> }),
        storage: {
          ...(models['User'] as { storage: Record<string, unknown> }).storage,
          table: 'users_from_storage',
        },
      },
    }));

    expect(resolveModelTableName(withStorageFallback, 'User')).toBe('users_from_storage');

    const invalidStorageTable = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        storage: {
          table: 123,
        },
      },
    }));

    expect(() => resolveModelTableName(invalidStorageTable, 'User')).toThrow(
      'Model "User" has invalid or missing storage.table in the contract',
    );
  });

  it('hasContractCapability() checks nested object flags and invalid target entries', () => {
    const contract = getTestContract();
    const withNestedCapability = {
      ...contract,
      capabilities: {
        postgres: {
          returning: {
            enabled: true,
          },
        },
        sqlite: 'unsupported',
      },
    } as unknown as typeof contract;

    expect(hasContractCapability(withNestedCapability, 'returning')).toBe(true);
    expect(hasContractCapability(withNestedCapability, 'jsonAgg')).toBe(false);
  });

  it('hasContractCapability() returns false when no capabilities are set', () => {
    const contract = getTestContract();
    const withEmptyCapabilities = {
      ...contract,
      capabilities: {},
    } as typeof contract;

    expect(hasContractCapability(withEmptyCapabilities, 'returning')).toBe(false);
  });

  it('isToOneCardinality() identifies to-one relations', () => {
    expect(isToOneCardinality('1:1')).toBe(true);
    expect(isToOneCardinality('N:1')).toBe(true);
    expect(isToOneCardinality('1:N')).toBe(false);
    expect(isToOneCardinality('N:M')).toBe(false);
    expect(isToOneCardinality(undefined)).toBe(false);
  });

  describe('resolveRowIdentityColumns()', () => {
    const buildContract = (table: {
      primaryKey?: { columns: readonly string[] };
      uniques?: ReadonlyArray<{ columns: readonly string[] }>;
    }) =>
      ({
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                table: {
                  t: {
                    primaryKey: table.primaryKey,
                    uniques: table.uniques ?? [],
                  },
                },
              },
            },
          },
        },
      }) as unknown as Parameters<typeof resolveRowIdentityColumns>[0];

    it('returns primary key columns when present', () => {
      expect(
        resolveRowIdentityColumns(buildContract({ primaryKey: { columns: ['id'] } }), 't'),
      ).toEqual(['id']);
    });

    it('returns composite primary key columns when present', () => {
      expect(
        resolveRowIdentityColumns(buildContract({ primaryKey: { columns: ['a', 'b'] } }), 't'),
      ).toEqual(['a', 'b']);
    });

    it('falls back to first unique constraint when no primary key', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ uniques: [{ columns: ['email'] }, { columns: ['handle'] }] }),
          't',
        ),
      ).toEqual(['email']);
    });

    it('returns composite unique columns when no primary key', () => {
      expect(
        resolveRowIdentityColumns(
          buildContract({ uniques: [{ columns: ['tenant_id', 'slug'] }] }),
          't',
        ),
      ).toEqual(['tenant_id', 'slug']);
    });

    it('returns empty array when neither primary key nor uniques are defined', () => {
      expect(resolveRowIdentityColumns(buildContract({}), 't')).toEqual([]);
    });

    it('returns empty array for unknown tables', () => {
      expect(
        resolveRowIdentityColumns(buildContract({ primaryKey: { columns: ['id'] } }), 'missing'),
      ).toEqual([]);
    });
  });
});

describe('resolvePolymorphismInfo()', () => {
  it('returns undefined for non-polymorphic models', () => {
    const contract = getTestContract();
    expect(resolvePolymorphismInfo(contract, 'User')).toBeUndefined();
  });

  it('classifies Bug as STI (same table as Task)', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'Task');
    expect(info).toBeDefined();
    const bugVariant = info!.variants.get('Bug');
    expect(bugVariant).toBeDefined();
    expect(bugVariant!.strategy).toBe('sti');
    expect(bugVariant!.table).toBe('tasks');
    expect(bugVariant!.value).toBe('bug');
  });

  it('classifies Feature as MTI (different table from Task)', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'Task');
    expect(info).toBeDefined();
    const featureVariant = info!.variants.get('Feature');
    expect(featureVariant).toBeDefined();
    expect(featureVariant!.strategy).toBe('mti');
    expect(featureVariant!.table).toBe('features');
    expect(featureVariant!.value).toBe('feature');
  });

  it('resolves discriminator field and column', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'Task')!;
    expect(info.discriminatorField).toBe('type');
    expect(info.discriminatorColumn).toBe('type');
    expect(info.baseTable).toBe('tasks');
  });

  it('populates variantsByValue keyed by discriminator value', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'Task')!;
    expect(info.variantsByValue.get('bug')?.modelName).toBe('Bug');
    expect(info.variantsByValue.get('feature')?.modelName).toBe('Feature');
  });

  it('populates mtiVariants with only MTI variants', () => {
    const contract = buildMixedPolyContract();
    const info = resolvePolymorphismInfo(contract, 'Task')!;
    expect(info.mtiVariants).toHaveLength(1);
    expect(info.mtiVariants[0]!.modelName).toBe('Feature');
  });

  it('caches results per (contract, modelName)', () => {
    const contract = buildMixedPolyContract();
    const first = resolvePolymorphismInfo(contract, 'Task');
    const second = resolvePolymorphismInfo(contract, 'Task');
    expect(first).toBe(second);
  });

  it('returns undefined for variant models themselves', () => {
    const contract = buildMixedPolyContract();
    expect(resolvePolymorphismInfo(contract, 'Bug')).toBeUndefined();
    expect(resolvePolymorphismInfo(contract, 'Feature')).toBeUndefined();
  });

  it('throws when a declared variant model is missing from the contract', () => {
    const contract = buildMixedPolyContract();
    const withoutBug = withPatchedDomainModels(contract, (models) => {
      const { Bug: _removed, ...rest } = models;
      return rest;
    });
    expect(() => resolvePolymorphismInfo(withoutBug, 'Task')).toThrow(
      /declares variant "Bug", but that model is missing/,
    );
  });
});

describe('resolveModelRelations() through descriptor', () => {
  type RawColumn = { nativeType: string; codecId: string; nullable: boolean; default?: unknown };

  function buildManyToManyContract(opts: {
    junctionTable: string;
    parentColumns: string[];
    childColumns: string[];
    targetColumns: string[];
    extraColumns?: Record<string, RawColumn>;
  }): Contract<SqlStorage> {
    const { junctionTable, parentColumns, childColumns, targetColumns, extraColumns = {} } = opts;

    const junctionStorageColumns: Record<string, RawColumn> = {};
    for (const col of parentColumns) {
      junctionStorageColumns[col] = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
    }
    for (const col of childColumns) {
      junctionStorageColumns[col] = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false };
    }
    for (const [name, col] of Object.entries(extraColumns)) {
      junctionStorageColumns[name] = col;
    }

    return {
      domain: {
        namespaces: {
          public: {
            id: 'public',
            models: {
              Parent: {
                fields: { id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
                relations: {
                  children: {
                    to: { model: 'Child', namespace: 'public' },
                    cardinality: 'N:M',
                    on: { localFields: ['id'], targetFields: targetColumns },
                    through: {
                      table: junctionTable,
                      parentColumns,
                      childColumns,
                      targetColumns,
                    },
                  },
                },
                storage: { table: 'parents', fields: { id: { column: 'id' } } },
              },
              Child: {
                fields: { id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
                relations: {},
                storage: { table: 'children', fields: { id: { column: 'id' } } },
              },
              Junction: {
                fields: {},
                relations: {},
                storage: { table: junctionTable, fields: {} },
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          public: {
            id: 'public',
            tables: {
              parents: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              children: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              [junctionTable]: {
                columns: junctionStorageColumns,
                primaryKey: { columns: [...parentColumns, ...childColumns] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
      capabilities: {},
    } as unknown as Contract<SqlStorage>;
  }

  it('populates through descriptor for a simple single-column M:N relation', () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });

    const relations = resolveModelRelations(contract, 'Parent');
    expect(relations['children']?.through).toEqual({
      table: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
      requiredPayloadColumns: [],
    });
  });

  it('populates through descriptor for a composite-key M:N junction', () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
    });

    const relations = resolveModelRelations(contract, 'Parent');
    const through = relations['children']?.through;
    expect(through?.parentColumns).toEqual(['tenant_id', 'parent_id']);
    expect(through?.childColumns).toEqual(['tenant_id', 'child_id']);
    expect(through?.targetColumns).toEqual(['tenant_id', 'id']);
    expect(through?.requiredPayloadColumns).toEqual([]);
  });

  it('includes NOT-NULL no-default non-FK columns in requiredPayloadColumns', () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
      extraColumns: {
        assigned_at: { nativeType: 'timestamptz', codecId: 'pg/timestamptz@1', nullable: false },
        role: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      },
    });

    const relations = resolveModelRelations(contract, 'Parent');
    expect(relations['children']?.through?.requiredPayloadColumns).toEqual(
      expect.arrayContaining(['assigned_at', 'role']),
    );
    expect(relations['children']?.through?.requiredPayloadColumns).toHaveLength(2);
  });

  it('excludes nullable and defaulted non-FK columns from requiredPayloadColumns', () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
      extraColumns: {
        note: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
        created_at: {
          nativeType: 'timestamptz',
          codecId: 'pg/timestamptz@1',
          nullable: false,
          default: { kind: 'expression', sql: 'now()' },
        },
      },
    });

    const relations = resolveModelRelations(contract, 'Parent');
    expect(relations['children']?.through?.requiredPayloadColumns).toEqual([]);
  });
});
