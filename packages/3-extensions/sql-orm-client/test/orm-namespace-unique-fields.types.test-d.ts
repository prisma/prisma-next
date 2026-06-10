import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, type TestContract } from './helpers';

/**
 * Regression: the same bare model name in two namespaces, each with a
 * namespace-UNIQUE field, must be queryable through its own namespace facet.
 *
 * The generated fixture declares `public.User` with a unique `email` field.
 * Here we extend it with an `auth` namespace that declares the SAME bare model
 * name `User` but with a DIFFERENT unique field `token`.
 *
 * `OrmNamespace<C, _, Ns>['User']` threads the `Ns` coordinate into the read
 * row, which resolves the model's fields within its namespace (the per-namespace
 * `domain.namespaces[Ns]` block + the nested `FieldOutputTypes[Ns]` map) rather
 * than the flat first-name-wins model map. So each namespace's read row carries
 * its own unique field, and the other namespace's unique field is absent.
 */

interface TwoNamespaceContract extends Omit<TestContract, 'domain' | 'storage'> {
  readonly domain: Omit<TestContract['domain'], 'namespaces'> & {
    readonly namespaces: TestContract['domain']['namespaces'] & {
      readonly auth: {
        readonly models: {
          readonly User: {
            readonly fields: {
              readonly id: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
              };
              readonly token: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
              };
            };
            readonly relations: Record<string, never>;
            readonly storage: {
              readonly table: 'auth_users';
              readonly namespaceId: 'auth';
              readonly fields: {
                readonly id: { readonly column: 'id' };
                readonly token: { readonly column: 'token' };
              };
            };
          };
        };
      };
    };
  };
  readonly storage: Omit<TestContract['storage'], 'namespaces'> & {
    readonly namespaces: TestContract['storage']['namespaces'] & {
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly auth_users: {
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

declare const context: ExecutionContext<TwoNamespaceContract>;
const db = orm({ runtime: createMockRuntime(), context });

test('the public-namespace User facet read row carries its unique field `email`', async () => {
  const row = await db.public.User.first();
  if (row) {
    expectTypeOf(row.email).toEqualTypeOf<string>();
  }
});

test('the auth-namespace User facet read row carries its unique field `token`', async () => {
  const row = await db.auth.User.first();
  if (row) {
    expectTypeOf(row.token).toEqualTypeOf<string>();
  }
});
