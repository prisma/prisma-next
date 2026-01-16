import type { CoreHashBase } from '@prisma-next/contract/types';
import type { TableReference } from './src';

type CoreHash = CoreHashBase<'core-hash-example'>;
type AnotherCoreHash = CoreHashBase<'another-core-hash-example'>;

declare function foo(table: never | TableReference<never>): 'previous function call has bad input';
declare function foo<TName extends 'users' | 'posts'>(
  table: TableReference<TName, CoreHash>,
): TName extends string
  ? {
      bar(): void;
    }
  : 'previous function call has bad input';

declare const thatTable: TableReference<'users', CoreHash>;
declare const differentHashTable: TableReference<'users', AnotherCoreHash>;
declare const anotherTable: TableReference<'posts', CoreHash>;
declare const wrongTable: TableReference<'comments', CoreHash>;
declare const allTable: TableReference<string, CoreHash>;
// biome-ignore lint/suspicious/noExplicitAny: it's fine.
declare const anyTable: TableReference<any, CoreHash>;
declare const neverTable: TableReference<never, CoreHash>;
declare const customTable: { name: 'users' };
// @ts-expect-error
declare const unknownTable: TableReference<unknown, CoreHash>;

foo(thatTable).bar();
foo(anotherTable).bar();

// @ts-expect-error
foo(wrongTable)
  // @ts-expect-error
  .bar();
// @ts-expect-error
foo(allTable)
  // @ts-expect-error
  .bar();
foo(allTable as never)
  // @ts-expect-error
  .bar();
// biome-ignore lint/suspicious/noExplicitAny: it's fine
foo(allTable as any)
  // @ts-expect-error
  .bar();
foo(anyTable)
  // @ts-expect-error
  .bar();
foo(neverTable)
  // @ts-expect-error
  .bar();
// @ts-expect-error
foo(customTable)
  // @ts-expect-error
  .bar();
// @ts-expect-error
foo(unknownTable)
  // @ts-expect-error
  .bar();
// @ts-expect-error
foo(differentHashTable)
  // @ts-expect-error
  .bar();
