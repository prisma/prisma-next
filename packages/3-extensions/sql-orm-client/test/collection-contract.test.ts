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
import { getTestContract } from './helpers';

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

  it('resolveIncludeRelation() throws for missing or malformed relations', () => {
    const contract = getTestContract();

    expect(() => resolveIncludeRelation(contract, 'User', 'missing')).toThrow(/not found/);

    const malformed = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          relations: {
            posts: {
              to: 'Post',
              on: { localFields: 'id', targetFields: ['userId'] },
            },
          },
        },
      },
    } as unknown as typeof contract;

    expect(() => resolveIncludeRelation(malformed, 'User', 'posts')).toThrow(/not found/);
  });

  it('resolveIncludeRelation() handles incomplete relation metadata', () => {
    const contract = getTestContract();

    const incompleteRelation = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          relations: {
            posts: {
              to: 'Post',
              cardinality: 'unsupported',
              on: {
                localFields: [],
                targetFields: [],
              },
            },
          },
        },
      },
    } as unknown as typeof contract;

    expect(() => resolveIncludeRelation(incompleteRelation, 'User', 'posts')).toThrow(/not found/);
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
      'Model "UnknownModel" is missing storage.table in the contract',
    );
    expect(resolvePrimaryKeyColumn(contract, 'users')).toBe('id');
    expect(resolvePrimaryKeyColumn(contract, 'unknown_table')).toBe('id');
  });

  it('resolveModelTableName() reads from storage.table and throws for invalid values', () => {
    const contract = getTestContract();
    const withStorageFallback = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          storage: {
            ...contract.models.User.storage,
            table: 'users_from_storage',
          },
        },
      },
    } as unknown as typeof contract;

    expect(resolveModelTableName(withStorageFallback, 'User')).toBe('users_from_storage');

    const invalidStorageTable = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          storage: {
            table: 123,
          },
        },
      },
    } as unknown as typeof contract;

    expect(() => resolveModelTableName(invalidStorageTable, 'User')).toThrow(
      'Model "User" is missing storage.table in the contract',
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

  it('hasContractCapability() returns false when capabilities are absent', () => {
    const contract = getTestContract();
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
