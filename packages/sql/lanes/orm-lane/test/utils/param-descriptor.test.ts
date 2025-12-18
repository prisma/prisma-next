import { describe, expect, it } from 'vitest';
import { createParamDescriptor } from '../../src/utils/param-descriptor';

describe('param-descriptor', () => {
  describe('createParamDescriptor', () => {
    it('creates descriptor with codecId and nativeType', () => {
      const descriptor = createParamDescriptor({
        name: 'userId',
        table: 'user',
        column: 'id',
        codecId: 'pg/int4@1',
        nativeType: 'int4',
        nullable: false,
      });

      expect(descriptor).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
        codecId: 'pg/int4@1',
        nativeType: 'int4',
        nullable: false,
      });
    });

    it('creates descriptor without codecId', () => {
      const descriptor = createParamDescriptor({
        name: 'userId',
        table: 'user',
        column: 'id',
        nativeType: 'int4',
        nullable: false,
      });

      expect(descriptor).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
        nativeType: 'int4',
        nullable: false,
      });
      expect(descriptor).not.toHaveProperty('codecId');
    });

    it('creates descriptor without nativeType', () => {
      const descriptor = createParamDescriptor({
        name: 'userId',
        table: 'user',
        column: 'id',
        codecId: 'pg/int4@1',
        nullable: false,
      });

      expect(descriptor).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
        codecId: 'pg/int4@1',
        nullable: false,
      });
      expect(descriptor).not.toHaveProperty('nativeType');
    });

    it('creates descriptor without both optional properties', () => {
      const descriptor = createParamDescriptor({
        name: 'userId',
        table: 'user',
        column: 'id',
        nullable: false,
      });

      expect(descriptor).toMatchObject({
        name: 'userId',
        source: 'dsl',
        refs: { table: 'user', column: 'id' },
        nullable: false,
      });
      expect(descriptor).not.toHaveProperty('codecId');
      expect(descriptor).not.toHaveProperty('nativeType');
    });

    it('creates descriptor with nullable true', () => {
      const descriptor = createParamDescriptor({
        name: 'email',
        table: 'user',
        column: 'email',
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: true,
      });

      expect(descriptor).toMatchObject({
        name: 'email',
        source: 'dsl',
        refs: { table: 'user', column: 'email' },
        codecId: 'pg/text@1',
        nativeType: 'text',
        nullable: true,
      });
    });
  });
});
