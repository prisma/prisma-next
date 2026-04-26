import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { MongoClient } from '../src/runtime/mongo';

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
  expectTypeOf(promised).resolves.toMatchTypeOf<{
    readonly _id: string;
    readonly name: string;
    readonly email: string;
  } | null>();
});

test('db.orm.users.all() yields rows via AsyncIterableResult', () => {
  const all = db.orm.users.all();
  expectTypeOf(all).not.toBeNever();
  expectTypeOf(all).toMatchTypeOf<
    AsyncIterableResult<{
      readonly _id: string;
      readonly name: string;
      readonly email: string;
    }>
  >();
});

test('db.orm.tasks.variant("Bug").where(...) narrows to the variant', () => {
  const bugChain = db.orm.tasks.variant('Bug').where({ title: 'X' });
  expectTypeOf(bugChain).not.toBeNever();
});

test('db.orm key set matches the emitted roots (lowercased plurals only)', () => {
  type OrmKeys = keyof Db['orm'];
  expectTypeOf<OrmKeys>().toEqualTypeOf<'tasks' | 'users'>();
});
