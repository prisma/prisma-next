import type { ResultType } from '@prisma-next/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import { queries } from '../src/db';

type Priority = 'low' | 'high' | 'medium';

test('reading the enum column yields the value union, not string', () => {
  const plan = queries.task.select('id', 'priority').build();
  type Row = ResultType<typeof plan>;
  // The non-enum id stays the codec output (string), unaffected by the enum narrowing.
  expectTypeOf<Row['id']>().toEqualTypeOf<string>();
  // The enum column narrows to its value union, not the codec's bare string.
  expectTypeOf<Row['priority']>().toEqualTypeOf<Priority | null>();
  expectTypeOf<Row['priority']>().not.toEqualTypeOf<string | null>();
});

test('writing the enum column only accepts the value union', () => {
  // A declared member value is accepted.
  queries.task.insert([{ id: 'a', title: 'ok', priority: 'high' }]).build();

  // An out-of-union literal is a compile error.
  // @ts-expect-error 'urgent' is not a Priority member value.
  queries.task.insert([{ id: 'b', title: 'bad', priority: 'urgent' }]).build();
});
