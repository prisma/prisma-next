/**
 * Operator lowering — free-text-search operators:
 *
 *   - `cipherstashIlike` (single-codec registration on the string codec)
 *   - `cipherstashNotIlike` (trait-dispatched via
 *     `cipherstash:free-text-search`)
 *
 * EQL's `ilike` function takes an encrypted match-term (the pattern is
 * encrypted just like an `eq` value); the bound param is an
 * `EncryptedString` envelope tagged with the `(table, column)` routing
 * key.
 *
 * Shared adapter / contract / operator-invocation scaffolding lives in
 * `operator-lowering.helpers.ts`.
 */

import { describe, expect, it } from 'vitest';
import { EncryptedString } from '../src/execution/envelope-string';
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

describe('cipherstash operator lowering — cipherstashIlike', () => {
  it('lowers email.cipherstashIlike(pattern) to eql_v2.ilike("email", $1::eql_v2_encrypted)', () => {
    const op = getOperator('cipherstashIlike');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), '%alice%');
    const ast = selectWithWhere(predicate);

    const lowered = makeAdapter().lower(ast, { contract });

    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.ilike("user"."email", $1::eql_v2_encrypted)"`,
    );
  });

  it('binds the pattern as an EncryptedString envelope tagged with the cipherstash routing key', () => {
    const op = getOperator('cipherstashIlike');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), '%alice%');
    const ast = selectWithWhere(predicate);

    const lowered = makeAdapter().lower(ast, { contract });

    expect(lowered.params).toHaveLength(1);
    const envelope = lowered.params[0];
    expect(envelope).toBeInstanceOf(EncryptedString);
    const handle = (envelope as EncryptedString).expose();
    expect(handle.plaintext).toBe('%alice%');
    expect(handle.table).toBe(TABLE);
    expect(handle.column).toBe(COLUMN);
  });
});

describe('cipherstash operator lowering — free-text-search extensions', () => {
  it('lowers cipherstashNotIlike(pattern) to NOT eql_v2.ilike(...)', () => {
    const op = getOperator('cipherstashNotIlike');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), '%alice%');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE NOT eql_v2.ilike("user"."email", $1::eql_v2_encrypted)"`,
    );
  });
});
