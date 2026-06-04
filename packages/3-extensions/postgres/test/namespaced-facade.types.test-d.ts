import type { Db, Namespace, TableProxy } from '@prisma-next/sql-builder/types';
import { expectTypeOf, test } from 'vitest';
import type { PostgresClient, PostgresTransactionContext } from '../src/runtime/postgres';
import type { Contract } from './fixtures/namespaced-contract';

declare const db: PostgresClient<Contract>;

type DbSql = PostgresClient<Contract>['sql'];
type DbOrm = PostgresClient<Contract>['orm'];

test('db.sql exposes the namespace facet alongside the flat surface', () => {
  expectTypeOf(db.sql.public.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf(db.sql.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<Namespace<Contract, 'public'>['users']>().toEqualTypeOf<
    TableProxy<Contract, 'users'>
  >();
});

test('db.orm exposes the namespace facet alongside the flat surface', () => {
  expectTypeOf(db.orm.public.User).toEqualTypeOf(db.orm.User);
  expectTypeOf(db.orm.User).toEqualTypeOf(db.orm.public.User);
});

test('an undeclared namespace id is not a key on db.sql or db.orm', () => {
  // @ts-expect-error 'auth' is not a declared storage namespace of this contract
  db.sql.auth;
  // @ts-expect-error 'auth' is not a declared domain namespace of this contract
  db.orm.auth;
});

test('transaction re-types sql/orm with the same namespaced surface', () => {
  type TxSql = PostgresTransactionContext<Contract>['sql'];
  type TxOrm = PostgresTransactionContext<Contract>['orm'];
  expectTypeOf<TxSql>().toEqualTypeOf<DbSql>();
  expectTypeOf<TxOrm>().toEqualTypeOf<DbOrm>();

  db.transaction(async (tx) => {
    expectTypeOf(tx.sql.public.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
    expectTypeOf(tx.sql.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
    expectTypeOf(tx.orm.public.User).toEqualTypeOf(tx.orm.User);
    return undefined;
  });
});

test('prepare callback receives the namespaced sql surface', () => {
  type PrepareSql = Parameters<Parameters<PostgresClient<Contract>['prepare']>[1]>[0];
  expectTypeOf<PrepareSql>().toEqualTypeOf<Db<Contract>>();
  expectTypeOf<PrepareSql['public']['users']>().toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<PrepareSql['users']>().toEqualTypeOf<TableProxy<Contract, 'users'>>();
});
