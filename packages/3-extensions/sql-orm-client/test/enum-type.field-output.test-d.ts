import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CreateInput, DefaultModelRow } from '../src/types';
import { createMockRuntime } from './helpers';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture
//
// Simulates what defineContract + enumType emits for a User model whose
// `role` field carries the 'user' | 'admin' value union and `status` is
// nullable with 'active' | 'inactive'.
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

type EnumFieldInputTypes = {
  User: {
    role: 'user' | 'admin';
    status: 'active' | 'inactive' | null;
  };
};

type EnumTypeMaps = TypeMaps<
  EnumCodecTypes,
  Record<string, never>,
  EnumFieldOutputTypes,
  EnumFieldInputTypes
>;

type EnumContractBase = Contract<
  {
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

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps>;

// ---------------------------------------------------------------------------
// Read output: DefaultModelRow uses FieldOutputTypes
// ---------------------------------------------------------------------------

type UserRow = DefaultModelRow<EnumContract, 'User'>;

test('ORM read output: non-nullable enum field is value union, not string', () => {
  expectTypeOf<UserRow['role']>().toEqualTypeOf<'user' | 'admin'>();
});

test('ORM read output: non-nullable enum field is not bare string', () => {
  expectTypeOf<UserRow['role']>().not.toEqualTypeOf<string>();
});

test('ORM read output: nullable enum field is value union | null', () => {
  expectTypeOf<UserRow['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
});

// ---------------------------------------------------------------------------
// Write input: CreateInput uses FieldInputTypes
// ---------------------------------------------------------------------------

type UserCreateInput = CreateInput<EnumContract, 'User'>;

test('ORM write input: non-nullable enum field rejects out-of-union literal', () => {
  const runtime = createMockRuntime();
  const context = {} as unknown as ExecutionContext<EnumContract>;
  const collection = new Collection<EnumContract, 'User'>({ runtime, context }, 'User');

  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  collection.create({
    role: 'nope',
    status: 'active',
  });
});

test('ORM write input: non-nullable enum field accepts in-union literal', () => {
  expectTypeOf<UserCreateInput['role']>().toEqualTypeOf<'user' | 'admin'>();
});

test('ORM write input: nullable enum field accepts value union | null', () => {
  expectTypeOf<UserCreateInput['status']>().toEqualTypeOf<
    'active' | 'inactive' | null | undefined
  >();
});
