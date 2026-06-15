import type { ContractEnumAccessor } from '@prisma-next/contract/enum-accessor';
import type { ProfileHashBase, StorageHashBase } from '@prisma-next/contract/types';
import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@prisma-next/mongo-contract';
import type { IncludedRow, NoIncludes } from '@prisma-next/mongo-orm';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { MongoClient } from '../src/runtime/mongo';

type UserRow = IncludedRow<Contract, 'User', NoIncludes>;

// Pin the type chain that `init`'s scaffold relies on. The headline trap was
// `db.orm.X.where(...)` resolving to `never` against an emitted `Contract`
// (lowercased plural roots). These tests fail loudly if a future emitter or
// type-system change reintroduces that regression.

type Db = MongoClient<Contract>;

declare const db: Db;

test('orm exposes lowercased plural roots from the emitted contract', () => {
  expectTypeOf<Db['orm']>().toHaveProperty('users');
  expectTypeOf<Db['orm']>().toHaveProperty('tasks');
});

test('db.orm.users.where(...) returns a chainable collection (not never)', () => {
  const chain = db.orm.users.where({ email: 'a@x' });
  expectTypeOf(chain).not.toBeNever();
  expectTypeOf(chain.where({ name: 'A' })).not.toBeNever();
});

test('db.orm.users.where(...).first() resolves to Promise<row | null>', () => {
  const promised = db.orm.users.where({ email: 'a@x' }).first();
  expectTypeOf(promised).not.toBeNever();
  expectTypeOf(promised).resolves.toEqualTypeOf<UserRow | null>();
});

test('db.orm.users.all() yields rows via AsyncIterableResult', () => {
  const all = db.orm.users.all();
  expectTypeOf(all).not.toBeNever();
  expectTypeOf(all).toEqualTypeOf<AsyncIterableResult<UserRow>>();
});

test('db.orm.tasks.variant("Bug").where(...) narrows to the variant', () => {
  const bugChain = db.orm.tasks.variant('Bug').where({ title: 'X' });
  expectTypeOf(bugChain).not.toBeNever();
});

test('db.orm key set matches the emitted roots (lowercased plurals only)', () => {
  type OrmKeys = keyof Db['orm'];
  expectTypeOf<OrmKeys>().toEqualTypeOf<'tasks' | 'users'>();
});

// ---------------------------------------------------------------------------
// db.enums type tests
// ---------------------------------------------------------------------------

type RoleEnum = {
  readonly codecId: 'mongo/string@1';
  readonly members: readonly [
    { readonly name: 'User'; readonly value: 'user' },
    { readonly name: 'Admin'; readonly value: 'admin' },
  ];
};

type EnumContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'sha256:enum-facade-test'>;
    readonly capabilities: Record<string, never>;
    readonly extensionPacks: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: Record<string, never>;
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly enum: { readonly Role: RoleEnum };
          readonly models: Record<string, never>;
          readonly valueObjects: Record<string, never>;
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: Record<string, never> };
        };
      };
      readonly storageHash: StorageHashBase<'sha256:enum-facade-storage'>;
    };
  },
  MongoTypeMaps<{
    readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  }>
>;

declare const enumDb: MongoClient<EnumContract>;

test('db.enums.Role is a ContractEnumAccessor (unbound projection, no __unbound__ key needed)', () => {
  expectTypeOf<(typeof enumDb)['enums']['Role']>().toMatchTypeOf<ContractEnumAccessor<RoleEnum>>();
});

test('db.enums.Role.values carries the literal member values', () => {
  type Values = (typeof enumDb)['enums']['Role']['values'];
  expectTypeOf<Values[0]>().toEqualTypeOf<'user'>();
  expectTypeOf<Values[1]>().toEqualTypeOf<'admin'>();
  expectTypeOf<Values[number]>().toEqualTypeOf<'user' | 'admin'>();
});

test('db.enums.Role.members.User is the literal "user"', () => {
  expectTypeOf<(typeof enumDb)['enums']['Role']['members']['User']>().toEqualTypeOf<'user'>();
});
