import type { ContractBase, DomainRelation } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlContract, SqlRelation, SqlStorage } from '../src/types';

type AssertExtends<T, U> = T extends U ? true : never;

describe('domain type compatibility', () => {
  describe('SqlContract extends ContractBase', () => {
    it('type-level assertion', () => {
      const _proof: AssertExtends<SqlContract, ContractBase> = true;
      expect(_proof).toBe(true);
    });
  });

  describe('domain fields accessible on SqlContract models', () => {
    it('DomainModel fields are accessible via index signature', () => {
      type ModelFromContract = SqlContract['models'][string];
      type FieldsFromModel = ModelFromContract['fields'];

      const fields: FieldsFromModel = {
        id: { nullable: false, codecId: 'pg/int4@1' },
      };
      expect(fields.id.nullable).toBe(false);
      expect(fields.id.codecId).toBe('pg/int4@1');
    });
  });

  describe('roots accessible on SqlContract via ContractBase', () => {
    it('roots field exists on SqlContract', () => {
      type Roots = SqlContract['roots'];
      const roots: Roots = { users: 'User' };
      expect(roots.users).toBe('User');
    });
  });

  describe('SqlRelation extends DomainRelation', () => {
    it('type-level assertion', () => {
      const _proof: AssertExtends<SqlRelation, DomainRelation> = true;
      expect(_proof).toBe(true);
    });
  });

  describe('concrete typed contract preserves literal types', () => {
    it('literal types flow through the intersection', () => {
      type ExampleModels = {
        readonly User: {
          readonly fields: {
            readonly name: {
              readonly nullable: true;
              readonly codecId: 'pg/text@1';
            };
          };
          readonly relations: Record<string, never>;
          readonly storage: {
            readonly table: 'user';
            readonly fields: { readonly name: { readonly column: 'display_name' } };
          };
        };
      };

      type ExampleContract = SqlContract<SqlStorage, ExampleModels>;

      type NameField = ExampleContract['models']['User']['fields']['name'];

      const _nullable: NameField['nullable'] = true;
      const _codecId: NameField['codecId'] = 'pg/text@1';

      expect(_nullable).toBe(true);
      expect(_codecId).toBe('pg/text@1');
    });
  });
});
