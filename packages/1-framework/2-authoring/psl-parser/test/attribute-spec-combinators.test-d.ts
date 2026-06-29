import { expectTypeOf, test } from 'vitest';
import type { ArgType } from '../src/exports';
import { enumOf, list, str } from '../src/exports';

test('enumOf preserves a homogeneous string member union', () => {
  expectTypeOf(enumOf('NoAction', 'Cascade')).toEqualTypeOf<ArgType<'NoAction' | 'Cascade'>>();
});

test('enumOf carries a mixed string/number member union', () => {
  expectTypeOf(enumOf('text', 1, -1)).toEqualTypeOf<ArgType<'text' | 1 | -1>>();
});

test('list infers an array of its element type', () => {
  expectTypeOf(list(str())).toEqualTypeOf<ArgType<string[]>>();
});
