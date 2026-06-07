import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { resolveCrossSpaceFkTableName } from '../src/aggregate/resolve-cross-space-fk';

function makeExtensionContract(
  namespaces: Record<string, Record<string, { storage: { table: string }; columns?: string[] }>>,
): Contract {
  const domainNamespaces: Record<string, unknown> = {};
  const storageNamespaces: Record<string, unknown> = {};

  for (const [nsId, models] of Object.entries(namespaces)) {
    const domainModels: Record<string, unknown> = {};
    const storageTables: Record<string, unknown> = {};

    for (const [modelName, model] of Object.entries(models)) {
      domainModels[modelName] = { fields: {}, relations: {}, storage: model.storage };
      const columns: Record<string, unknown> = {};
      for (const col of model.columns ?? []) {
        columns[col] = { type: 'text', nullable: false };
      }
      storageTables[model.storage.table] = {
        columns,
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
    }

    domainNamespaces[nsId] = { models: domainModels };
    storageNamespaces[nsId] = { id: nsId, entries: { table: storageTables } };
  }

  return blindCast<Contract, 'test-only synthetic extension contract for resolver unit tests'>({
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: { namespaces: domainNamespaces },
    storage: {
      storageHash: coreHash('sha256:test'),
      namespaces: storageNamespaces,
    },
    capabilities: {},
    extensionPacks: {},
    profileHash: profileHash('sha256:test-profile'),
    meta: {},
  });
}

describe('resolveCrossSpaceFkTableName', () => {
  describe('exact table name match (TS path)', () => {
    it('returns the tableName unchanged when a model has that exact storage table', () => {
      const contract = makeExtensionContract({
        auth: {
          AuthUser: { storage: { table: 'users' } },
        },
      });

      const result = resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'users');
      expect(result).toBe('users');
    });

    it('returns the tableName unchanged for a different exact match', () => {
      const contract = makeExtensionContract({
        auth: {
          AuthIdentity: { storage: { table: 'identities' } },
        },
      });

      const result = resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'identities');
      expect(result).toBe('identities');
    });
  });

  describe('model-name-lowercase match (PSL symbolic fallback)', () => {
    it('resolves symbolic tableName via modelName.toLowerCase() to the real storage table', () => {
      const contract = makeExtensionContract({
        auth: {
          User: { storage: { table: 'users' } },
        },
      });

      // PSL produces 'user' from fieldTypeName 'User'.toLowerCase()
      const result = resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'user');
      expect(result).toBe('users');
    });

    it('resolves via modelName.toLowerCase() when model name has mixed case', () => {
      const contract = makeExtensionContract({
        storage: {
          StorageBucket: { storage: { table: 'buckets' } },
        },
      });

      // PSL produces 'storagebucket' from 'StorageBucket'.toLowerCase()
      const result = resolveCrossSpaceFkTableName(contract, 'supabase', 'storage', 'storagebucket');
      expect(result).toBe('buckets');
    });
  });

  describe('miss diagnostics', () => {
    it('throws a clear error when the namespace does not exist in the extension contract', () => {
      const contract = makeExtensionContract({
        auth: {
          AuthUser: { storage: { table: 'users' } },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'nonexistent', 'users'),
      ).toThrow(
        'Cross-space FK resolution failed: namespace "nonexistent" not found in space "supabase"',
      );
    });

    it('throws listing available namespaces on namespace miss', () => {
      const contract = makeExtensionContract({
        auth: {
          AuthUser: { storage: { table: 'users' } },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'nonexistent', 'users'),
      ).toThrow('available namespaces: auth');
    });

    it('throws a clear error naming space/namespace/model when model is not found', () => {
      const contract = makeExtensionContract({
        auth: {
          AuthUser: { storage: { table: 'users' } },
          AuthIdentity: { storage: { table: 'identities' } },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'nonexistentmodel'),
      ).toThrow(
        'Cross-space FK resolution failed: model not found for tableName "nonexistentmodel" in space "supabase" namespace "auth"',
      );
    });

    it('throws listing available models on model miss', () => {
      const contract = makeExtensionContract({
        auth: {
          AuthUser: { storage: { table: 'users' } },
          AuthIdentity: { storage: { table: 'identities' } },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'nonexistentmodel'),
      ).toThrow('available models:');
    });
  });

  describe('local FK regression (no spaceId — untouched by resolver)', () => {
    it('resolves a local FK target tableName when passed directly (exact match)', () => {
      const contract = makeExtensionContract({
        public: {
          Post: { storage: { table: 'post' } },
        },
      });

      // Local FKs won't go through the resolver in the aggregate loader
      // (gated on target.spaceId !== undefined), but the resolver itself
      // still works correctly for same-space lookups.
      const result = resolveCrossSpaceFkTableName(contract, 'app', 'public', 'post');
      expect(result).toBe('post');
    });
  });

  describe('column-existence validation', () => {
    it('returns the resolved tableName when all target columns exist on the resolved table', () => {
      const contract = makeExtensionContract({
        auth: {
          User: { storage: { table: 'users' }, columns: ['id', 'email'] },
        },
      });

      const result = resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'user', ['id']);
      expect(result).toBe('users');
    });

    it('throws a diagnostic naming column/model/space/namespace when a column is missing', () => {
      const contract = makeExtensionContract({
        auth: {
          User: { storage: { table: 'users' }, columns: ['id', 'email'] },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'user', ['nonexistent_col']),
      ).toThrow(
        'column "nonexistent_col" not found on target model "User" in space "supabase" namespace "auth"',
      );
    });

    it('throws listing available columns in the diagnostic', () => {
      const contract = makeExtensionContract({
        auth: {
          User: { storage: { table: 'users' }, columns: ['id', 'email'] },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'user', ['nonexistent_col']),
      ).toThrow('available columns: id, email');
    });

    it('throws for the first missing column when multiple columns are referenced', () => {
      const contract = makeExtensionContract({
        auth: {
          User: { storage: { table: 'users' }, columns: ['id', 'email'] },
        },
      });

      expect(() =>
        resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'user', ['id', 'missing_col']),
      ).toThrow('column "missing_col" not found on target model "User"');
    });

    it('succeeds when no target columns are provided (empty array — no column check needed)', () => {
      const contract = makeExtensionContract({
        auth: {
          User: { storage: { table: 'users' }, columns: ['id', 'email'] },
        },
      });

      const result = resolveCrossSpaceFkTableName(contract, 'supabase', 'auth', 'user', []);
      expect(result).toBe('users');
    });
  });
});
