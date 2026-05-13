/**
 * Operator lowering — order-and-range operators trait-dispatched via
 * `cipherstash:order-and-range`:
 *
 *   - `cipherstashGt` / `cipherstashGte` / `cipherstashLt` /
 *     `cipherstashLte`
 *   - `cipherstashBetween` / `cipherstashNotBetween`
 *
 * The trait is visible on the string, double, bigint, and date
 * codecs; this file exercises the lowered SQL shape against the
 * string column. Per-codec envelope wrapping (the dispatch table
 * picks `EncryptedDouble` / `EncryptedBigInt` / `EncryptedDate`
 * subclasses for the matching columns) lives in the keep file
 * `operator-lowering.test.ts`.
 *
 * Shared adapter / contract / operator-invocation scaffolding lives in
 * `operator-lowering.helpers.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  COLUMN,
  callOperator,
  columnAccessor,
  contract,
  getOperator,
  makeAdapter,
  selectWithWhere,
  TABLE,
} from './operator-lowering.helpers';

describe('cipherstash operator lowering — order-and-range extensions', () => {
  // `cipherstashGt/Gte/Lt/Lte/Between/NotBetween` dispatch via the
  // `cipherstash:order-and-range` trait — visible on string,
  // double, bigint, date codecs.

  it('lowers cipherstashGt(plaintext) to eql_v2.gt(...)', () => {
    const op = getOperator('cipherstashGt');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'm');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.gt("user"."email", $1::eql_v2_encrypted)"`,
    );
  });

  it('lowers cipherstashGte(plaintext) to eql_v2.gte(...)', () => {
    const op = getOperator('cipherstashGte');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'm');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.gte("user"."email", $1::eql_v2_encrypted)"`,
    );
  });

  it('lowers cipherstashLt(plaintext) to eql_v2.lt(...)', () => {
    const op = getOperator('cipherstashLt');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'm');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.lt("user"."email", $1::eql_v2_encrypted)"`,
    );
  });

  it('lowers cipherstashLte(plaintext) to eql_v2.lte(...)', () => {
    const op = getOperator('cipherstashLte');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'm');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.lte("user"."email", $1::eql_v2_encrypted)"`,
    );
  });

  it('lowers cipherstashBetween(lo, hi) to gte AND lte', () => {
    const op = getOperator('cipherstashBetween');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'a', 'm');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.gte("user"."email", $1::eql_v2_encrypted) AND eql_v2.lte("user"."email", $2::eql_v2_encrypted)"`,
    );
    expect(lowered.params).toHaveLength(2);
  });

  it('lowers cipherstashNotBetween(lo, hi) to NOT (gte AND lte)', () => {
    const op = getOperator('cipherstashNotBetween');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'a', 'm');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE NOT (eql_v2.gte("user"."email", $1::eql_v2_encrypted) AND eql_v2.lte("user"."email", $2::eql_v2_encrypted))"`,
    );
  });

  it('cipherstashBetween rejects wrong arity with a descriptive error', () => {
    const op = getOperator('cipherstashBetween');
    expect(() => callOperator(op, columnAccessor(TABLE, COLUMN), 'a')).toThrow(/expected 2/);
  });
});
