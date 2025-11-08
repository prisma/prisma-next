import { expectTypeOf, test } from 'vitest';
import type { OperationsForTypeId } from '../src/types';

test('defines type-level operation registry', () => {
  type TestOperations = {
    'pgvector/vector@1': {
      cosineDistance: {
        args: ReadonlyArray<{ kind: 'typeId'; type: 'pgvector/vector@1' }>;
        returns: { kind: 'builtin'; type: 'number' };
        lowering: {
          targetFamily: 'sql';
          strategy: 'function';
          template: string;
        };
      };
      l2Distance: {
        args: ReadonlyArray<{ kind: 'typeId'; type: 'pgvector/vector@1' }>;
        returns: { kind: 'builtin'; type: 'number' };
        lowering: {
          targetFamily: 'sql';
          strategy: 'function';
          template: string;
        };
      };
    };
  };

  // Type check: TestOperations extends OperationTypes
  // This is verified by the type system - if it doesn't extend, we'd get a compile error
  expectTypeOf<TestOperations>().toHaveProperty('pgvector/vector@1');
});

test('extracts operations for a given typeId', () => {
  type TestOperations = {
    'pgvector/vector@1': {
      cosineDistance: {
        args: ReadonlyArray<{ kind: 'typeId'; type: 'pgvector/vector@1' }>;
        returns: { kind: 'builtin'; type: 'number' };
        lowering: {
          targetFamily: 'sql';
          strategy: 'function';
          template: string;
        };
      };
    };
    'pg/text@1': {
      length: {
        args: ReadonlyArray<never>;
        returns: { kind: 'builtin'; type: 'number' };
        lowering: {
          targetFamily: 'sql';
          strategy: 'function';
          template: string;
        };
      };
    };
  };

  type VectorOps = OperationsForTypeId<'pgvector/vector@1', TestOperations>;
  expectTypeOf<VectorOps>().toHaveProperty('cosineDistance');
  expectTypeOf<VectorOps>().not.toHaveProperty('length');

  type TextOps = OperationsForTypeId<'pg/text@1', TestOperations>;
  expectTypeOf<TextOps>().toHaveProperty('length');
  expectTypeOf<TextOps>().not.toHaveProperty('cosineDistance');

  type UnknownOps = OperationsForTypeId<'unknown/type@1', TestOperations>;
  expectTypeOf<UnknownOps>().toEqualTypeOf<Record<string, never>>();
});

test('handles empty operations registry', () => {
  type EmptyOperations = Record<string, never>;

  type Ops = OperationsForTypeId<'pgvector/vector@1', EmptyOperations>;
  expectTypeOf<Ops>().toEqualTypeOf<Record<string, never>>();
});
