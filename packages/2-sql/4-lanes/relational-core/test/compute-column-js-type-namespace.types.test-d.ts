import type { Contract, StorageHashBase } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ComputeColumnJsType } from '../src/types';

/**
 * Two namespaces declare the SAME bare table name `users`, each with a
 * namespace-UNIQUE column: `public.users` has `email` (text), `auth.users` has
 * `token` (int). `ComputeColumnJsType` is given an explicit namespace
 * coordinate and must resolve each column to its OWN namespace's JS type — and
 * resolve to `never` for a column that exists only in the other namespace. A
 * flat cross-namespace resolver would collapse `users` to the per-namespace
 * column intersection and reach neither unique column.
 */

type Col<Codec extends string> = {
  readonly nativeType: string;
  readonly codecId: Codec;
  readonly nullable: false;
};

type FixtureCodecTypes = {
  readonly 'core/int4': { readonly output: number };
  readonly 'core/text': { readonly output: string };
};

type PublicUsersTable = {
  readonly columns: {
    readonly id: Col<'core/int4'>;
    readonly email: Col<'core/text'>;
  };
  readonly uniques: readonly [];
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};

type AuthUsersTable = {
  readonly columns: {
    readonly id: Col<'core/int4'>;
    readonly token: Col<'core/int4'>;
  };
  readonly uniques: readonly [];
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};

type ScalarField<Codec extends string> = {
  readonly nullable: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: Codec };
};

type PublicUserModel = {
  readonly fields: {
    readonly id: ScalarField<'core/int4'>;
    readonly email: ScalarField<'core/text'>;
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'users';
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly email: { readonly column: 'email' };
    };
  };
};

type AuthUserModel = {
  readonly fields: {
    readonly id: ScalarField<'core/int4'>;
    readonly token: ScalarField<'core/int4'>;
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'users';
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly token: { readonly column: 'token' };
    };
  };
};

interface TwoNamespaceContract extends Omit<Contract<SqlStorage>, 'storage' | 'domain'> {
  readonly storage: {
    readonly storageHash: StorageHashBase<'sha256:two-namespace-resolver-fixture'>;
    readonly namespaces: {
      readonly public: {
        readonly id: 'public';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: { readonly users: PublicUsersTable };
          readonly type: Record<string, never>;
        };
      };
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: { readonly users: AuthUsersTable };
          readonly type: Record<string, never>;
        };
      };
    };
  };
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: { readonly User: PublicUserModel } };
      readonly auth: { readonly models: { readonly User: AuthUserModel } };
    };
  };
}

test('public coordinate resolves its own unique column `email`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'email', FixtureCodecTypes>
  >().toEqualTypeOf<string>();
});

test('auth coordinate resolves its own unique column `token`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'auth', 'users', 'token', FixtureCodecTypes>
  >().toEqualTypeOf<number>();
});

test('shared column `id` resolves within each coordinate', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'id', FixtureCodecTypes>
  >().toEqualTypeOf<number>();
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'auth', 'users', 'id', FixtureCodecTypes>
  >().toEqualTypeOf<number>();
});

test('public coordinate does not resolve the auth-only column `token`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'token', FixtureCodecTypes>
  >().toBeNever();
});

test('auth coordinate does not resolve the public-only column `email`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'auth', 'users', 'email', FixtureCodecTypes>
  >().toBeNever();
});
