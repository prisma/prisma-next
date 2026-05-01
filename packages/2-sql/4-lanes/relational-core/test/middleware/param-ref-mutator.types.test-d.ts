import { expectTypeOf, test } from 'vitest';
import type { ParamRefHandle, SqlParamRefMutator } from '../../src/middleware/param-ref-mutator';

type Codecs = {
  'cipherstash/string@1': string;
  'pg/numeric@1': number;
};

declare const mutator: SqlParamRefMutator<Codecs>;
declare const stringHandle: ParamRefHandle<'cipherstash/string@1'>;
declare const numericHandle: ParamRefHandle<'pg/numeric@1'>;

test("AC-TYPE1: replaceValue accepts the codec's declared TInput", () => {
  mutator.replaceValue(stringHandle, 'a string');
  mutator.replaceValue(numericHandle, 42);
});

test('AC-TYPE1: entries() narrows ref by codecId discriminant', () => {
  for (const entry of mutator.entries()) {
    if (entry.codecId === 'cipherstash/string@1') {
      expectTypeOf(entry.ref).toEqualTypeOf<ParamRefHandle<'cipherstash/string@1'>>();
      mutator.replaceValue(entry.ref, 'narrowed-as-string');
    } else if (entry.codecId === 'pg/numeric@1') {
      expectTypeOf(entry.ref).toEqualTypeOf<ParamRefHandle<'pg/numeric@1'>>();
      mutator.replaceValue(entry.ref, 99);
    } else {
      expectTypeOf(entry.codecId).toEqualTypeOf<undefined>();
      mutator.replaceValue(entry.ref, 'anything goes for unresolved codecs');
    }
  }
});

test('AC-TYPE2: passing wrong-shape value to replaceValue is a type error', () => {
  // @ts-expect-error - cipherstash/string@1's TInput is `string`, not number
  mutator.replaceValue(stringHandle, 42);

  // @ts-expect-error - pg/numeric@1's TInput is `number`, not string
  mutator.replaceValue(numericHandle, 'not a number');
});

test('AC-MUT4: handles cannot be fabricated by callers (brand check)', () => {
  // Using the public surface alone, callers cannot construct a ParamRefHandle
  // because the brand is a unique symbol declared inside the module.
  // @ts-expect-error - object literals do not satisfy the branded handle
  const _bad: ParamRefHandle<'cipherstash/string@1'> = {};
});
