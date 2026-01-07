import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { augmentDescriptorWithColumnMeta } from '../src/plan.ts';

describe('plan', () => {
  describe('augmentDescriptorWithColumnMeta', () => {
    // StorageColumn always has codecId and nativeType (required fields),
    // while ParamDescriptor has them as optional. `augmentDescriptorWithColumnMeta` copies
    // these fields from StorageColumn to ParamDescriptor when columnMeta is provided.
    it('augments descriptor with codecId and nativeType from columnMeta', () => {
      const descriptors: ParamDescriptor[] = [
        {
          name: 'userId',
          source: 'dsl',
          refs: { table: 'user', column: 'id' },
        },
      ];
      const columnMeta: StorageColumn = {
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      };

      augmentDescriptorWithColumnMeta(descriptors, columnMeta);

      expect(descriptors[0]).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
        codecId: 'pg/int4@1',
        nativeType: 'int4',
      });
    });

    it('preserves existing descriptor properties when augmenting', () => {
      const descriptors: ParamDescriptor[] = [
        {
          name: 'userId',
          source: 'dsl',
          refs: { table: 'user', column: 'id' },
          nullable: true,
        },
      ];
      const columnMeta: StorageColumn = {
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      };

      augmentDescriptorWithColumnMeta(descriptors, columnMeta);

      expect(descriptors[0]).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
        nullable: true,
        codecId: 'pg/int4@1',
        nativeType: 'int4',
      });
    });

    it('does nothing when descriptors array is empty', () => {
      const descriptors: ParamDescriptor[] = [];
      const columnMeta: StorageColumn = {
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      };

      augmentDescriptorWithColumnMeta(descriptors, columnMeta);

      expect(descriptors.length).toBe(0);
    });

    it('does nothing when columnMeta is undefined', () => {
      const descriptors: ParamDescriptor[] = [
        {
          name: 'userId',
          source: 'dsl',
          refs: { table: 'user', column: 'id' },
        },
      ];

      augmentDescriptorWithColumnMeta(descriptors, undefined);

      expect(descriptors[0]).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
      });
      expect(descriptors[0]).not.toHaveProperty('codecId');
      expect(descriptors[0]).not.toHaveProperty('nativeType');
    });

    it('augments only the last descriptor in the array', () => {
      const descriptors: ParamDescriptor[] = [
        {
          name: 'firstParam',
          source: 'dsl',
          refs: { table: 'user', column: 'id' },
        },
        {
          name: 'secondParam',
          source: 'dsl',
          refs: { table: 'user', column: 'email' },
        },
      ];
      const columnMeta: StorageColumn = {
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: true,
      };

      augmentDescriptorWithColumnMeta(descriptors, columnMeta);

      expect(descriptors[0]).toMatchObject({
        name: 'firstParam',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
      });
      expect(descriptors[0]).not.toHaveProperty('codecId');
      expect(descriptors[0]).not.toHaveProperty('nativeType');

      expect(descriptors[1]).toMatchObject({
        name: 'secondParam',
        source: 'dsl',
        refs: { table: 'user', column: 'email' },
        codecId: 'pg/text@1',
        nativeType: 'text',
      });
    });
  });
});
