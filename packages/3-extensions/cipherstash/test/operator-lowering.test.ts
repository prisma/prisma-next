/**
 * Operator lowering — snapshot tests pinning the SQL shape that
 * cipherstash-typed columns lower to under each user-facing predicate:
 *
 *   - `email.cipherstashEq(value)` on a `cipherstash/string@1` column
 *     lowers to `eql_v2.eq("email", $1::eql_v2_encrypted)`. The `$1`
 *     parameter is bound to an `EncryptedString` envelope that the
 *     bulk-encrypt middleware populates with ciphertext before the
 *     Postgres codec encodes the wire payload — not asserted here
 *     (live-Postgres exercise lives in the e2e suite); this round
 *     only pins the SQL shape.
 *
 *   - `email.cipherstashIlike(pattern)` lowers to
 *     `eql_v2.ilike("email", $1::eql_v2_encrypted)`. EQL's `ilike`
 *     function takes an encrypted match-term (the pattern is encrypted
 *     just like an `eq` value).
 *
 *   The user-facing method names are cipherstash-prefixed
 *   (`cipherstashEq` / `cipherstashIlike`) so the registrations
 *   coexist with the framework`s built-in `eq` / `ilike` rather than
 *   overriding them — the framework registry rejects same-method
 *   collisions and we don`t override operators. See
 *   `src/execution/operators.ts` for the trade-off rationale and the
 *   gap that follow-up framework work (per-codec where-binding
 *   rewrite SPI) would close.
 *
 *   - `WHERE email IS NULL` lowers to `WHERE "user"."email" IS NULL`
 *     — no EQL function call. Null checks short-circuit at the
 *     framework level via the always-on `isNull` / `isNotNull`
 *     comparison methods (no trait gating, no codec dispatch — see
 *     `COMPARISON_METHODS_META.isNull` in
 *     `packages/3-extensions/sql-orm-client/src/types.ts`), so this is
 *     a regression assertion: the cipherstash extension must not
 *     intercept null checks.
 *
 *   - `WHERE email IS NOT NULL` — same shape with `IS NOT NULL`.
 *
 * The lowering shape is verified against the stack-composed Postgres
 * runtime adapter (the helper at `packages/3-targets/6-adapters/
 * postgres/test/helpers/composed-adapter.ts` reproduced inline so
 * cipherstash does not pick up a postgres-package test export
 * dependency) loaded with the cipherstash runtime descriptor. The
 * adapter's `lower` is what the runtime's encode pipeline calls before
 * driver execution; pinning its output is the strongest unit-level
 * assurance available without standing up a real Postgres + EQL
 * bundle.
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

import postgresRuntimeAdapter from '@prisma-next/adapter-postgres/runtime';
import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type {
  RuntimeExtensionDescriptor,
  RuntimeTargetDescriptor,
} from '@prisma-next/framework-components/execution';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import {
  type AnyExpression,
  ColumnRef,
  NullCheckExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { EncryptedString } from '../src/execution/envelope';
import { EncryptedBigInt } from '../src/execution/envelope-bigint';
import { EncryptedBoolean } from '../src/execution/envelope-boolean';
import { EncryptedDate } from '../src/execution/envelope-date';
import { EncryptedDouble } from '../src/execution/envelope-double';
import { cipherstashQueryOperations } from '../src/execution/operators';
import type { CipherstashSdk } from '../src/execution/sdk';
import { createCipherstashRuntimeDescriptor } from '../src/exports/runtime';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  EQL_V2_ENCRYPTED_TYPE,
} from '../src/extension-metadata/constants';

// Minimal SDK stub. Operator lowering doesn't talk to the SDK — the codec
// captures it lazily for the read-side decrypt path — but
// `createCipherstashRuntimeDescriptor({ sdk })` requires one.
function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

const TABLE = 'user';
const COLUMN = 'email';

const contract = validateContract<PostgresContract>(
  {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'sha256:cipherstash-operator-lowering-test',
    roots: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
    storage: {
      storageHash: 'sha256:cipherstash-operator-lowering-test-storage',
      tables: {
        [TABLE]: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            [COLUMN]: {
              codecId: CIPHERSTASH_STRING_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            // Per-codec columns so the trait-dispatched operators
            // can be exercised against each column type (the
            // postgres renderer reads `nativeType` from the codec
            // descriptor at lower time; the column is what gives
            // the renderer the codec id to look up).
            score: {
              codecId: CIPHERSTASH_DOUBLE_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            amount: {
              codecId: CIPHERSTASH_BIGINT_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            birthday: {
              codecId: CIPHERSTASH_DATE_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            enabled: {
              codecId: CIPHERSTASH_BOOLEAN_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
            payload: {
              codecId: CIPHERSTASH_JSON_CODEC_ID,
              nativeType: EQL_V2_ENCRYPTED_TYPE,
              nullable: true,
            },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
  },
  emptyCodecLookup,
);

// Stub runtime target — the Postgres adapter only consults `familyId` /
// `targetId` on the target during `create`. Replicates the helper at
// `packages/3-targets/6-adapters/postgres/test/helpers/composed-adapter.ts`
// inline so cipherstash does not depend on a postgres-package test export.
const stubRuntimeTarget: RuntimeTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

function makeAdapter() {
  // Compose the Postgres runtime adapter with the cipherstash runtime
  // descriptor so the `cipherstash/string@1` codec is resolvable at
  // lower-time. `renderTypedParam` reads
  // `meta.db.sql.postgres.nativeType` off the registered codec to emit
  // `$N::eql_v2_encrypted`; without the cipherstash pack in the stack
  // the codec lookup would throw with a "missing extension pack" hint.
  const cipherstash: RuntimeExtensionDescriptor<'sql', 'postgres'> =
    createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
  return postgresRuntimeAdapter.create({
    target: stubRuntimeTarget,
    adapter: postgresRuntimeAdapter,
    driver: undefined,
    extensionPacks: [cipherstash],
  });
}

const cipherstashOperatorsByMethod = cipherstashQueryOperations();

function getOperator(method: string): SqlOperationDescriptor {
  const op = cipherstashOperatorsByMethod[method];
  if (!op) {
    throw new Error(`cipherstash operator descriptor for method "${method}" not found`);
  }
  return op;
}

/**
 * Invoke an operator's `impl` and return the produced AST node. The
 * impl's declared return type is the framework's `QueryOperationReturn`
 * (intentionally narrow — `sql-contract` does not depend on
 * `relational-core`); the practical shape every `buildOperation`-built
 * impl returns is `Expression<...>` whose `buildAst()` yields an
 * `AnyExpression`. Mirrors the cast in
 * `packages/3-extensions/sql-orm-client/src/model-accessor.ts:170`.
 */
function callOperator(op: SqlOperationDescriptor, ...args: unknown[]): AnyExpression {
  // `op.impl` is typed `(...args: never[]) => QueryOperationReturn` to
  // block accidental direct invocation; the practical shape is
  // `(self, ...args) => Expression<...>`. Cast through `unknown` to
  // bridge the framework's intentionally-narrow declared type.
  const impl = op.impl as unknown as (...args: unknown[]) => { buildAst(): AnyExpression };
  return impl(...args).buildAst();
}

/**
 * Build the same `Expression`-like shape the ORM model accessor
 * synthesises for a column field (see
 * `packages/3-extensions/sql-orm-client/src/model-accessor.ts:139-150`):
 * an object with `buildAst()` returning the underlying `ColumnRef` plus
 * the column's return type metadata. The operator impls call
 * `toExpr(self)` which destructures `buildAst()` to get the AST node.
 */
function columnAccessor(
  table: string,
  column: string,
  codecId: string = CIPHERSTASH_STRING_CODEC_ID,
) {
  const ref = ColumnRef.of(table, column);
  return {
    returnType: { codecId, nullable: true },
    buildAst: () => ref,
  };
}

function selectWithWhere(whereExpr: AnyExpression) {
  return SelectAst.from(TableSource.named(TABLE))
    .withProjection([ProjectionItem.of('id', ColumnRef.of(TABLE, 'id'))])
    .withWhere(whereExpr);
}

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

describe('cipherstash operator lowering — equality extensions (T9)', () => {
  // `cipherstashNe`, `cipherstashInArray`, `cipherstashNotInArray`
  // dispatch via the `cipherstash:equality` trait — visible on
  // string, double, bigint, date, boolean codecs (per spec D7).

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

describe('cipherstash operator lowering — free-text-search extensions (T9)', () => {
  it('lowers cipherstashNotIlike(pattern) to NOT eql_v2.ilike(...)', () => {
    const op = getOperator('cipherstashNotIlike');
    const predicate = callOperator(op, columnAccessor(TABLE, COLUMN), '%alice%');
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.sql).toMatchInlineSnapshot(
      `"SELECT "user"."id" AS "id" FROM "user" WHERE NOT eql_v2.ilike("user"."email", $1::eql_v2_encrypted)"`,
    );
  });
});

describe('cipherstash operator lowering — order-and-range extensions (T9)', () => {
  // `cipherstashGt/Gte/Lt/Lte/Between/NotBetween` dispatch via the
  // `cipherstash:order-and-range` trait — visible on string,
  // double, bigint, date codecs (per spec D7).

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

describe('cipherstash operator lowering — per-codec envelope dispatch (T9)', () => {
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
    const envelope = lowered.params[0];
    expect(envelope).toBeInstanceOf(EncryptedDouble);
  });

  it('cipherstashGt on a bigint column wraps the value in EncryptedBigInt', () => {
    const op = getOperator('cipherstashGt');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'amount', CIPHERSTASH_BIGINT_CODEC_ID),
      42n,
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.params[0]).toBeInstanceOf(EncryptedBigInt);
  });

  it('cipherstashGt on a date column wraps the value in EncryptedDate', () => {
    const op = getOperator('cipherstashGt');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'birthday', CIPHERSTASH_DATE_CODEC_ID),
      new Date('2024-01-01'),
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.params[0]).toBeInstanceOf(EncryptedDate);
  });

  it('cipherstashNe on a boolean column wraps the value in EncryptedBoolean', () => {
    const op = getOperator('cipherstashNe');
    const predicate = callOperator(
      op,
      columnAccessor(TABLE, 'enabled', CIPHERSTASH_BOOLEAN_CODEC_ID),
      true,
    );
    const lowered = makeAdapter().lower(selectWithWhere(predicate), { contract });
    expect(lowered.params[0]).toBeInstanceOf(EncryptedBoolean);
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

describe('cipherstash operator lowering — JSON path predicate (T9)', () => {
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
    expect(lowered.params).toEqual(['$.k']);
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
    // Two registration shapes coexist (per spec D7):
    //   - Single-codec: `cipherstashEq` / `cipherstashIlike` (legacy
    //     from Project 1) target the string codec by codec id.
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
