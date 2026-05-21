/**
 * Compile-time type tests for `.default(autoincrement())` against the
 * **production** Postgres column helpers (`pgInt4Column()`, `pgTextColumn()`,
 * etc.) — as opposed to the synthetic test helper at
 * `packages/2-sql/2-authoring/contract-ts/test/helpers/column-descriptor.ts`
 * which short-circuits to a trait-bearing descriptor shape directly.
 *
 * The production helpers go through the framework `column()` packager, which
 * surfaces the codec descriptor's `traits` tuple at the static type level.
 * This test verifies the trait gate's reach extends from the synthetic test
 * helper to the real production column helpers.
 *
 * Lives under `test/integration/` (not `packages/2-sql/2-authoring/contract-ts/test/`)
 * because the `sql` domain is forbidden from importing the `targets` domain
 * per `architecture.config.json § crossDomainRules` — and the production
 * helpers live in `@prisma-next/target-postgres`. The integration-tests
 * workspace already depends on both packages, which is the
 * layering-correct home for cross-cutting compile tests.
 */

import { autoincrement, field } from '@prisma-next/sql-contract-ts/contract-builder';
import { pgBoolColumn, pgInt4Column, pgTextColumn } from '@prisma-next/target-postgres/codecs';
import { describe, test } from 'vitest';

describe('.default(autoincrement()) trait gating against production column helpers', () => {
  test('compiles when production codec helper carries the autoincrement trait', () => {
    field.column(pgInt4Column()).default(autoincrement());
  });

  test('compile error when production codec helper lacks the autoincrement trait', () => {
    // @ts-expect-error pg/text@1 does not carry the autoincrement trait
    field.column(pgTextColumn()).default(autoincrement());
    // @ts-expect-error pg/bool@1 does not carry the autoincrement trait
    field.column(pgBoolColumn()).default(autoincrement());
  });
});

describe('.default(value) extracts codec TInput from production column helpers', () => {
  test('pgTextColumn().default(string) compiles', () => {
    field.column(pgTextColumn()).default('hello');
  });

  test('pgInt4Column().default(number) compiles', () => {
    field.column(pgInt4Column()).default(42);
  });

  test('pgBoolColumn().default(boolean) compiles', () => {
    field.column(pgBoolColumn()).default(true);
  });

  test('rejects values outside the codec TInput', () => {
    // @ts-expect-error pg/text@1 codec TInput is string, not number
    field.column(pgTextColumn()).default(42);
    // @ts-expect-error pg/int4@1 codec TInput is number, not string
    field.column(pgInt4Column()).default('not a number');
    // @ts-expect-error pg/bool@1 codec TInput is boolean, not string
    field.column(pgBoolColumn()).default('true');
  });
});
