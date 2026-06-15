import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ExtractOutputType, TableToSelection } from '../src/selection';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for the query-builder lane.
//
// Combines #803's per-namespace shape (namespace-nested FieldOutputTypes;
// `domain.namespaces.__unbound__.models`) with TML-2886's valueSet-ref-
// following: the `role`/`status`/`level` enum columns carry a storage
// `valueSet` ref and resolve their union from the storage value-set, NOT from a
// baked map entry. The `name` plain column (and the raw value-set `Audit.kind`,
// which has no model field) round out the coverage.
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

// Namespace-nested (#803), carrying only the non-enum `name` field; the enum
// columns resolve via the storage value-set ref.
type EnumFieldOutputTypes = {
  __unbound__: {
    User: {
      name: string;
    };
  };
};

type EnumTypeMaps = TypeMaps<EnumCodecTypes, Record<string, never>, EnumFieldOutputTypes>;

type EnumStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
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
                  namespaceId: '__unbound__';
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
                  namespaceId: '__unbound__';
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
                  namespaceId: '__unbound__';
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
                  namespaceId: '__unbound__';
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
};

type EnumModels = {
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
};

type EnumContractBase = Omit<Contract<EnumStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: EnumModels };
    };
  };
};

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps>;

// ---------------------------------------------------------------------------
// Read output: ExtractOutputType follows the column's own storage valueSet ref.
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

test('query-builder: plain (non-enum) column output falls back to the nested baked map', () => {
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
