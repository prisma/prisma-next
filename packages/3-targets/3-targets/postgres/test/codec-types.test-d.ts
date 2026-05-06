import type { CodecInput } from '@prisma-next/sql-relational-core/ast';
import { expectTypeOf, test } from 'vitest';
import type { codecDefinitions } from '../src/core/codecs';
import type {
  Char,
  Numeric,
  Time,
  Timestamp,
  Timestamptz,
  Varchar,
} from '../src/exports/codec-types';

// Branded aliases must agree with their codec's declared input/output type.
// `pgTimestamp(tz)Codec` decodes to `Date`, so `Timestamp<P>` / `Timestamptz<P>`
// must be Date-shaped — calling Date methods on a projected column must
// typecheck without casts. See `core/codecs.ts:332-400`.

test('Timestamp<P> brand is Date-shaped', () => {
  expectTypeOf<Timestamp<3>>().toExtend<Date>();
  expectTypeOf<Timestamp>().toExtend<Date>();
  expectTypeOf<Timestamp<3>>().not.toExtend<string>();
});

test('Timestamptz<P> brand is Date-shaped', () => {
  expectTypeOf<Timestamptz<6>>().toExtend<Date>();
  expectTypeOf<Timestamptz>().toExtend<Date>();
  expectTypeOf<Timestamptz<6>>().not.toExtend<string>();
});

test('Timestamp/Timestamptz brand agrees with codec input/output type', () => {
  type TsInput = CodecInput<typeof codecDefinitions.timestamp.codec>;
  type TstzInput = CodecInput<typeof codecDefinitions.timestamptz.codec>;
  expectTypeOf<TsInput>().toEqualTypeOf<Date>();
  expectTypeOf<TstzInput>().toEqualTypeOf<Date>();
  expectTypeOf<Timestamp<3>>().toExtend<TsInput>();
  expectTypeOf<Timestamptz<6>>().toExtend<TstzInput>();
});

// Sanity: the other parameterized aliases stay string-shaped, because
// their codecs decode to string.

test('string-shaped parameterized aliases are unchanged', () => {
  expectTypeOf<Char<16>>().toExtend<string>();
  expectTypeOf<Varchar<255>>().toExtend<string>();
  expectTypeOf<Numeric<10, 2>>().toExtend<string>();
  expectTypeOf<Time<3>>().toExtend<string>();
});
