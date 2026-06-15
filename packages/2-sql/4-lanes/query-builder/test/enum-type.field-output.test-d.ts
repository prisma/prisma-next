import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ExtractOutputType, TableToSelection } from '../src/selection';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for the query-builder lane.
//
// The enum value union is NOT baked into a FieldOutputTypes TypeMap. Instead
// the storage column carries a `valueSet` ref (plane 'storage') to a storage
// value-set entity, and the lane resolves the union by following that ref into
// `storage.namespaces[ns].entries.valueSet[Name].values`. This mirrors the real
// emitted shape (see examples/prisma-next-demo/src/prisma/contract.d.ts:
// Post.priority storage column ref + storage `Priority` value-set).
// ---------------------------------------------------------------------------

type EnumCodecTypes = {
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order' | 'textual';
  };
  'pg/int4@1': {
    output: number;
    input: number;
    traits: 'equality' | 'order' | 'numeric';
  };
};

type EnumTypeMaps = TypeMaps<EnumCodecTypes, Record<string, never>, Record<string, never>>;

type EnumContractBase = Contract<
  {
    storageHash: StorageHashBase<string>;
    namespaces: {
      public: {
        id: 'public';
        kind: 'sql-namespace';
        entries: {
          table: {
            User: {
              columns: {
                role: {
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
                status: {
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
                level: {
                  nativeType: 'int4';
                  codecId: 'pg/int4@1';
                  nullable: false;
                  valueSet: {
                    plane: 'storage';
                    entityKind: 'valueSet';
                    namespaceId: 'public';
                    entityName: 'Level';
                  };
                };
                name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              };
              primaryKey: { columns: ['role'] };
              uniques: [];
              indexes: [];
              foreignKeys: [];
            };
            // A table with an enum column but NO model field mapping (raw value-set).
            Audit: {
              columns: {
                kind: {
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
              };
              primaryKey: { columns: ['kind'] };
              uniques: [];
              indexes: [];
              foreignKeys: [];
            };
          };
          valueSet: {
            Role: { kind: 'valueSet'; values: readonly ['user', 'admin'] };
            Status: { kind: 'valueSet'; values: readonly ['active', 'inactive'] };
            Level: { kind: 'valueSet'; values: readonly [1, 10] };
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
          level: { column: 'level' };
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
        level: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
          readonly nullable: false;
        };
        name: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
      };
      relations: Record<string, never>;
    };
  }
>;

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps>;

// ---------------------------------------------------------------------------
// Read output: ExtractOutputType follows the column's own storage valueSet ref
// ---------------------------------------------------------------------------

test('query-builder: non-nullable enum column output is value union, not string', () => {
  type RoleOutput = ExtractOutputType<EnumContract, 'User', 'role'>;
  expectTypeOf<RoleOutput>().toEqualTypeOf<'user' | 'admin'>();
});

test('query-builder: non-nullable enum column output is not bare string', () => {
  type RoleOutput = ExtractOutputType<EnumContract, 'User', 'role'>;
  expectTypeOf<RoleOutput>().not.toEqualTypeOf<string>();
});

test('query-builder: nullable enum column output is value union | null', () => {
  type StatusOutput = ExtractOutputType<EnumContract, 'User', 'status'>;
  expectTypeOf<StatusOutput>().toEqualTypeOf<'active' | 'inactive' | null>();
});

test('query-builder: int-codec enum column output is a number-literal union', () => {
  type LevelOutput = ExtractOutputType<EnumContract, 'User', 'level'>;
  expectTypeOf<LevelOutput>().toEqualTypeOf<1 | 10>();
});

test('query-builder: plain (non-enum) column output falls back to codec output', () => {
  type NameOutput = ExtractOutputType<EnumContract, 'User', 'name'>;
  expectTypeOf<NameOutput>().toEqualTypeOf<string>();
});

test('query-builder: raw value-set column with no model field still types from the storage ref', () => {
  type KindOutput = ExtractOutputType<EnumContract, 'Audit', 'kind'>;
  expectTypeOf<KindOutput>().toEqualTypeOf<'user' | 'admin'>();
});

test('query-builder: TableToSelection includes enum value union for role column', () => {
  type Selection = TableToSelection<EnumContract, 'User'>;
  type RoleValue = Selection['role']['~output'];
  expectTypeOf<RoleValue>().toEqualTypeOf<'user' | 'admin'>();
});
