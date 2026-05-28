import type { ModelAccessor } from '@prisma-next/sql-orm-client';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/generated/contract';

type PostAccessor = ModelAccessor<Contract, 'Post'>;
type UserAccessor = ModelAccessor<Contract, 'User'>;

describe('extension operations only appear on fields whose codec matches', () => {
  test('vector field exposes cosineDistance', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('cosineDistance');
  });

  test('vector field exposes cosineSimilarity', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('cosineSimilarity');
  });

  test('text field does not expose cosineDistance', () => {
    expectTypeOf<PostAccessor['title']>().not.toHaveProperty('cosineDistance');
  });

  test('text field does not expose cosineSimilarity', () => {
    expectTypeOf<PostAccessor['title']>().not.toHaveProperty('cosineSimilarity');
  });

  test('numeric field does not expose cosineDistance', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('cosineDistance');
  });

  test('numeric field does not expose cosineSimilarity', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('cosineSimilarity');
  });

  test('fields on a model without vector columns have no extension ops', () => {
    expectTypeOf<UserAccessor['name']>().not.toHaveProperty('cosineDistance');
    expectTypeOf<UserAccessor['name']>().not.toHaveProperty('cosineSimilarity');
  });
});

describe('extension operation argument types', () => {
  test('cosineDistance accepts raw JS value, null, and another vector column', () => {
    type Fn = PostAccessor['embedding']['cosineDistance'];
    expectTypeOf<Fn>().toBeFunction();
    const fn = null as unknown as Fn;
    // Raw JS vector literal
    fn([1, 2, 3]);
    // null (embedding is nullable)
    fn(null);
    // Another vector column — column handles implement Expression, so they
    // satisfy the Expression arm of CodecExpression.
    const otherPost = null as unknown as PostAccessor;
    fn(otherPost.embedding);
  });

  test('cosineSimilarity accepts raw JS value, null, and another vector column', () => {
    type Fn = PostAccessor['embedding']['cosineSimilarity'];
    expectTypeOf<Fn>().toBeFunction();
    const fn = null as unknown as Fn;
    fn([1, 2, 3]);
    fn(null);
    const otherPost = null as unknown as PostAccessor;
    fn(otherPost.embedding);
  });
});

describe('extension ops return registry-derived chained methods filtered by return-codec traits', () => {
  type CosineDistanceResult = ReturnType<PostAccessor['embedding']['cosineDistance']>;

  // The chained-result surface is derived from the SQL family registry
  // (via `ChainedResultMethods` in sql-orm-client/src/types.ts) filtered
  // by `OpMatchesField` against the return codec's traits. Concretely:
  // cosineDistance returns a pg/float8@1-like numeric codec carrying the
  // `equality + order + numeric` trait set, so the chained surface
  // exposes every family entry whose `self` matches.

  test('exposes eq (equality trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('eq');
  });

  test('exposes neq (equality trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('neq');
  });

  test('exposes in (equality trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('in');
  });

  test('exposes notIn (equality trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('notIn');
  });

  test('exposes gt (order trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('gt');
  });

  test('exposes gte (order trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('gte');
  });

  test('exposes lt (order trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('lt');
  });

  test('exposes lte (order trait)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('lte');
  });

  test('exposes isNull (any-codec)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('isNull');
  });

  test('exposes isNotNull (any-codec)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('isNotNull');
  });

  test('exposes asc for ordering (LegacyOrderingMethods, transient until slice 3b)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('asc');
  });

  test('exposes desc for ordering (LegacyOrderingMethods, transient until slice 3b)', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('desc');
  });

  test('does not expose like (textual trait absent on the numeric return codec)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('like');
  });

  test('does not expose ilike (extension op gated on textual trait, absent on the numeric return codec)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('ilike');
  });

  test('does not expose cosineDistance (extension op gated on the pgvector codec, not the numeric return codec)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('cosineDistance');
  });
});

describe('ilike extension operation on text fields', () => {
  test('text field exposes ilike', () => {
    expectTypeOf<PostAccessor['title']>().toHaveProperty('ilike');
  });

  test('ilike returns AnyExpression (predicate)', () => {
    type IlikeFn = PostAccessor['title']['ilike'];
    expectTypeOf<IlikeFn>().toBeFunction();
    expectTypeOf<ReturnType<IlikeFn>>().toExtend<
      import('@prisma-next/sql-relational-core/ast').AnyExpression
    >();
  });

  test('numeric field does not expose ilike', () => {
    expectTypeOf<PostAccessor['views']>().not.toHaveProperty('ilike');
  });

  test('vector field does not expose ilike', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('ilike');
  });
});

describe('vector field itself: only equality trait', () => {
  test('vector field exposes eq', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('eq');
  });

  test('vector field exposes isNull', () => {
    expectTypeOf<PostAccessor['embedding']>().toHaveProperty('isNull');
  });

  test('vector field does not expose gt (no order trait)', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('gt');
  });

  test('vector field does not expose like (no textual trait)', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('like');
  });

  test('vector field does not expose asc (no order trait)', () => {
    expectTypeOf<PostAccessor['embedding']>().not.toHaveProperty('asc');
  });
});
