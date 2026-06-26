import { expectTypeOf, test } from 'vitest';
import type { MongoContractView } from '../src/contract-view';
import type { MongoCollection } from '../src/ir/mongo-collection';
import type { Contract } from './fixtures/orm-contract.d';

/**
 * Emit-then-consume type tests: the `Contract` type is the real emitted
 * contract from `test/fixtures/orm-contract.d.ts`. All assertions check the
 * projected type against the actual emitted shape, not a hand-authored
 * `typeof` expression.
 */

test('MongoContractView.from returns a MongoContractView', () => {
  type CV = ReturnType<typeof MongoContractView.from<Contract>>;
  expectTypeOf<CV>().toMatchTypeOf<{ collection: object; entries: object }>();
});

test('cv.collection gives correctly typed built-in collection entities', () => {
  type CV = ReturnType<typeof MongoContractView.from<Contract>>;
  expectTypeOf<CV['collection']['tasks']>().toEqualTypeOf<MongoCollection>();
  expectTypeOf<CV['collection']['users']>().toEqualTypeOf<MongoCollection>();
});

test('a non-existent collection name is a compile error', () => {
  type CV = ReturnType<typeof MongoContractView.from<Contract>>;
  const cv = null as unknown as CV;
  // @ts-expect-error 'nonexistent' does not exist on the collection map
  cv.collection.nonexistent;
});

test('cv.entries does not contain the collection key', () => {
  type CV = ReturnType<typeof MongoContractView.from<Contract>>;
  type Entries = CV['entries'];
  type HasCollection = 'collection' extends keyof Entries ? true : false;
  expectTypeOf<HasCollection>().toEqualTypeOf<false>();
});
