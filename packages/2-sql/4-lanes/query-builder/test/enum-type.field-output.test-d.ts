import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ExtractOutputType, TableToSelection } from '../src/selection';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for query-builder lane
// ---------------------------------------------------------------------------

type EnumCodecTypes = {
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order' | 'textual';
  };
};

type EnumFieldOutputTypes = {
  User: {
    role: 'user' | 'admin';
    status: 'active' | 'inactive' | null;
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
              role: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              status: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: true };
            };
            primaryKey: { columns: ['role'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
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
// Read output: ExtractOutputType uses FieldOutputTypes when available
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

test('query-builder: TableToSelection includes enum value union for role column', () => {
  type Selection = TableToSelection<EnumContract, 'User'>;
  type RoleValue = Selection['role']['~output'];
  expectTypeOf<RoleValue>().toEqualTypeOf<'user' | 'admin'>();
});
