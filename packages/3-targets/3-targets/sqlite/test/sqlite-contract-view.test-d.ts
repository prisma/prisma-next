import { expectTypeOf, test } from 'vitest';
import type { SqliteContractView } from '../src/core/sqlite-contract-view';
import type { Contract } from './fixtures/sqlite-contract.d';

/**
 * Emit-then-consume type tests: `Contract` is the real emitted SQLite contract
 * from `test/fixtures/sqlite-contract.d.ts`. Assertions check the projected
 * view type against the actual emitted shape, not a hand-authored `typeof`.
 */

type CV = ReturnType<typeof SqliteContractView.from<Contract>>;

test('cv.table.<name> resolves to the concrete emitted table leaf', () => {
  expectTypeOf<
    CV['table']['users']['columns']['id']['codecId']
  >().toEqualTypeOf<'sqlite/integer@1'>();
  expectTypeOf<
    CV['table']['users']['columns']['email']['codecId']
  >().toEqualTypeOf<'sqlite/text@1'>();
  expectTypeOf<CV['table']['users']['primaryKey']['columns']>().toEqualTypeOf<readonly ['id']>();
});

test('multiple tables are reachable top-level', () => {
  expectTypeOf<
    CV['table']['posts']['columns']['id']['codecId']
  >().toEqualTypeOf<'sqlite/integer@1'>();
  expectTypeOf<
    CV['table']['comments']['columns']['body']['codecId']
  >().toEqualTypeOf<'sqlite/text@1'>();
});

test('a non-existent table name is a compile error', () => {
  const cv = null as unknown as CV;
  // @ts-expect-error 'nonexistent' is not an emitted table
  cv.table.nonexistent;
});

test('valueSet slot is present (SQLite emits none, so it is an empty map)', () => {
  expectTypeOf<CV['valueSet']>().toEqualTypeOf<Record<string, never>>();
});

test('cv.entries does not contain the built-in table or valueSet keys', () => {
  type Entries = CV['entries'];
  type HasTable = 'table' extends keyof Entries ? true : false;
  type HasValueSet = 'valueSet' extends keyof Entries ? true : false;
  expectTypeOf<HasTable>().toEqualTypeOf<false>();
  expectTypeOf<HasValueSet>().toEqualTypeOf<false>();
});
