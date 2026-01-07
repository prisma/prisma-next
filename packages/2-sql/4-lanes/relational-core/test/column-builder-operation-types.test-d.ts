import type { PgVectorOperations } from '@prisma-next/test-utils';
import { expectTypeOf, test } from 'vitest';
import type { ColumnBuilder } from '../src/types.ts';

test('ColumnBuilder includes operation methods when operations are provided', () => {
  type TestColumnBuilder = ColumnBuilder<
    'vector',
    { nativeType: 'vector'; codecId: 'pg/vector@1'; nullable: false },
    unknown,
    PgVectorOperations
  >;

  expectTypeOf<TestColumnBuilder>().toHaveProperty('cosineDistance');
  expectTypeOf<TestColumnBuilder['cosineDistance']>().toBeFunction();
});

test('ColumnBuilder does not include operations for different typeId', () => {
  type TestColumnBuilder = ColumnBuilder<
    'text',
    { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false },
    unknown,
    PgVectorOperations
  >;

  type CosineDistanceMethod = TestColumnBuilder extends { cosineDistance: infer M } ? M : never;
  expectTypeOf<CosineDistanceMethod>().toEqualTypeOf<never>();
});

test('ColumnBuilder handles empty operations', () => {
  type EmptyOperations = Record<string, never>;

  type TestColumnBuilder = ColumnBuilder<
    'vector',
    { nativeType: 'vector'; codecId: 'pg/vector@1'; nullable: false },
    unknown,
    EmptyOperations
  >;

  type CosineDistanceMethod = TestColumnBuilder extends { cosineDistance: infer M } ? M : never;
  expectTypeOf<CosineDistanceMethod>().toEqualTypeOf<never>();
});
