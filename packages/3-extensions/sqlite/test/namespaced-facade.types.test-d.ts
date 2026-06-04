import type { Db, Namespace, TableProxy } from '@prisma-next/sql-builder/types';
import { expectTypeOf, test } from 'vitest';
import type { SqliteClient } from '../src/runtime/sqlite';
import type { Contract } from './fixtures/namespaced-contract';

declare const db: SqliteClient<Contract>;

test('db.sql exposes the namespace facet alongside the flat surface', () => {
  expectTypeOf(db.sql.main.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf(db.sql.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<Namespace<Contract, 'main'>['users']>().toEqualTypeOf<
    TableProxy<Contract, 'users'>
  >();
});

test('db.orm exposes the namespace facet alongside the flat surface', () => {
  expectTypeOf(db.orm.main.User).toEqualTypeOf(db.orm.User);
  expectTypeOf(db.orm.User).toEqualTypeOf(db.orm.main.User);
});

test('an undeclared namespace id is not a key on db.sql or db.orm', () => {
  // @ts-expect-error 'auth' is not a declared storage namespace of this contract
  db.sql.auth;
  // @ts-expect-error 'auth' is not a declared domain namespace of this contract
  db.orm.auth;
});

test('prepare callback receives the namespaced sql surface', () => {
  type PrepareSql = Parameters<Parameters<SqliteClient<Contract>['prepare']>[1]>[0];
  expectTypeOf<PrepareSql>().toEqualTypeOf<Db<Contract>>();
  expectTypeOf<PrepareSql['main']['users']>().toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<PrepareSql['users']>().toEqualTypeOf<TableProxy<Contract, 'users'>>();
});
