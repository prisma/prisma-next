import { expectTypeOf, test } from 'vitest';
import type { Db, Namespace, TableProxy } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;

test('the namespace facet exposes its tables as TableProxy', () => {
  expectTypeOf(db.public.users).toEqualTypeOf<TableProxy<Contract, 'users'>>();
  expectTypeOf<Namespace<Contract, 'public'>['users']>().toEqualTypeOf<
    TableProxy<Contract, 'users'>
  >();
});

test('the flat by-bare-name surface is gone — namespace selection is mandatory', () => {
  // @ts-expect-error flat 'users' is not a namespace key
  db.users;
});

test('an undeclared namespace id is not a key on the typed surface', () => {
  // @ts-expect-error 'auth' is not a declared storage namespace of this contract
  db.auth;
});
