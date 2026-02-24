import { describe, expect, it } from 'vitest';
import {
  assertReturningCapability,
  hasContractCapability,
  isToOneCardinality,
  resolveIncludeRelation,
  resolveModelTableName,
  resolvePrimaryKeyColumn,
  resolveUpsertConflictColumns,
} from '../src/collection-contract';
import { createTestContract } from './helpers';

describe('collection-contract capability detection', () => {
  it('detects top-level capability flags', () => {
    const contract = createTestContract();
    const withTopLevelCapability = {
      ...contract,
      capabilities: { returning: true },
    } as unknown as typeof contract;

    expect(hasContractCapability(withTopLevelCapability, 'returning')).toBe(true);
  });

  it('detects target-scoped capability flags from generated contracts', () => {
    const contract = createTestContract();
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
    const contract = createTestContract();
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
    const contract = createTestContract();
    expect(() => assertReturningCapability(contract, 'create()')).toThrow(
      /requires contract capability "returning"/,
    );
  });

  it('resolveIncludeRelation() reads relation metadata from contract.relations', () => {
    const contract = createTestContract();

    expect(resolveIncludeRelation(contract, 'User', 'posts')).toEqual({
      relatedModelName: 'Post',
      relatedTableName: 'posts',
      fkColumn: 'user_id',
      parentPkColumn: 'id',
      cardinality: '1:N',
    });
  });

  it('resolveIncludeRelation() falls back to legacy model relation metadata', () => {
    const contract = createTestContract();
    const legacyContract = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {},
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          relations: {
            posts: {
              model: 'Post',
              foreignKey: 'user_id',
            },
          },
        },
      },
    } as unknown as typeof contract;

    expect(resolveIncludeRelation(legacyContract, 'User', 'posts')).toEqual({
      relatedModelName: 'Post',
      relatedTableName: 'posts',
      fkColumn: 'user_id',
      parentPkColumn: 'id',
      cardinality: '1:N',
    });
  });

  it('resolveIncludeRelation() legacy fallback uses "id" when parent primary key is unavailable', () => {
    const contract = createTestContract();
    const legacyWithoutPk = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {},
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          relations: {
            posts: {
              model: 'Post',
              foreignKey: 'user_id',
            },
          },
        },
      },
      storage: {
        ...contract.storage,
        tables: {
          ...contract.storage.tables,
          users: {
            ...contract.storage.tables.users,
            primaryKey: undefined,
          },
        },
      },
    } as unknown as typeof contract;

    expect(resolveIncludeRelation(legacyWithoutPk, 'User', 'posts')).toMatchObject({
      parentPkColumn: 'id',
    });
  });

  it('resolveIncludeRelation() throws for missing or malformed relations', () => {
    const contract = createTestContract();

    expect(() => resolveIncludeRelation(contract, 'User', 'missing')).toThrow(/not found/);

    const malformed = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {
          posts: {
            to: 'Post',
            on: { parentCols: 'id', childCols: ['user_id'] },
          },
        },
      },
    } as unknown as typeof contract;

    expect(() => resolveIncludeRelation(malformed, 'User', 'posts')).toThrow(/not found/);
  });

  it('resolveIncludeRelation() handles incomplete relation metadata and malformed legacy relations', () => {
    const contract = createTestContract();

    const incompleteRelation = {
      ...contract,
      relations: {
        ...contract.relations,
        users: {
          posts: {
            to: 'Post',
            cardinality: 'unsupported',
            on: {
              parentCols: [],
              childCols: [],
            },
          },
        },
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          relations: {
            posts: {
              model: 123,
              foreignKey: null,
            },
          },
        },
      },
    } as unknown as typeof contract;

    expect(() => resolveIncludeRelation(incompleteRelation, 'User', 'posts')).toThrow(/not found/);
  });

  it('resolveUpsertConflictColumns() maps explicit criteria and falls back to primary key', () => {
    const contract = createTestContract();

    expect(resolveUpsertConflictColumns(contract, 'Post', { userId: 'x', title: 'y' })).toEqual([
      'user_id',
      'title',
    ]);
    expect(resolveUpsertConflictColumns(contract, 'Post', undefined)).toEqual(['id']);
    expect(resolveUpsertConflictColumns(contract, 'Post', {})).toEqual(['id']);
  });

  it('resolveUpsertConflictColumns() falls back for unmapped fields and unknown models', () => {
    const contract = createTestContract();

    expect(resolveUpsertConflictColumns(contract, 'Post', { unknownField: 'x' })).toEqual([
      'unknownField',
    ]);
    expect(resolveUpsertConflictColumns(contract, 'UnknownModel', { custom: 1 })).toEqual([
      'custom',
    ]);
  });

  it('resolveModelTableName() and resolvePrimaryKeyColumn() apply fallback behavior', () => {
    const contract = createTestContract();

    expect(resolveModelTableName(contract, 'User')).toBe('users');
    expect(resolveModelTableName(contract, 'UnknownModel')).toBe('unknownmodel');
    expect(resolvePrimaryKeyColumn(contract, 'users')).toBe('id');
    expect(resolvePrimaryKeyColumn(contract, 'unknown_table')).toBe('id');
  });

  it('resolveModelTableName() falls back to model storage metadata when mapping is missing', () => {
    const contract = createTestContract();
    const withStorageFallback = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {},
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          storage: {
            table: 'users_from_storage',
          },
        },
      },
    } as unknown as typeof contract;

    expect(resolveModelTableName(withStorageFallback, 'User')).toBe('users_from_storage');

    const invalidStorageTable = {
      ...withStorageFallback,
      models: {
        ...withStorageFallback.models,
        User: {
          ...withStorageFallback.models.User,
          storage: {
            table: 123,
          },
        },
      },
    } as unknown as typeof contract;

    expect(resolveModelTableName(invalidStorageTable, 'User')).toBe('user');
  });

  it('hasContractCapability() checks nested object flags and invalid target entries', () => {
    const contract = createTestContract();
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

  it('hasContractCapability() returns false when capabilities are absent', () => {
    const contract = createTestContract();
    const withoutCapabilities = {
      ...contract,
      capabilities: undefined,
    } as unknown as typeof contract;

    expect(hasContractCapability(withoutCapabilities, 'returning')).toBe(false);
  });

  it('isToOneCardinality() identifies to-one relations', () => {
    expect(isToOneCardinality('1:1')).toBe(true);
    expect(isToOneCardinality('N:1')).toBe(true);
    expect(isToOneCardinality('1:N')).toBe(false);
    expect(isToOneCardinality('M:N')).toBe(false);
    expect(isToOneCardinality(undefined)).toBe(false);
  });
});
