/**
 * Operator lowering — equality-family operators on
 * `cipherstash/string@1` columns:
 *
 *   - `cipherstashEq` (single-codec registration on the string codec)
 *   - `cipherstashNe` / `cipherstashInArray` / `cipherstashNotInArray`
 *     (trait-dispatched via `cipherstash:equality`)
 *
 * The lowered SQL pins the `eql_v2.eq(...)` shape (positive form) and
 * the `NOT eql_v2.eq(...)` / OR-of-equalities (variable-arity forms).
 * Each bound param is an `EncryptedString` envelope tagged with the
 * `(table, column)` routing key — the cipherstash bulk-encrypt
 * middleware identifies envelopes via `instanceof` and groups them by
 * routing key at the encode-params boundary.
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

describe('cipherstash operator lowering — cipherstashEq', () => {
  it('lowers email.cipherstashEq(plaintext) to eql_v2.eq("email", $1::eql_v2_encrypted)', () => {
    const op = getOperator('cipherstashEq');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'alice@example.com');
    const ast = selectWithWhere(predicate);

    const lowered = makeAdapter().lower(ast, { contract });

    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.eq("user"."email", $1::eql_v2_encrypted)"`,
    );
  });

  it('binds the plaintext as an EncryptedString envelope tagged with the cipherstash routing key', () => {
    const op = getOperator('cipherstashEq');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'alice@example.com');
    const ast = selectWithWhere(predicate);

    const lowered = makeAdapter().lower(ast, { contract });

    // Single bound param; it is the `EncryptedString` envelope (NOT the
    // raw plaintext string) so the bulk-encrypt middleware can identify
    // it via `value instanceof EncryptedString` and group it by routing
    // key. Stamping `(table, column)` on the envelope at lowering time
    // is the mechanism that lets the SELECT-side (which
    // `bulk-encrypt.ts:stampRoutingKeysFromAst` does not walk — only
    // insert/update) still participate in the routing-key grouping.
    expect(lowered.params).toHaveLength(1);
    const envelope = lowered.params[0];
    expect(envelope).toBeInstanceOf(EncryptedString);
    const handle = (envelope as EncryptedString).expose();
    expect(handle.plaintext).toBe('alice@example.com');
    expect(handle.table).toBe(TABLE);
    expect(handle.column).toBe(COLUMN);
  });

  it('passes a pre-built EncryptedString envelope through unchanged (advanced caller path)', () => {
    const op = getOperator('cipherstashEq');
    const userEnvelope = EncryptedString.from('alice@example.com');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), userEnvelope);
    const ast = selectWithWhere(predicate);

    const lowered = makeAdapter().lower(ast, { contract });

    // The same envelope object flows through; the operator only
    // augments it with the routing key (write-once-wins semantics —
    // see `setHandleRoutingKey`).
    expect(lowered.params[0]).toBe(userEnvelope);
    const handle = userEnvelope.expose();
    expect(handle.table).toBe(TABLE);
    expect(handle.column).toBe(COLUMN);
  });
});

describe('cipherstash operator lowering — equality extensions', () => {
  // `cipherstashNe`, `cipherstashInArray`, `cipherstashNotInArray`
  // dispatch via the `cipherstash:equality` trait — visible on
  // string, double, bigint, date, boolean codecs.

  it('lowers email.cipherstashNe(plaintext) to NOT eql_v2.eq(...)', () => {
    const op = getOperator('cipherstashNe');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), 'alice@example.com');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE NOT eql_v2.eq("user"."email", $1::eql_v2_encrypted)"`,
    );
    expect(lowered.params).toHaveLength(1);
    expect(lowered.params[0]).toBeInstanceOf(EncryptedString);
  });

  it('lowers cipherstashInArray with a single element to a one-term OR', () => {
    const op = getOperator('cipherstashInArray');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), ['alice@example.com']);
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE (eql_v2.eq("user"."email", $1::eql_v2_encrypted))"`,
    );
    expect(lowered.params).toHaveLength(1);
  });

  it('lowers cipherstashInArray with two elements to a two-term OR', () => {
    const op = getOperator('cipherstashInArray');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), ['a@x.com', 'b@x.com']);
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE (eql_v2.eq("user"."email", $1::eql_v2_encrypted) OR eql_v2.eq("user"."email", $2::eql_v2_encrypted))"`,
    );
    expect(lowered.params).toHaveLength(2);
  });

  it('lowers cipherstashInArray with three elements to a three-term OR', () => {
    const op = getOperator('cipherstashInArray');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), [
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ]);
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE (eql_v2.eq("user"."email", $1::eql_v2_encrypted) OR eql_v2.eq("user"."email", $2::eql_v2_encrypted) OR eql_v2.eq("user"."email", $3::eql_v2_encrypted))"`,
    );
    expect(lowered.params).toHaveLength(3);
    // Every envelope shares the same `(table, column)` routing key —
    // the bulk-encrypt grouping invariant for variable-arity ops.
    for (const param of lowered.params) {
      expect(param).toBeInstanceOf(EncryptedString);
      const handle = (param as EncryptedString).expose();
      expect(handle.table).toBe(TABLE);
      expect(handle.column).toBe(COLUMN);
    }
  });

  it('lowers cipherstashNotInArray to NOT-prefixed OR-of-equalities', () => {
    const op = getOperator('cipherstashNotInArray');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), ['a@x.com', 'b@x.com']);
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE NOT (eql_v2.eq("user"."email", $1::eql_v2_encrypted) OR eql_v2.eq("user"."email", $2::eql_v2_encrypted))"`,
    );
  });

  it('cipherstashInArray rejects empty arrays with a descriptive error', () => {
    const op = getOperator('cipherstashInArray');
    expect(() => callOperator(op, columnAccessor(TABLE, COLUMN), [])).toThrow(/empty array/);
  });

  it('cipherstashInArray rejects non-array arguments with a descriptive error', () => {
    const op = getOperator('cipherstashInArray');
    expect(() => callOperator(op, columnAccessor(TABLE, COLUMN), 'not-an-array')).toThrow(
      /expected an array/,
    );
  });
});
