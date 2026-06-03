import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const db = orm({ runtime: createMockRuntime(), context: getTestContext() });

test('the namespace facet exposes its models as the same collection as the flat surface', () => {
  expectTypeOf(db.public.User).toEqualTypeOf(db.User);
  expectTypeOf(db.public.Post).toEqualTypeOf(db.Post);
});

test('the flat surface is retained alongside the namespace facet', () => {
  expectTypeOf(db.User).toEqualTypeOf(db.public.User);
});

test('an undeclared namespace id is not a key on the typed surface', () => {
  // @ts-expect-error 'auth' is not a declared domain namespace of this contract
  db.auth;
});

type DomainNamespaceIds<C extends Contract<SqlStorage>> = keyof C['domain']['namespaces'];
type StorageNamespaceIds<C extends Contract<SqlStorage>> = keyof C['storage']['namespaces'];

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

test('the namespaced orm keys equal the namespaced sql keys', () => {
  expectTypeOf<DomainNamespaceIds<TestContract>>().toEqualTypeOf<
    StorageNamespaceIds<TestContract>
  >();
  expectTypeOf<DomainNamespaceIds<TwoNamespaceContract>>().toEqualTypeOf<
    StorageNamespaceIds<TwoNamespaceContract>
  >();
});
