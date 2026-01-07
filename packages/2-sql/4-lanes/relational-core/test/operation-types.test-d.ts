import type { CombinedTestOperations, PgVectorOperations } from '@prisma-next/test-utils';
import { expectTypeOf, test } from 'vitest';
import type { OperationsForTypeId } from '../src/exports/types.ts';

test('defines type-level operation registry', () => {
  // Type check: PgVectorOperations extends OperationTypes
  // This is verified by the type system - if it doesn't extend, we'd get a compile error
  expectTypeOf<PgVectorOperations>().toHaveProperty('pg/vector@1');
});

test('extracts operations for a given typeId', () => {
  type VectorOps = OperationsForTypeId<'pg/vector@1', CombinedTestOperations>;
  expectTypeOf<VectorOps>().toHaveProperty('cosineDistance');
  expectTypeOf<VectorOps>().not.toHaveProperty('length');

  type TextOps = OperationsForTypeId<'pg/text@1', CombinedTestOperations>;
  expectTypeOf<TextOps>().toHaveProperty('length');
  expectTypeOf<TextOps>().not.toHaveProperty('cosineDistance');

  type UnknownOps = OperationsForTypeId<'unknown/type@1', CombinedTestOperations>;
  expectTypeOf<UnknownOps>().toEqualTypeOf<Record<string, never>>();
});

test('handles empty operations registry', () => {
  type EmptyOperations = Record<string, never>;

  type Ops = OperationsForTypeId<'pg/vector@1', EmptyOperations>;
  // When Operations is empty, OperationsForTypeId should return Record<string, never>
  expectTypeOf<Ops>().toEqualTypeOf<Record<string, never>>();
});
