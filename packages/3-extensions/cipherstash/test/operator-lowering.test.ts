/**
 * Operator lowering — M3 R1 (T3.1 / T3.2 / T3.3).
 *
 * Snapshot tests pin the SQL shape that cipherstash-typed columns lower
 * to under each user-facing predicate the project surfaces in M3:
 *
 *   - **AC-OP1 (T3.1).** `email.cipherstashEq(value)` on a
 *     `cipherstash/string@1` column lowers to
 *     `eql_v2.eq("email", $1::eql_v2_encrypted)`. The `$1` parameter
 *     is bound to an `EncryptedString` envelope that the bulk-encrypt
 *     middleware (M2 R3) populates with ciphertext before the Postgres
 *     codec encodes the wire payload — not asserted here (live-Postgres
 *     exercise lives in M3 R2 / T3.5); this round only pins the SQL
 *     shape.
 *
 *   - **AC-OP2 (T3.2).** `email.cipherstashIlike(pattern)` lowers to
 *     `eql_v2.ilike("email", $1::eql_v2_encrypted)`. EQL's `ilike`
 *     function takes an encrypted match-term (the pattern is encrypted
 *     just like an `eq` value).
 *
 *   The user-facing method names are cipherstash-prefixed
 *   (`cipherstashEq` / `cipherstashIlike`) so the registrations
 *   coexist with the framework`s built-in `eq` / `ilike` rather than
 *   overriding them — the framework registry rejects same-method
 *   collisions and we don`t override operators. See `src/core/operators.ts`
 *   for the trade-off rationale and the gap that follow-up framework
 *   work (per-codec where-binding rewrite SPI) would close.
 *
 *   - **AC-OP3 (T3.3).** `WHERE email IS NULL` lowers to
 *     `WHERE "user"."email" IS NULL` — no EQL function call. Null
 *     checks short-circuit at the framework level via the always-on
 *     `isNull` / `isNotNull` comparison methods (no trait gating, no
 *     codec dispatch — see `COMPARISON_METHODS_META.isNull` in
 *     `packages/3-extensions/sql-orm-client/src/types.ts`), so this is
 *     a regression assertion: the cipherstash extension must not
 *     intercept null checks.
 *
 *   - **AC-OP4 (T3.3).** `WHERE email IS NOT NULL` — same shape with
 *     `IS NOT NULL`.
 *
 * The lowering shape is verified against the stack-composed Postgres
 * runtime adapter (the helper at `packages/3-targets/6-adapters/
 * postgres/test/helpers/composed-adapter.ts` reproduced inline so
 * cipherstash does not pick up a postgres-package test export
 * dependency) loaded with the cipherstash runtime descriptor. The
 * adapter's `lower` is what the runtime's encode pipeline calls before
 * driver execution; pinning its output is the strongest unit-level
 * assurance available without standing up a real Postgres + EQL bundle
 * (M3 R2).
 *
 * Why we do not exercise the bulk-encrypt middleware here. The
 * middleware reads `params.entries()` and stamps ciphertexts via
 * `replaceValues` — a concern of the runtime's `beforeExecute` chain,
 * not of the AST → SQL lowering. The middleware's contract is covered
 * exhaustively by `bulk-encrypt-middleware.test.ts` (T2.4 / AC-MW1..5)
 * and the SDK-call-counter assertion of `storage-roundtrip.e2e.
 * integration.test.ts` (T2.8 / AC-MW1 amortization). These snapshot
 * tests assert only that the SQL shape produced by lowering would be a
 * valid input to that middleware (a `ParamRef` carrying an
 * `EncryptedString` envelope tagged with the cipherstash codec id).
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
import { CIPHERSTASH_STRING_CODEC_ID, EQL_V2_ENCRYPTED_TYPE } from '../src/core/constants';
import { EncryptedString, getInternalHandle } from '../src/core/envelope';
import { cipherstashQueryOperations } from '../src/core/operators';
import type { CipherstashSdk } from '../src/core/sdk';
import { createCipherstashRuntimeDescriptor } from '../src/exports/runtime';

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

const cipherstashOperatorsByMethod = new Map(
  cipherstashQueryOperations().map((op) => [op.method, op] as const),
);

function getOperator(method: string): SqlOperationDescriptor {
  const op = cipherstashOperatorsByMethod.get(method);
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
function columnAccessor(table: string, column: string) {
  const ref = ColumnRef.of(table, column);
  return {
    returnType: { codecId: CIPHERSTASH_STRING_CODEC_ID, nullable: true },
    buildAst: () => ref,
  };
}

function selectWithWhere(whereExpr: AnyExpression) {
  return SelectAst.from(TableSource.named(TABLE))
    .withProjection([ProjectionItem.of('id', ColumnRef.of(TABLE, 'id'))])
    .withWhere(whereExpr);
}

describe('cipherstash operator lowering — cipherstashEq (T3.1, AC-OP1)', () => {
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
    const handle = getInternalHandle(envelope as EncryptedString);
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
    const handle = getInternalHandle(userEnvelope);
    expect(handle.table).toBe(TABLE);
    expect(handle.column).toBe(COLUMN);
  });
});

describe('cipherstash operator lowering — cipherstashIlike (T3.2, AC-OP2)', () => {
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
    const handle = getInternalHandle(envelope as EncryptedString);
    expect(handle.plaintext).toBe('%alice%');
    expect(handle.table).toBe(TABLE);
    expect(handle.column).toBe(COLUMN);
  });
});

describe('cipherstash operator lowering — null short-circuit (T3.3, AC-OP3 / AC-OP4)', () => {
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

describe('createCipherstashRuntimeDescriptor — queryOperations registration', () => {
  it('exposes cipherstashEq + cipherstashIlike via the runtime descriptor (M3 R1 wiring)', () => {
    // Names are cipherstash-prefixed so they coexist with the
    // framework`s built-in `eq` / `ilike` registrations rather than
    // overriding them. The trade-off is documented in
    // `src/core/operators.ts`'s top-level docblock.
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const ops = descriptor.queryOperations?.() ?? [];
    const methods = ops.map((op) => op.method).sort();
    expect(methods).toEqual(['cipherstashEq', 'cipherstashIlike']);
    for (const op of ops) {
      expect(op.self).toEqual({ codecId: CIPHERSTASH_STRING_CODEC_ID });
    }
  });
});
