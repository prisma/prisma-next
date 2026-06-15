import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CreateInput, DefaultModelRow } from '../src/types';
import { createMockRuntime } from './helpers';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for the ORM lane.
//
// Combines #803's per-namespace shape (namespace-nested FieldOutputTypes /
// FieldInputTypes; `domain.namespaces.__unbound__.models`) with TML-2886's
// valueSet-ref-following: the `role`/`status`/`level` enum fields carry a
// DOMAIN `valueSet` ref and resolve their union from the domain enum block, NOT
// from a baked map entry. The `name` plain field has no ref and resolves through
// the nested baked map — exercising both mechanisms in one fixture.
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
// fields resolve via the domain enum block ref.
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
    __unbound__: {
      id: '__unbound__';
      kind: 'sql-namespace';
      entries: {
        table: {
          User: {
            columns: {
              role: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              status: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: true };
              level: { nativeType: 'int4'; codecId: 'pg/int4@1'; nullable: false };
              name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
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
      namespaceId: '__unbound__';
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
        readonly valueSet: {
          readonly plane: 'domain';
          readonly entityKind: 'enum';
          readonly namespaceId: '__unbound__';
          readonly entityName: 'Role';
        };
      };
      status: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: true;
        readonly valueSet: {
          readonly plane: 'domain';
          readonly entityKind: 'enum';
          readonly namespaceId: '__unbound__';
          readonly entityName: 'Status';
        };
      };
      level: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
        readonly valueSet: {
          readonly plane: 'domain';
          readonly entityKind: 'enum';
          readonly namespaceId: '__unbound__';
          readonly entityName: 'Level';
        };
      };
      name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    relations: Record<string, never>;
  };
};

// The domain enum block the field refs resolve against, nested under the same
// namespace coordinate the emitter renders it at.
type EnumDomainEnums = {
  readonly Role: {
    readonly codecId: 'pg/text@1';
    readonly members: readonly [
      { readonly name: 'User'; readonly value: 'user' },
      { readonly name: 'Admin'; readonly value: 'admin' },
    ];
  };
  readonly Status: {
    readonly codecId: 'pg/text@1';
    readonly members: readonly [
      { readonly name: 'Active'; readonly value: 'active' },
      { readonly name: 'Inactive'; readonly value: 'inactive' },
    ];
  };
  readonly Level: {
    readonly codecId: 'pg/int4@1';
    readonly members: readonly [
      { readonly name: 'Low'; readonly value: 1 },
      { readonly name: 'High'; readonly value: 10 },
    ];
  };
};

type EnumContractBase = Omit<Contract<EnumStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: EnumModels; readonly enum: EnumDomainEnums };
    };
  };
};

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps>;

// ---------------------------------------------------------------------------
// Read output: DefaultModelRow follows the domain field's valueSet ref.
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

test('ORM read output: int-codec enum field is a number-literal union', () => {
  expectTypeOf<UserRow['level']>().toEqualTypeOf<1 | 10>();
});

test('ORM read output: plain (non-enum) field falls back to the nested baked map', () => {
  expectTypeOf<UserRow['name']>().toEqualTypeOf<string>();
});

// ---------------------------------------------------------------------------
// Write input: CreateInput is derived from DefaultModelRow.
// ---------------------------------------------------------------------------

type UserCreateInput = CreateInput<EnumContract, 'User'>;

test('ORM write input: non-nullable enum field rejects out-of-union literal', () => {
  const runtime = createMockRuntime();
  const context = {} as unknown as ExecutionContext<EnumContract>;
  const collection = new Collection<EnumContract, 'User'>({ runtime, context }, 'User', {
    namespaceId: '__unbound__',
  });

  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  collection.create({
    role: 'nope',
    status: 'active',
    level: 1,
    name: 'x',
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
