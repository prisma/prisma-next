import { describe, expectTypeOf, test } from 'vitest';
import type { ComparisonMethods, ModelAccessor } from '../src/types';
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
  test('cosineDistance accepts vector argument', () => {
    type Fn = PostAccessor['embedding']['cosineDistance'];
    expectTypeOf<Fn>().toBeFunction();
    expectTypeOf<Parameters<Fn>>().toEqualTypeOf<[number[] | null]>();
  });

  test('cosineSimilarity accepts vector argument', () => {
    type Fn = PostAccessor['embedding']['cosineSimilarity'];
    expectTypeOf<Fn>().toBeFunction();
    expectTypeOf<Parameters<Fn>>().toEqualTypeOf<[number[] | null]>();
  });
});

describe('extension ops return ComparisonMethods with return-codec traits', () => {
  type CosineDistanceResult = ReturnType<PostAccessor['embedding']['cosineDistance']>;

  test('cosineDistance returns numeric comparison methods', () => {
    expectTypeOf<CosineDistanceResult>().toEqualTypeOf<
      ComparisonMethods<number, 'equality' | 'order' | 'numeric'>
    >();
  });

  test('cosineDistance result exposes eq', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('eq');
  });

  test('cosineDistance result exposes gt', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('gt');
  });

  test('cosineDistance result exposes lt', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('lt');
  });

  test('cosineDistance result exposes asc for ordering', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('asc');
  });

  test('cosineDistance result exposes desc for ordering', () => {
    expectTypeOf<CosineDistanceResult>().toHaveProperty('desc');
  });

  test('cosineDistance result does not expose like (textual-only)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('like');
  });

  test('cosineDistance result does not expose ilike (textual-only)', () => {
    expectTypeOf<CosineDistanceResult>().not.toHaveProperty('ilike');
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
