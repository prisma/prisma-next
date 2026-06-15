import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../src/types/db';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for the sql-builder lane.
//
// The enum value union is NOT baked into a FieldOutputTypes/FieldInputTypes
// TypeMap. The storage column carries a `valueSet` ref (plane 'storage') to a
// storage value-set entity; the lane resolves the union by following that ref
// into `storage.namespaces[ns].entries.valueSet[Name].values`.
// ---------------------------------------------------------------------------

type EnumCodecTypes = {
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order' | 'textual';
  };
};

type EnumTypeMaps = TypeMaps<
  EnumCodecTypes,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

type EnumContractBase = Contract<
  {
    storageHash: StorageHashBase<string>;
    namespaces: {
      readonly public: {
        id: 'public';
        kind: 'sql-namespace';
        entries: {
          readonly table: {
            readonly User: {
              columns: {
                readonly role: {
                  nativeType: 'text';
                  codecId: 'pg/text@1';
                  nullable: false;
                  valueSet: {
                    plane: 'storage';
                    entityKind: 'valueSet';
                    namespaceId: 'public';
                    entityName: 'Role';
                  };
                };
                readonly status: {
                  nativeType: 'text';
                  codecId: 'pg/text@1';
                  nullable: true;
                  valueSet: {
                    plane: 'storage';
                    entityKind: 'valueSet';
                    namespaceId: 'public';
                    entityName: 'Status';
                  };
                };
              };
              primaryKey: { columns: ['role'] };
              uniques: readonly [];
              indexes: readonly [];
              foreignKeys: readonly [];
            };
          };
          readonly valueSet: {
            readonly Role: {
              readonly kind: 'valueSet';
              readonly values: readonly ['user', 'admin'];
            };
            readonly Status: {
              readonly kind: 'valueSet';
              readonly values: readonly ['active', 'inactive'];
            };
          };
        };
      };
    };
  },
  {
    User: {
      storage: {
        table: 'User';
        fields: {
          role: { column: 'role' };
          status: { column: 'status' };
        };
      };
      fields: {
        role: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
        status: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: true;
        };
      };
      relations: Record<string, never>;
    };
  }
>;

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps> & {
  readonly capabilities: Record<string, never>;
  readonly roots: Record<string, never>;
};

type EnumDb = Db<EnumContract>;

// ---------------------------------------------------------------------------
// The sql-builder's resolvedColumnOutputTypes follows the column's valueSet ref
// ---------------------------------------------------------------------------

test('sql-builder: column output types for enum fields come from the storage valueSet ref', () => {
  type QC = import('../src/types/table-proxy').ContractToQC<EnumContract, 'User'>;
  type RoleOutput = QC['resolvedColumnOutputTypes']['role'];
  type StatusOutput = QC['resolvedColumnOutputTypes']['status'];

  expectTypeOf<RoleOutput>().toEqualTypeOf<'user' | 'admin'>();
  expectTypeOf<StatusOutput>().toEqualTypeOf<'active' | 'inactive' | null>();
});

// ---------------------------------------------------------------------------
// Write input: insert() follows the column's valueSet ref
// ---------------------------------------------------------------------------

test('sql-builder insert: non-nullable enum field rejects out-of-union literal', () => {
  const db = null as unknown as EnumDb;

  db.public.User.insert([
    {
      // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
      role: 'nope',
    },
  ]);
});

test('sql-builder insert: in-union literal is accepted', () => {
  const db = null as unknown as EnumDb;

  db.public.User.insert([{ role: 'user' }]);
  db.public.User.insert([{ role: 'admin' }]);
  db.public.User.insert([{ role: 'user', status: 'active' }]);
  db.public.User.insert([{ role: 'user', status: null }]);
});
