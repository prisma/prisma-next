import type { SqlContract, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import {
  generateUserlandDefaults,
  resolveUserlandDefaultsForColumns,
} from '../../src/utils/userland-defaults';

describe('userland-defaults', () => {
  const createTable = (columns: StorageTable['columns']): StorageTable => ({
    columns,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  });

  describe('resolveUserlandDefaultsForColumns', () => {
    it('returns early when no generators provided', () => {
      const table = createTable({
        id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      });
      const providedColumns = new Set<string>();
      const values: Record<string, ParamPlaceholder> = {};
      const paramsMap: Record<string, unknown> = {};

      resolveUserlandDefaultsForColumns(table, providedColumns, values, paramsMap, undefined);

      expect(values).toEqual({});
      expect(paramsMap).toEqual({});
    });

    it('skips columns already provided', () => {
      const table = createTable({
        id: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          nullable: false,
          default: { kind: 'userland', name: 'nanoid' },
        },
      });
      const providedColumns = new Set(['id']);
      const values: Record<string, ParamPlaceholder> = {};
      const paramsMap: Record<string, unknown> = {};
      const generators = new Map([['nanoid', () => 'generated-id']]);

      resolveUserlandDefaultsForColumns(table, providedColumns, values, paramsMap, generators);

      expect(values).toEqual({});
      expect(paramsMap).toEqual({});
    });

    it('skips columns without userland defaults', () => {
      const table = createTable({
        id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        createdAt: {
          nativeType: 'timestamptz',
          codecId: 'pg/timestamptz@1',
          nullable: false,
          default: { kind: 'function', name: 'now' },
        },
      });
      const providedColumns = new Set<string>();
      const values: Record<string, ParamPlaceholder> = {};
      const paramsMap: Record<string, unknown> = {};
      const generators = new Map([['nanoid', () => 'generated-id']]);

      resolveUserlandDefaultsForColumns(table, providedColumns, values, paramsMap, generators);

      expect(values).toEqual({});
      expect(paramsMap).toEqual({});
    });

    it('skips columns with userland default when generator not found', () => {
      const table = createTable({
        id: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          nullable: false,
          default: { kind: 'userland', name: 'customGenerator' },
        },
      });
      const providedColumns = new Set<string>();
      const values: Record<string, ParamPlaceholder> = {};
      const paramsMap: Record<string, unknown> = {};
      const generators = new Map([['nanoid', () => 'generated-id']]);

      resolveUserlandDefaultsForColumns(table, providedColumns, values, paramsMap, generators);

      expect(values).toEqual({});
      expect(paramsMap).toEqual({});
    });

    it('generates values for columns with userland defaults', () => {
      const table = createTable({
        id: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          nullable: false,
          default: { kind: 'userland', name: 'nanoid' },
        },
        title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      });
      const providedColumns = new Set(['title']);
      const values: Record<string, ParamPlaceholder> = {};
      const paramsMap: Record<string, unknown> = {};
      const generators = new Map([['nanoid', () => 'generated-id-123']]);

      resolveUserlandDefaultsForColumns(table, providedColumns, values, paramsMap, generators);

      expect(values).toHaveProperty('id');
      expect(values['id']).toMatchObject({ kind: 'param-placeholder', name: '__generated_id' });
      expect(paramsMap).toEqual({ __generated_id: 'generated-id-123' });
    });

    it('generates values for multiple columns', () => {
      const table = createTable({
        id: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          nullable: false,
          default: { kind: 'userland', name: 'nanoid' },
        },
        slug: {
          nativeType: 'text',
          codecId: 'pg/text@1',
          nullable: false,
          default: { kind: 'userland', name: 'slugify' },
        },
      });
      const providedColumns = new Set<string>();
      const values: Record<string, ParamPlaceholder> = {};
      const paramsMap: Record<string, unknown> = {};
      let callCount = 0;
      const generators = new Map<string, () => unknown>([
        ['nanoid', () => `id-${++callCount}`],
        ['slugify', () => `slug-${++callCount}`],
      ]);

      resolveUserlandDefaultsForColumns(table, providedColumns, values, paramsMap, generators);

      expect(Object.keys(values)).toHaveLength(2);
      expect(values['id']).toMatchObject({ kind: 'param-placeholder', name: '__generated_id' });
      expect(values['slug']).toMatchObject({ kind: 'param-placeholder', name: '__generated_slug' });
      expect(paramsMap['__generated_id']).toBe('id-1');
      expect(paramsMap['__generated_slug']).toBe('slug-2');
    });
  });

  describe('generateUserlandDefaults', () => {
    const createContract = (tables: Record<string, StorageTable>): SqlContract<SqlStorage> => ({
      schemaVersion: '1',
      targetFamily: 'sql',
      target: 'postgres',
      coreHash: 'sha256:test' as never,
      models: {},
      relations: {},
      storage: { tables },
      mappings: {
        modelToTable: {},
        tableToModel: {},
        fieldToColumn: {},
        columnToField: {},
        codecTypes: {},
        operationTypes: {},
      },
      capabilities: {},
      extensionPacks: {},
      meta: {},
      sources: {},
    });

    it('returns empty object when no generators provided', () => {
      const contract = createContract({
        post: createTable({
          id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      });

      const result = generateUserlandDefaults(contract, 'post', new Set(), undefined);

      expect(result).toEqual({});
    });

    it('returns empty object when table not found', () => {
      const contract = createContract({});
      const generators = new Map([['nanoid', () => 'generated-id']]);

      const result = generateUserlandDefaults(contract, 'nonexistent', new Set(), generators);

      expect(result).toEqual({});
    });

    it('skips columns already provided', () => {
      const contract = createContract({
        post: createTable({
          id: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'userland', name: 'nanoid' },
          },
        }),
      });
      const generators = new Map([['nanoid', () => 'generated-id']]);

      const result = generateUserlandDefaults(contract, 'post', new Set(['id']), generators);

      expect(result).toEqual({});
    });

    it('skips columns without userland defaults', () => {
      const contract = createContract({
        post: createTable({
          id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      });
      const generators = new Map([['nanoid', () => 'generated-id']]);

      const result = generateUserlandDefaults(contract, 'post', new Set(), generators);

      expect(result).toEqual({});
    });

    it('skips columns with userland default when generator not found', () => {
      const contract = createContract({
        post: createTable({
          id: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'userland', name: 'customGenerator' },
          },
        }),
      });
      const generators = new Map([['nanoid', () => 'generated-id']]);

      const result = generateUserlandDefaults(contract, 'post', new Set(), generators);

      expect(result).toEqual({});
    });

    it('generates values for columns with userland defaults', () => {
      const contract = createContract({
        post: createTable({
          id: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'userland', name: 'nanoid' },
          },
          title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        }),
      });
      const generators = new Map([['nanoid', () => 'generated-id-456']]);

      const result = generateUserlandDefaults(contract, 'post', new Set(['title']), generators);

      expect(result).toEqual({ id: 'generated-id-456' });
    });

    it('generates values for multiple columns', () => {
      const contract = createContract({
        post: createTable({
          id: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'userland', name: 'nanoid' },
          },
          slug: {
            nativeType: 'text',
            codecId: 'pg/text@1',
            nullable: false,
            default: { kind: 'userland', name: 'slugify' },
          },
        }),
      });
      let callCount = 0;
      const generators = new Map<string, () => unknown>([
        ['nanoid', () => `id-${++callCount}`],
        ['slugify', () => `slug-${++callCount}`],
      ]);

      const result = generateUserlandDefaults(contract, 'post', new Set(), generators);

      expect(result).toEqual({
        id: 'id-1',
        slug: 'slug-2',
      });
    });
  });
});
