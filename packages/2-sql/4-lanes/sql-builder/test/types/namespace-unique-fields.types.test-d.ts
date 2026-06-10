import { expectTypeOf, test } from 'vitest';
import type { Db } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

/**
 * Regression: the same bare table name in two namespaces, each with a
 * namespace-UNIQUE column, must be selectable through its own namespace facet.
 *
 * The generated fixture declares `public.users` with a unique `email` column.
 * Here we extend it with an `auth` namespace that declares the SAME bare table
 * name `users` but with a DIFFERENT unique column `token`.
 *
 * `Namespace<C, Ns>['users']` resolves to `TableProxy<C, Ns, 'users'>`, which
 * derives its selectable columns from the table at that namespace coordinate
 * (`storage.namespaces[Ns].entries.table.users`) rather than a cross-namespace
 * union. So each namespace's unique column is selectable through its own facet,
 * and the other namespace's unique column is not.
 */

interface TwoNamespaceContract extends Omit<Contract, 'storage'> {
  readonly storage: Omit<Contract['storage'], 'namespaces'> & {
    readonly namespaces: Contract['storage']['namespaces'] & {
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly users: {
              readonly columns: {
                readonly id: {
                  readonly nativeType: 'int4';
                  readonly codecId: 'pg/int4@1';
                  readonly nullable: false;
                };
                readonly token: {
                  readonly nativeType: 'text';
                  readonly codecId: 'pg/text@1';
                  readonly nullable: false;
                };
              };
              readonly primaryKey: { readonly columns: readonly ['id'] };
              readonly uniques: readonly [];
              readonly indexes: readonly [];
              readonly foreignKeys: readonly [];
            };
          };
          readonly type: Record<string, never>;
        };
      };
    };
  };
}

declare const db: Db<TwoNamespaceContract>;

test('the public-namespace users facet can select its unique column `email`', () => {
  const row = db.public.users.select('id', 'email').build();
  expectTypeOf(row).not.toBeNever();
});

test('the auth-namespace users facet can select its unique column `token`', () => {
  const row = db.auth.users.select('id', 'token').build();
  expectTypeOf(row).not.toBeNever();
});
