/**
 * Cipherstash query-operations registry — M3 R1 (T3.1 / T3.2).
 *
 * `cipherstashEq` and `cipherstashIlike` lower to EQL's encrypted-aware
 * comparison functions (`eql_v2.eq`, `eql_v2.ilike`) on
 * `cipherstash/string@1`-typed columns. The lowering shape mirrors the
 * canonical templates in the reference Prisma integration at
 * `reference/cipherstash/stack/packages/stack/src/prisma/core/
 * operation-templates.ts`:
 *
 *     eql_v2.eq(<self>, <encrypted-arg>)
 *     eql_v2.ilike(<self>, <encrypted-arg>)
 *
 * Why we diverge from Postgres' native `=` / `ILIKE` operators: EQL
 * ciphers contain randomized nonces, so two encrypts of the same
 * plaintext do not byte-equal under SQL `=`. EQL's `eql_v2.eq` /
 * `eql_v2.ilike` short-circuit through the per-column index
 * (`unique` / `match`) emitted by the codec lifecycle hook (T2.9) and
 * produce correct results.
 *
 * **Why unique method names (`cipherstashEq`, `cipherstashIlike`)
 * rather than overriding the framework`s `eq` / `ilike`.** The
 * framework`s `OperationRegistry` is a flat method-keyed map and the
 * project decision is to disallow same-method registrations across
 * extensions (we don`t allow operator overriding). Cipherstash
 * therefore registers under names that don`t collide with any
 * framework- or adapter-shipped operator. User-facing call shape on a
 * cipherstash column is:
 *
 *     model.users.where((u) => u.email.cipherstashEq('alice@example.com'))
 *     model.users.where((u) => u.email.cipherstashIlike('%alice%'))
 *
 * Calling the framework`s built-in `email.eq(...)` on a cipherstash
 * column would produce standard SQL `=` against an `eql_v2_encrypted`
 * value — wrong, because EQL ciphers contain randomized nonces and do
 * not byte-equal under `=`. Two follow-ups remain orchestrator
 * decisions and are deliberately NOT addressed here:
 *
 *   1. Whether to surface the wrong-SQL footgun loudly by stripping
 *      the `equality` codec trait so `email.eq` is undefined on
 *      cipherstash columns. The cipherstash codec currently declares
 *      `traits: ['equality']` in `parameterized.ts:53` /
 *      `codec-runtime.ts:41` / `codec-metadata.ts:25`, which is what
 *      makes the framework`s built-in `eq` reachable on cipherstash
 *      columns.
 *
 *   2. Whether to add a per-codec where-binding rewrite SPI so the
 *      spec`s user-facing API (`model.users.where((u) => u.email.eq(...))`
 *      producing the correct EQL SQL) becomes deliverable without
 *      method-name collisions. The natural seam is
 *      `packages/3-extensions/sql-orm-client/src/where-binding.ts`'s
 *      `binary` visitor at line 60-65, which already binds `BinaryExpr`
 *      using the left column`s metadata; rewriting `BinaryExpr eq` →
 *      `OperationExpr eql_v2.eq` for cipherstash columns would close
 *      the gap, but it`s a new framework SPI and out of scope for
 *      M3 R1.
 *
 * The encrypted-arg path: the operator wraps the user-supplied value
 * in an `EncryptedString` envelope and stamps the column`s
 * `(table, column)` routing context onto the envelope`s handle. The
 * bulk-encrypt middleware (M2 R3) then groups the envelope alongside
 * any others targeting the same `(table, column)` and issues one
 * `sdk.bulkEncrypt` per group. The cipherstash codec encodes the
 * resulting ciphertext as the wire payload at
 * `eql_v2_encrypted` cast time. Stamping at lowering time is the
 * load-bearing step — the middleware`s AST walk only handles
 * `InsertAst` / `UpdateAst` (see
 * `src/middleware/bulk-encrypt.ts:stampRoutingKeysFromAst`); SELECT
 * envelopes have to arrive at the middleware already routing-keyed.
 *
 * Build-time return type is the postgres `pg/bool@1` codec — that`s
 * the codec the framework`s predicate machinery looks at via the
 * `'boolean'` trait to decide that the operator`s return value is a
 * predicate suitable for a WHERE clause (see
 * `packages/3-extensions/sql-orm-client/src/model-accessor.ts:172-178`).
 *
 * **`isNull` / `isNotNull` are NOT registered here** (T3.3 / AC-OP3 /
 * AC-OP4). The framework`s always-on `isNull` / `isNotNull`
 * comparison methods construct `NullCheckExpr` directly, bypassing
 * the operator-registry dispatch, and lower to `<col> IS [NOT] NULL`
 * regardless of codec — pinned by `test/operator-lowering.test.ts`.
 */

import type { SqlOperationDescriptor } from '@prisma-next/sql-operations';
import { type AnyExpression, type ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
import {
  buildOperation,
  type Expression,
  type ScopeField,
  toExpr,
} from '@prisma-next/sql-relational-core/expression';
import { CIPHERSTASH_STRING_CODEC_ID } from './constants';
import { EncryptedString, setHandleRoutingKey } from './envelope';

/**
 * Codec ID of the framework's Postgres boolean codec. Referenced as a
 * string (rather than imported from `@prisma-next/target-postgres`)
 * so cipherstash does not pick up a peer-dep on the target package
 * just to identify a return-codec id. Mirrors the same pattern in the
 * reference cipherstash integration's `operation-templates.ts:RETURN_BOOL`.
 */
const PG_BOOL_CODEC_ID = 'pg/bool@1' as const;

type PgBoolReturn = { readonly codecId: typeof PG_BOOL_CODEC_ID; readonly nullable: false };

/**
 * Convert a user-supplied value (raw string plaintext or an existing
 * `EncryptedString` envelope) into a `ParamRef` carrying an envelope
 * tagged with the cipherstash storage codec id. The envelope's handle
 * is stamped with the column's `(table, column)` routing context so
 * the bulk-encrypt middleware can group it for SELECT-side bulk
 * encryption (the middleware's AST walk only stamps for INSERT /
 * UPDATE).
 *
 * Already-stamped envelopes are preserved write-once-wins per
 * `setHandleRoutingKey`'s contract.
 */
function asEncryptedParam(selfAst: AnyExpression, value: unknown): ParamRef {
  const envelope = coerceToEnvelope(value);
  const columnRef = extractColumnRef(selfAst);
  if (columnRef !== undefined) {
    setHandleRoutingKey(envelope, columnRef.table, columnRef.column);
  }
  return ParamRef.of(envelope, { codecId: CIPHERSTASH_STRING_CODEC_ID });
}

function coerceToEnvelope(value: unknown): EncryptedString {
  if (value instanceof EncryptedString) {
    return value;
  }
  if (typeof value === 'string') {
    return EncryptedString.from(value);
  }
  throw new TypeError(
    'cipherstash operator: expected a string plaintext or an EncryptedString envelope, ' +
      `got ${value === null ? 'null' : typeof value}. ` +
      'Use `EncryptedString.from(plaintext)` to construct an envelope explicitly, or ' +
      'pass the plaintext directly and let the operator wrap it.',
  );
}

/**
 * Find the column reference inside a `self` expression so the operator
 * can stamp its `(table, column)` onto the encrypted-param envelope.
 *
 * Most calls flow through the ORM model-accessor, where `self` is a
 * column-field accessor whose `buildAst()` returns a `ColumnRef`
 * directly. For more complex `self` expressions (e.g. wrapped in a
 * function call) we fall back to the `baseColumnRef()` inherited from
 * `Expression` — every standard AST node walks down to the underlying
 * column. If no column is reachable (e.g. a literal `self`), routing
 * stamping is skipped; the envelope will surface the
 * "envelope reached the bulk-encrypt phase without a (table, column)
 * routing context" diagnostic from `collectTargets` at execute time.
 */
function extractColumnRef(selfAst: AnyExpression): ColumnRef | undefined {
  if (selfAst.kind === 'column-ref') {
    return selfAst;
  }
  try {
    return selfAst.baseColumnRef();
  } catch {
    return undefined;
  }
}

/**
 * Build a cipherstash operator descriptor.
 *
 * @param publicMethod - The user-facing method name on the column
 *   accessor (e.g. `cipherstashEq`). Must not collide with any
 *   framework- or adapter-shipped method name.
 * @param eqlFunction - The EQL function to lower to (`eq`, `ilike`).
 *   Embedded into the SQL lowering template as `eql_v2.<eqlFunction>(...)`.
 */
function eqlOperator(publicMethod: string, eqlFunction: 'eq' | 'ilike'): SqlOperationDescriptor {
  return {
    method: publicMethod,
    self: { codecId: CIPHERSTASH_STRING_CODEC_ID },
    impl: (self: Expression<ScopeField>, value: unknown): Expression<PgBoolReturn> => {
      const selfAst = toExpr(self);
      return buildOperation({
        method: publicMethod,
        args: [selfAst, asEncryptedParam(selfAst, value)],
        returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: `eql_v2.${eqlFunction}({{self}}, {{arg0}})`,
        },
      });
    },
  };
}

/**
 * Cipherstash`s query-operations contributions. Wired into the
 * runtime descriptor by `createCipherstashRuntimeDescriptor` and read
 * by the SQL runtime`s `extractCodecLookup` / `queryOperations`
 * aggregation (`packages/2-sql/5-runtime/src/sql-context.ts`). Two
 * descriptors today, one per AC:
 *
 *   - `cipherstashEq` (AC-OP1) — encrypted equality via EQL`s
 *     `unique` index. SQL: `eql_v2.eq("col", $1::eql_v2_encrypted)`.
 *   - `cipherstashIlike` (AC-OP2) — encrypted free-text match via
 *     EQL`s `match` index. SQL:
 *     `eql_v2.ilike("col", $1::eql_v2_encrypted)`.
 *
 * Both descriptors register `self: { codecId: 'cipherstash/string@1' }`
 * so the model accessor only attaches them to columns whose codec id
 * is exactly `cipherstash/string@1`. The method names are
 * intentionally cipherstash-prefixed so they coexist with the
 * framework`s `eq` / `ilike` registrations rather than overriding
 * them — see the `Why unique method names` section in this file`s
 * top-level docblock.
 */
export function cipherstashQueryOperations(): readonly SqlOperationDescriptor[] {
  return [eqlOperator('cipherstashEq', 'eq'), eqlOperator('cipherstashIlike', 'ilike')];
}
