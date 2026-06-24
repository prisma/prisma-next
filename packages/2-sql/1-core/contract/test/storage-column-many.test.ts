import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { createContract } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { col } from '../src/factories';
import { StorageColumn } from '../src/ir/storage-column';
import type { SqlStorage } from '../src/types';
import { validateStorage } from '../src/validators';

function unboundTables(tables: Record<string, unknown>) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      },
    },
  };
}

describe('StorageColumn many', () => {
  describe('contract.json round-trip', () => {
    it('round-trips a many:true column through serialize → parse → deep-equal', () => {
      const postTable = {
        columns: {
          tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const s = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;

      const serialized = JSON.stringify(s);
      const parsed = JSON.parse(serialized) as unknown;

      const validated = validateStorage(parsed);
      const tagsColumn = validated.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table['post']?.columns[
        'tags'
      ] as StorageColumn | undefined;

      expect(tagsColumn).toBeDefined();
      expect(tagsColumn).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
      });
    });

    it('scalar column (no many key) stays byte-identical — no many:false emitted', () => {
      const postTable = {
        columns: {
          title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };

      const s = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;

      const serialized = JSON.stringify(s);
      const parsed = JSON.parse(serialized) as unknown;

      const validated = validateStorage(parsed);
      const titleColumn = validated.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table['post']
        ?.columns['title'] as StorageColumn | undefined;

      expect(titleColumn).toBeDefined();
      expect(titleColumn).not.toHaveProperty('many');
      expect(titleColumn).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
    });
  });

  describe('col() factory', () => {
    it('creates a many:true column when many option is set', () => {
      const column = col('text', 'pg/text@1', false, { many: true });
      expect(column).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
      });
    });

    it('omits many from scalar column (no many:false)', () => {
      const column = col('text', 'pg/text@1');
      expect(column).not.toHaveProperty('many');
    });
  });

  describe('StorageColumn IR', () => {
    it('accepts many:true in constructor and sets the flag', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: true,
      });
      expect(column.many).toBe(true);
    });

    it('leaves many undefined for scalar columns', () => {
      const column = new StorageColumn({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
      });
      expect(column.many).toBeUndefined();
    });
  });

  describe('validateStorage', () => {
    it('accepts a column with many:true', () => {
      const raw = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(raw)).not.toThrow();
    });

    it('rejects a column with many:42 (non-boolean)', () => {
      const raw = {
        storageHash: 'sha256:test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: 42 },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(raw)).toThrow();
    });
  });
});
