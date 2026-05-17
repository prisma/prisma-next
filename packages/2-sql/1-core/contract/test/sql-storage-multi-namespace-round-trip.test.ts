import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { col, pk } from '../src/factories';
import { findTableByCoord, iterateTablesWithCoords, SqlStorage } from '../src/ir/sql-storage';
import { StorageTable } from '../src/ir/storage-table';
import { validateStorage } from '../src/validators';

/**
 * Multi-namespace SqlStorage JSON round-trip coverage.
 *
 * Verifies that a multi-namespace contract authored via the nested
 * `SqlStorage` input shape serialises to the FR15 nested JSON envelope
 * and round-trips back through `validateStorage`. The JSON envelope is
 * unconditionally nested: `{ tables: { [namespaceId]: { [tableName]:
 * ... } } }`. Same-named tables across distinct namespaces (e.g.
 * `auth.User` + `public.User`) coexist in their own buckets without
 * collision.
 */

const sha = 'sha256:multi-ns-round-trip' as const;

function makeTable(name: string, namespaceId: string): StorageTable {
  return new StorageTable({
    columns: { id: col('uuid', 'pg/uuid@1') },
    primaryKey: pk('id'),
    uniques: [],
    indexes: [],
    foreignKeys: [],
    namespaceId,
  });
}

describe('SqlStorage multi-namespace JSON round-trip', () => {
  it('preserves every (namespaceId, name) coordinate through stringify → parse → reconstruct', () => {
    const source = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        public: {
          Post: makeTable('Post', 'public'),
          Comment: makeTable('Comment', 'public'),
        },
        auth: {
          Account: makeTable('Account', 'auth'),
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(source)) as {
      tables: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(envelope.tables).sort()).toEqual(['auth', 'public']);
    expect(Object.keys(envelope.tables['public']!).sort()).toEqual(['Comment', 'Post']);
    expect(Object.keys(envelope.tables['auth']!)).toEqual(['Account']);

    const rehydrated = validateStorage(envelope);

    const coords = [...iterateTablesWithCoords(rehydrated)]
      .map(({ namespaceId, name }) => `${namespaceId}.${name}`)
      .sort();
    expect(coords).toEqual(['auth.Account', 'public.Comment', 'public.Post']);

    expect(findTableByCoord(rehydrated, 'public', 'Post')).toBeDefined();
    expect(findTableByCoord(rehydrated, 'public', 'Comment')).toBeDefined();
    expect(findTableByCoord(rehydrated, 'auth', 'Account')).toBeDefined();
    expect(findTableByCoord(rehydrated, 'public', 'Account')).toBeUndefined();
  });

  it('wraps single-namespace contracts under the bound namespace bucket (unconditional FR15 envelope)', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        User: makeTable('User', UNBOUND_NAMESPACE_ID),
        Post: makeTable('Post', UNBOUND_NAMESPACE_ID),
      },
    });

    const envelope = JSON.parse(JSON.stringify(storage)) as Record<string, unknown>;
    expect(envelope).toHaveProperty('tables');
    const tables = envelope['tables'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(tables)).toEqual([UNBOUND_NAMESPACE_ID]);
    expect(Object.keys(tables[UNBOUND_NAMESPACE_ID]!).sort()).toEqual(['Post', 'User']);
  });

  it("multi-namespace contracts surface each table's namespaceId in the JSON envelope", () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        public: { Post: makeTable('Post', 'public') },
        auth: { Account: makeTable('Account', 'auth') },
      },
    });

    const envelope = JSON.parse(JSON.stringify(storage)) as {
      tables: Record<string, Record<string, { namespaceId?: string }>>;
    };
    expect(envelope.tables['public']?.['Post']?.namespaceId).toBe('public');
    expect(envelope.tables['auth']?.['Account']?.namespaceId).toBe('auth');
  });

  it('expresses same-name-across-namespaces collisions via the nested buckets (FR15)', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { User: makeTable('User', 'auth') },
        public: { User: makeTable('User', 'public') },
      },
    });

    const envelope = JSON.parse(JSON.stringify(storage)) as {
      tables: Record<string, unknown>;
    };
    expect(Object.keys(envelope.tables).sort()).toEqual(['auth', 'public']);
    const authBucket = envelope.tables['auth'] as Record<string, unknown>;
    const publicBucket = envelope.tables['public'] as Record<string, unknown>;
    expect(authBucket).toHaveProperty('User');
    expect(publicBucket).toHaveProperty('User');
  });

  it('rehydrates the nested envelope back through validateStorage to a dual-view IR', () => {
    const original = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { User: makeTable('User', 'auth') },
        public: { User: makeTable('User', 'public') },
      },
    });

    const envelope = JSON.parse(JSON.stringify(original));
    const rehydrated = validateStorage(envelope);

    const coords = [...iterateTablesWithCoords(rehydrated)]
      .map(({ namespaceId, name }) => `${namespaceId}.${name}`)
      .sort();
    expect(coords).toEqual(['auth.User', 'public.User']);
    expect(findTableByCoord(rehydrated, 'auth', 'User')?.namespaceId).toBe('auth');
    expect(findTableByCoord(rehydrated, 'public', 'User')?.namespaceId).toBe('public');
  });

  it('rehydrates a multi-namespace envelope (no name collisions) back through validateStorage', () => {
    const original = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { Account: makeTable('Account', 'auth') },
        public: { Post: makeTable('Post', 'public') },
      },
    });

    const envelope = JSON.parse(JSON.stringify(original)) as {
      tables: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(envelope.tables).sort()).toEqual(['auth', 'public']);

    const rehydrated = validateStorage(envelope);
    expect(findTableByCoord(rehydrated, 'auth', 'Account')?.namespaceId).toBe('auth');
    expect(findTableByCoord(rehydrated, 'public', 'Post')?.namespaceId).toBe('public');
  });
});
