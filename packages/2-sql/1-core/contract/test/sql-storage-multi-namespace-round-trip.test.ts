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
 * `SqlStorage` input shape serialises to a JSON envelope from which the
 * exact same `(namespaceId, tableName)` coordinates can be reconstructed.
 *
 * The flat `tables` view ships as the JSON-visible payload (the nested
 * `tablesByNamespace` projection is non-enumerable, preserving
 * byte-identical hashes for single-namespace contracts). Each table
 * carries its `namespaceId` back-pointer through the envelope, and the
 * constructor re-buckets the flat JSON input into the nested in-memory
 * truth — closing the authoring → emit → validate → hydrate loop for
 * multi-namespace contracts that don't collide on table name.
 *
 * Same-named-table-across-namespaces (e.g. auth.User + public.User) is
 * the F1 collision case; the flat JSON envelope cannot carry both
 * entries by design. That regression is pinned in
 * sql-storage-namespace-buckets.test.ts; this suite covers the
 * complementary "multi-namespace, distinct table names" case end-to-end.
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

    const serialised = JSON.stringify(source);
    const parsed = JSON.parse(serialised) as { tables: Record<string, unknown> };

    // The JSON envelope keeps the flat-by-name shape — the nested view
    // is non-enumerable. Each table carries its `namespaceId`
    // back-pointer, which the constructor uses to re-bucket the flat
    // input into the nested truth on hydration.
    expect(Object.keys(parsed.tables).sort()).toEqual(['Account', 'Comment', 'Post']);

    const rehydrated = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        Post: source.tables['Post']!,
        Comment: source.tables['Comment']!,
        Account: source.tables['Account']!,
      },
    });

    const coords = [...iterateTablesWithCoords(rehydrated)]
      .map(({ namespaceId, name }) => `${namespaceId}.${name}`)
      .sort();
    expect(coords).toEqual(['auth.Account', 'public.Comment', 'public.Post']);

    expect(findTableByCoord(rehydrated, 'public', 'Post')).toBeDefined();
    expect(findTableByCoord(rehydrated, 'public', 'Comment')).toBeDefined();
    expect(findTableByCoord(rehydrated, 'auth', 'Account')).toBeDefined();
    expect(findTableByCoord(rehydrated, 'public', 'Account')).toBeUndefined();
  });

  it('flattens single-namespace contracts to the legacy envelope shape (no nested key surfaces in JSON)', () => {
    const storage = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        User: makeTable('User', UNBOUND_NAMESPACE_ID),
        Post: makeTable('Post', UNBOUND_NAMESPACE_ID),
      },
    });

    const envelope = JSON.parse(JSON.stringify(storage)) as Record<string, unknown>;
    // No nested view in the envelope — the canonical JSON shape stays
    // flat for single-namespace contracts, anchoring byte-identical
    // hashes for the existing fixture corpus.
    expect(envelope).not.toHaveProperty('tablesByNamespace');
    expect(envelope).toHaveProperty('tables');
    const tables = envelope['tables'] as Record<string, unknown>;
    expect(Object.keys(tables).sort()).toEqual(['Post', 'User']);
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
      tables: Record<string, { namespaceId?: string }>;
    };
    expect(envelope.tables['Post']?.namespaceId).toBe('public');
    expect(envelope.tables['Account']?.namespaceId).toBe('auth');
  });

  it('escalates to the nested envelope when the same name lives in two namespaces (FR15)', () => {
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

  it('rehydrates the flat envelope back through validateStorage to a dual-view IR', () => {
    const original = new SqlStorage({
      storageHash: sha as SqlStorage['storageHash'],
      tables: {
        auth: { Account: makeTable('Account', 'auth') },
        public: { Post: makeTable('Post', 'public') },
      },
    });

    const envelope = JSON.parse(JSON.stringify(original)) as {
      tables: Record<string, unknown>;
    };
    expect(Object.keys(envelope.tables).sort()).toEqual(['Account', 'Post']);

    const rehydrated = validateStorage(envelope);
    expect(findTableByCoord(rehydrated, 'auth', 'Account')?.namespaceId).toBe('auth');
    expect(findTableByCoord(rehydrated, 'public', 'Post')?.namespaceId).toBe('public');
  });
});
