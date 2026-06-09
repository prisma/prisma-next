import type { Db, Namespace, TableProxy } from '@prisma-next/sql-builder/types';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient, PostgresTransactionContext } from '../src/runtime/postgres';
import type { Contract } from './fixtures/namespaced-contract';

declare const db: PostgresClient<Contract>;

type DbSql = PostgresClient<Contract>['sql'];
type DbOrm = PostgresClient<Contract>['orm'];

test('db.sql exposes the qualified namespace map; flat access is gone', () => {
  expectTypeOf(db.sql.public.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<Namespace<Contract, 'public'>['users']>().toEqualTypeOf<
    TableProxy<Contract, 'users'>
  >();
  // @ts-expect-error flat db.sql.users is gone
  db.sql.users;
});

test('db.orm exposes the qualified namespace map; flat access is gone', () => {
  expectTypeOf(db.orm.public.User).toHaveProperty('all');
  // @ts-expect-error flat db.orm.User is gone
  db.orm.User;
});

test('an undeclared namespace id is not a key on db.sql or db.orm', () => {
  // @ts-expect-error 'auth' is not a declared storage namespace of this contract
  db.sql.auth;
  // @ts-expect-error 'auth' is not a declared domain namespace of this contract
  db.orm.auth;
});

test('transaction re-types sql/orm with the same qualified surface', () => {
  type TxSql = PostgresTransactionContext<Contract>['sql'];
  type TxOrm = PostgresTransactionContext<Contract>['orm'];
  expectTypeOf<TxSql>().toEqualTypeOf<DbSql>();
  expectTypeOf<TxOrm>().toEqualTypeOf<DbOrm>();

  db.transaction(async (tx) => {
    expectTypeOf(tx.sql.public.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
    // @ts-expect-error flat tx.sql.users is gone
    tx.sql.users;
    expectTypeOf(tx.orm.public.User).toHaveProperty('all');
    return undefined;
  });
});

test('prepare callback receives the qualified sql surface', () => {
  type PrepareSql = Parameters<Parameters<PostgresClient<Contract>['prepare']>[1]>[0];
  expectTypeOf<PrepareSql>().toEqualTypeOf<Db<Contract>>();
  expectTypeOf<PrepareSql['public']['users']>().toEqualTypeOf<TableProxy<Contract, 'users'>>();
  // @ts-expect-error flat PrepareSql['users'] is gone
  type _Flat = PrepareSql['users'];
});
