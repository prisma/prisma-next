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
// The enum value union is NOT baked into a FieldOutputTypes/FieldInputTypes
// TypeMap. The domain model field carries a `valueSet` ref (plane 'domain') to
// a domain enum entity, and the lane resolves the union by following that ref
// into `domain.namespaces[ns].enum[Name].members[*].value`. This mirrors the
// real emitted shape (see examples/prisma-next-demo/src/prisma/contract.d.ts:
// Post.priority domain field ref + domain `Priority` enum block).
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

// The baked FieldOutputTypes/FieldInputTypes maps still carry every NON-enum
// field (plain codec outputs, value-objects, parameterized codecs, unions) — the
// emitter keeps them; only the enum narrowing moved to ref-following. The enum
// fields (role/status/level) are deliberately absent here so a regression that
// re-reads the map for an enum field would surface as a stale value rather than
// the ref-resolved union.
type EnumFieldMaps = {
  User: {
    name: string;
  };
};

type EnumTypeMaps = TypeMaps<EnumCodecTypes, Record<string, never>, EnumFieldMaps, EnumFieldMaps>;

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
  },
  {
    User: {
      storage: {
        table: 'User';
        namespaceId: 'public';
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
            readonly namespaceId: 'public';
            readonly entityName: 'Role';
          };
        };
        status: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: true;
          readonly valueSet: {
            readonly plane: 'domain';
            readonly entityKind: 'enum';
            readonly namespaceId: 'public';
            readonly entityName: 'Status';
          };
        };
        level: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
          readonly nullable: false;
          readonly valueSet: {
            readonly plane: 'domain';
            readonly entityKind: 'enum';
            readonly namespaceId: 'public';
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
  }
>;

// Augment the domain plane with the enum block the refs resolve against. The
// `Contract<...>` helper only types the storage + model-definitions; the domain
// `namespaces[ns].enum` block must be supplied alongside it the way the emitter
// emits it in `domain.namespaces`.
type WithDomainEnums = {
  readonly domain: {
    readonly namespaces: {
      readonly public: {
        readonly models: {
          readonly User: EnumContractBase extends Contract<infer _S, infer M>
            ? M extends { readonly User: infer U }
              ? U
              : never
            : never;
        };
        readonly enum: {
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
      };
    };
  };
};

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps> & WithDomainEnums;

// ---------------------------------------------------------------------------
// Read output: DefaultModelRow follows the domain field's valueSet ref
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

test('ORM read output: plain (non-enum) field falls back to codec output', () => {
  expectTypeOf<UserRow['name']>().toEqualTypeOf<string>();
});

// ---------------------------------------------------------------------------
// Write input: CreateInput is derived from DefaultModelRow
// ---------------------------------------------------------------------------

type UserCreateInput = CreateInput<EnumContract, 'User'>;

test('ORM write input: non-nullable enum field rejects out-of-union literal', () => {
  const runtime = createMockRuntime();
  const context = {} as unknown as ExecutionContext<EnumContract>;
  const collection = new Collection<EnumContract, 'User'>({ runtime, context }, 'User', {
    namespaceId: 'public',
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
