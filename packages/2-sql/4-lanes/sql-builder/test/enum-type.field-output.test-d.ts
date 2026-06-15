import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../src/types/db';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for the sql-builder lane.
//
// Combines #803's per-namespace shape (namespace-nested FieldOutputTypes /
// FieldInputTypes; per-namespace `db.<ns>.<table>` access) with TML-2886's
// valueSet-ref-following: the `role`/`status` enum columns carry a storage
// `valueSet` ref and resolve their union from the storage value-set, NOT from a
// baked map entry. The `name` plain column has no ref and resolves through the
// nested baked map — exercising both mechanisms in one fixture.
// ---------------------------------------------------------------------------

type EnumCodecTypes = {
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order' | 'textual';
  };
};

// Nested by namespace coordinate (#803). Carries only the non-enum `name`
// field; the enum columns resolve via the storage value-set ref.
type EnumFieldMaps = {
  __unbound__: {
    User: {
      name: string;
    };
  };
};

type EnumTypeMaps = TypeMaps<EnumCodecTypes, Record<string, never>, EnumFieldMaps, EnumFieldMaps>;

type EnumStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    readonly __unbound__: {
      id: '__unbound__';
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
                  namespaceId: '__unbound__';
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
                  namespaceId: '__unbound__';
                  entityName: 'Status';
                };
              };
              readonly name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
            };
            primaryKey: { columns: ['role'] };
            uniques: readonly [];
            indexes: readonly [];
            foreignKeys: readonly [];
          };
        };
        readonly valueSet: {
          readonly Role: { readonly kind: 'valueSet'; readonly values: readonly ['user', 'admin'] };
          readonly Status: {
            readonly kind: 'valueSet';
            readonly values: readonly ['active', 'inactive'];
          };
        };
      };
    };
  };
};

type EnumModels = {
  User: {
    storage: {
      table: 'User';
      fields: {
        role: { column: 'role' };
        status: { column: 'status' };
        name: { column: 'name' };
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
      name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    relations: Record<string, never>;
  };
};

type EnumContractBase = Omit<Contract<EnumStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: EnumModels };
    };
  };
};

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps> & {
  readonly capabilities: Record<string, never>;
  readonly roots: Record<string, never>;
};

type EnumDb = Db<EnumContract>;

// ---------------------------------------------------------------------------
// Read output: resolvedColumnOutputTypes follows the column's valueSet ref
// (enum columns) and the nested baked map (plain `name`).
// ---------------------------------------------------------------------------

test('sql-builder: enum column output types come from the storage valueSet ref', () => {
  type QC = import('../src/types/table-proxy').ContractToQC<EnumContract, '__unbound__', 'User'>;
  type RoleOutput = QC['resolvedColumnOutputTypes']['role'];
  type StatusOutput = QC['resolvedColumnOutputTypes']['status'];
  type NameOutput = QC['resolvedColumnOutputTypes']['name'];

  expectTypeOf<RoleOutput>().toEqualTypeOf<'user' | 'admin'>();
  expectTypeOf<StatusOutput>().toEqualTypeOf<'active' | 'inactive' | null>();
  // The plain column resolves through the namespace-nested baked map.
  expectTypeOf<NameOutput>().toEqualTypeOf<string>();
});

// ---------------------------------------------------------------------------
// Write input: insert() follows the column's valueSet ref
// ---------------------------------------------------------------------------

test('sql-builder insert: non-nullable enum field rejects out-of-union literal', () => {
  const db = null as unknown as EnumDb;

  db.__unbound__.User.insert([
    {
      // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
      role: 'nope',
    },
  ]);
});

test('sql-builder insert: in-union literal is accepted', () => {
  const db = null as unknown as EnumDb;

  db.__unbound__.User.insert([{ role: 'user' }]);
  db.__unbound__.User.insert([{ role: 'admin' }]);
  db.__unbound__.User.insert([{ role: 'user', status: 'active' }]);
  db.__unbound__.User.insert([{ role: 'user', status: null }]);
});
