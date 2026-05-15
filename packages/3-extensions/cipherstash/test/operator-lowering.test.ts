/**
 * Operator lowering — cross-cutting cipherstash predicates that don't
 * fit into a single operator-family file:
 *
 *   - `null short-circuit` — `WHERE col IS [NOT] NULL` lowers to a
 *     plain Postgres null check (no EQL function call); the
 *     cipherstash extension must not intercept null checks. Null-check
 *     methods construct `NullCheckExpr` directly and never enter the
 *     operator-registry dispatch path, so cipherstash does not need to
 *     register an extension handler. The snapshot pins the absence of
 *     any EQL function call.
 *   - `per-codec envelope dispatch` — trait-dispatched operators
 *     (`cipherstashGt`, `cipherstashNe`, …) wrap the user-supplied
 *     value in the envelope subclass that matches the column's codec
 *     id at impl time. Each row pins the dispatch is correct for one
 *     codec (string / double / bigint / date / boolean).
 *   - `cipherstashJsonbPathExists` — lowers to
 *     `eql_v2.jsonb_path_exists(col, $1)`. The path is a plain text
 *     bind, not an envelope.
 *   - `createCipherstashRuntimeDescriptor — queryOperations
 *     registration` — exposes the full cipherstash operator surface
 *     via the runtime descriptor. Names are cipherstash-prefixed so
 *     they coexist with the framework's built-in `eq` / `ilike`
 *     registrations rather than overriding them. Two registration
 *     shapes coexist (see ADR 214): single-codec (`cipherstashEq` /
 *     `cipherstashIlike` target the string codec by id) and
 *     trait-namespaced (every other operator targets a `cipherstash:*`
 *     trait, attached to every codec descriptor whose `traits` list
 *     contains that identifier).
 *
 * Single-codec operator families have their own files:
 *   - `operator-lowering-equality.test.ts`
 *   - `operator-lowering-text-search.test.ts`
 *   - `operator-lowering-order-range.test.ts`
 *
 * The shared adapter / contract / operator-invocation scaffolding
 * lives in `operator-lowering.helpers.ts` and is reused across all
 * four operator-lowering test files.
 *
 * Why we do not exercise the bulk-encrypt middleware here. The
 * middleware reads `params.entries()` and stamps ciphertexts via
 * `replaceValues` — a concern of the runtime's `beforeExecute` chain,
 * not of the AST → SQL lowering. The middleware's contract is covered
 * exhaustively by `bulk-encrypt-middleware.test.ts` and the SDK-call-
 * counter assertion of `storage-roundtrip.e2e.integration.test.ts`.
 * These snapshot tests assert only that the SQL shape produced by
 * lowering would be a valid input to that middleware (a `ParamRef`
 * carrying an `EncryptedString` envelope tagged with the cipherstash
 * codec id).
 */

import { ColumnRef, NullCheckExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { EncryptedBigInt } from '../src/execution/envelope-bigint';
import { EncryptedBoolean } from '../src/execution/envelope-boolean';
import { EncryptedDate } from '../src/execution/envelope-date';
import { EncryptedDouble } from '../src/execution/envelope-double';
import { createCipherstashRuntimeDescriptor } from '../src/exports/runtime';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../src/extension-metadata/constants';
import {
  COLUMN,
  callOperator,
  columnAccessor,
  contract,
  emptySdk,
  getOperator,
  makeAdapter,
  selectWithWhere,
  TABLE,
} from './operator-lowering.helpers';

describe('cipherstash operator lowering — null short-circuit', () => {
  // The `isNull` / `isNotNull` ORM column methods construct
  // `NullCheckExpr` directly (see
  // `packages/3-extensions/sql-orm-client/src/types.ts:374-381`); they
  // never enter the operator-registry dispatch path, so cipherstash
  // does not need to register an extension handler. The snapshot pins
  // the absence of any EQL function call — the lowering is the same
  // shape Postgres uses for any other column type.

  it('lowers email IS NULL to "user"."email" IS NULL — no EQL function call', () => {
    const ast = selectWithWhere(NullCheckExpr.isNull(ColumnRef.of(TABLE, COLUMN)));

    const lowered = makeAdapter().lower(ast, { contract });

    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE "user"."email" IS NULL"`,
    );
    expect(lowered.sql).not.toContain('eql_v2.');
    expect(lowered.params).toHaveLength(0);
  });

  it('lowers email IS NOT NULL to "user"."email" IS NOT NULL — no EQL function call', () => {
    const ast = selectWithWhere(NullCheckExpr.isNotNull(ColumnRef.of(TABLE, COLUMN)));

    const lowered = makeAdapter().lower(ast, { contract });

    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE "user"."email" IS NOT NULL"`,
    );
    expect(lowered.sql).not.toContain('eql_v2.');
    expect(lowered.params).toHaveLength(0);
  });
});

describe('cipherstash operator lowering — per-codec envelope dispatch', () => {
  // Trait-dispatched operators wrap the user-supplied value in the
  // envelope subclass that matches the column's codec id at impl
  // time. Each row here pins the dispatch is correct for one codec.

  it('cipherstashGt on a double column wraps the value in EncryptedDouble', () => {
    const op = getOperator('cipherstashGt');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'score', CIPHERSTASH_DOUBLE_CODEC_ID),
      3.14,
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.params).toHaveLength(1);
    const slot = lowered.params[0];
    if (slot?.kind !== 'literal') throw new Error('expected literal slot');
    expect(slot.value).toBeInstanceOf(EncryptedDouble);
  });

  it('cipherstashGt on a bigint column wraps the value in EncryptedBigInt', () => {
    const op = getOperator('cipherstashGt');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'amount', CIPHERSTASH_BIGINT_CODEC_ID),
      42n,
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    const slot = lowered.params[0];
    if (slot?.kind !== 'literal') throw new Error('expected literal slot');
    expect(slot.value).toBeInstanceOf(EncryptedBigInt);
  });

  it('cipherstashGt on a date column wraps the value in EncryptedDate', () => {
    const op = getOperator('cipherstashGt');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'birthday', CIPHERSTASH_DATE_CODEC_ID),
      new Date('2024-01-01'),
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    const slot = lowered.params[0];
    if (slot?.kind !== 'literal') throw new Error('expected literal slot');
    expect(slot.value).toBeInstanceOf(EncryptedDate);
  });

  it('cipherstashNe on a boolean column wraps the value in EncryptedBoolean', () => {
    const op = getOperator('cipherstashNe');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'enabled', CIPHERSTASH_BOOLEAN_CODEC_ID),
      true,
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    const slot = lowered.params[0];
    if (slot?.kind !== 'literal') throw new Error('expected literal slot');
    expect(slot.value).toBeInstanceOf(EncryptedBoolean);
  });

  it('cipherstashGt rejects a non-matching plaintext type for the column codec', () => {
    const op = getOperator('cipherstashGt');
    // Passing a string to a double column triggers the per-codec
    // envelope coercion's diagnostic.
    expect(() =>
      callOperator(op, columnAccessor(TABLE, 'score', CIPHERSTASH_DOUBLE_CODEC_ID), 'not-a-number'),
    ).toThrow(/EncryptedDouble/);
  });
});

describe('cipherstash operator lowering — JSON path predicate', () => {
  it('lowers cipherstashJsonbPathExists(path) to eql_v2.jsonb_path_exists(...)', () => {
    const op = getOperator('cipherstashJsonbPathExists');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID),
      '$.k',
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE eql_v2.jsonb_path_exists("user"."payload", $1)"`,
    );
    // Path is a plain text bind — no envelope wrapping.
    expect(lowered.params).toEqual([{ kind: 'literal', value: '$.k' }]);
  });

  it('cipherstashJsonbPathExists rejects non-string path arguments', () => {
    const op = getOperator('cipherstashJsonbPathExists');
    expect(() =>
      callOperator(op, columnAccessor(TABLE, 'payload', CIPHERSTASH_JSON_CODEC_ID), 42),
    ).toThrow(/string path/);
  });
});

describe('createCipherstashRuntimeDescriptor — queryOperations registration', () => {
  it('exposes the full cipherstash operator surface via the runtime descriptor', () => {
    // Names are cipherstash-prefixed so they coexist with the
    // framework`s built-in `eq` / `ilike` registrations rather than
    // overriding them. The trade-off is documented in
    // `src/execution/operators.ts`'s top-level docblock.
    //
    // Two registration shapes coexist (see ADR 214):
    //   - Single-codec: `cipherstashEq` / `cipherstashIlike` (the
    //     original predicate pair) target the string codec by id.
    //   - Trait-namespaced: every other operator targets a
    //     `cipherstash:*` trait. The model accessor attaches the
    //     operator to every codec descriptor whose `traits` list
    //     contains that identifier.
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const ops = descriptor.queryOperations?.() ?? {};
    const methods = Object.keys(ops).sort();
    expect(methods).toEqual([
      'cipherstashBetween',
      'cipherstashEq',
      'cipherstashGt',
      'cipherstashGte',
      'cipherstashIlike',
      'cipherstashInArray',
      'cipherstashJsonbPathExists',
      'cipherstashLt',
      'cipherstashLte',
      'cipherstashNe',
      'cipherstashNotBetween',
      'cipherstashNotIlike',
      'cipherstashNotInArray',
    ]);
    for (const method of ['cipherstashEq', 'cipherstashIlike']) {
      expect(ops[method]?.self).toEqual({ codecId: CIPHERSTASH_STRING_CODEC_ID });
    }
    for (const method of ['cipherstashNe', 'cipherstashInArray', 'cipherstashNotInArray']) {
      expect(ops[method]?.self).toEqual({ traits: ['cipherstash:equality'] });
    }
    expect(ops['cipherstashNotIlike']?.self).toEqual({
      traits: ['cipherstash:free-text-search'],
    });
    for (const method of [
      'cipherstashGt',
      'cipherstashGte',
      'cipherstashLt',
      'cipherstashLte',
      'cipherstashBetween',
      'cipherstashNotBetween',
    ]) {
      expect(ops[method]?.self).toEqual({ traits: ['cipherstash:order-and-range'] });
    }
    expect(ops['cipherstashJsonbPathExists']?.self).toEqual({
      traits: ['cipherstash:searchable-json'],
    });
  });
});
