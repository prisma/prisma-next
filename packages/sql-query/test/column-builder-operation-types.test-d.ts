import { expectTypeOf, test } from 'vitest';
import type { ColumnBuilder } from '../src/types';

test('ColumnBuilder includes operation methods when operations are provided', () => {
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
  };

  type TestColumnBuilder = ColumnBuilder<
    'vector',
    { type: 'pgvector/vector@1'; nullable: false },
    unknown,
    TestOperations
  >;

  expectTypeOf<TestColumnBuilder>().toHaveProperty('cosineDistance');
  expectTypeOf<TestColumnBuilder['cosineDistance']>().toBeFunction();
});

test('ColumnBuilder does not include operations for different typeId', () => {
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
  };

  type TestColumnBuilder = ColumnBuilder<
    'text',
    { type: 'pg/text@1'; nullable: false },
    unknown,
    TestOperations
  >;

  expectTypeOf<TestColumnBuilder>().not.toHaveProperty('cosineDistance');
});

test('ColumnBuilder handles empty operations', () => {
  type EmptyOperations = Record<string, never>;

  type TestColumnBuilder = ColumnBuilder<
    'vector',
    { type: 'pgvector/vector@1'; nullable: false },
    unknown,
    EmptyOperations
  >;

  expectTypeOf<TestColumnBuilder>().not.toHaveProperty('cosineDistance');
});

