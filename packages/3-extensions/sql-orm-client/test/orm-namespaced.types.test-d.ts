import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const db = orm({ runtime: createMockRuntime(), context: getTestContext() });

test('the namespace facet exposes its models', () => {
  expectTypeOf(db.public).toHaveProperty('User');
  expectTypeOf(db.public).toHaveProperty('Post');
});

test('the flat by-bare-model surface is gone — namespace selection is mandatory', () => {
  // @ts-expect-error 'User' is a model, not a declared domain namespace: the
  // flat by-bare-model accessor was removed, so `orm.<Model>` is no longer a
  // key on OrmClient. Reach models via their namespace facet (`orm.public.User`).
  db.User;
  // @ts-expect-error 'Post' is a model, not a declared domain namespace.
  db.Post;
});

test('an undeclared namespace id is not a key on the typed surface', () => {
  // @ts-expect-error 'auth' is not a declared domain namespace of this contract
  db.auth;
});

type DomainNamespaceIds<C extends Contract<SqlStorage>> = keyof C['domain']['namespaces'];
type StorageNamespaceIds<C extends Contract<SqlStorage>> = keyof C['storage']['namespaces'];
// Top-level enums (no domain model) land in the storage-only `__unbound__`
// schema, so domain namespace ids are the storage namespace ids minus it.
type ModelBearingStorageNamespaceIds<C extends Contract<SqlStorage>> = Exclude<
  StorageNamespaceIds<C>,
  '__unbound__'
>;

// A two-namespace shape reusing the generated fixture's namespace content, so
// the alignment assertion below exercises more than a single namespace id.
interface TwoNamespaceContract extends Omit<TestContract, 'domain' | 'storage'> {
  readonly domain: Omit<TestContract['domain'], 'namespaces'> & {
    readonly namespaces: {
      readonly public: TestContract['domain']['namespaces']['public'];
      readonly auth: TestContract['domain']['namespaces']['public'];
    };
  };
  readonly storage: Omit<TestContract['storage'], 'namespaces'> & {
    readonly namespaces: {
      readonly public: TestContract['storage']['namespaces']['public'];
      readonly auth: TestContract['storage']['namespaces']['public'];
    };
  };
}

test('the namespaced orm keys equal the model-bearing namespaced sql keys', () => {
  expectTypeOf<DomainNamespaceIds<TestContract>>().toEqualTypeOf<
    ModelBearingStorageNamespaceIds<TestContract>
  >();
  expectTypeOf<DomainNamespaceIds<TwoNamespaceContract>>().toEqualTypeOf<
    ModelBearingStorageNamespaceIds<TwoNamespaceContract>
  >();
});
