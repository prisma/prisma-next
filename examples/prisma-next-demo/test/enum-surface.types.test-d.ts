import type { ResultType } from '@prisma-next/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import type { EnumContract } from '../prisma/enum-contract';
import { queries } from '../prisma/enum-db';

type Priority = 'low' | 'high' | 'urgent';

test('reading the enum column yields the value union, not string', () => {
  const plan = queries.enum_task.select('id', 'priority').build();
  type Row = ResultType<typeof plan>;
  // The non-enum id stays the codec output (string), unaffected by narrowing.
  expectTypeOf<Row['id']>().toEqualTypeOf<string>();
  // The non-null enum column narrows to its value union — no spurious `| null`.
  expectTypeOf<Row['priority']>().toEqualTypeOf<Priority>();
  expectTypeOf<Row['priority']>().not.toEqualTypeOf<string>();
});

test('writing the enum column only accepts the value union', () => {
  queries.enum_task.insert([{ id: 'a', title: 'ok', priority: 'high' }]).build();

  queries.enum_task.insert([
    // @ts-expect-error 'nope' is not a Priority member value.
    { id: 'b', title: 'bad', priority: 'nope' },
  ]);
});

test('db.enums value tuple keeps its literal declaration order', () => {
  type Accessors = EnumContract extends { enumAccessors: infer A } ? A : never;
  type Values = Accessors extends { Priority: { values: infer V } } ? V : never;
  expectTypeOf<Values>().toEqualTypeOf<readonly ['low', 'high', 'urgent']>();
});
