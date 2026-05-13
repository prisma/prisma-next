/**
 * Cipherstash query-operations registry.
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
 * (`unique` / `match`) emitted by the codec lifecycle hook and produce
 * correct results.
 *
 * **Why cipherstash-namespaced method names (`cipherstashEq`,
 * `cipherstashIlike`) rather than reusing the framework`s `eq` /
 * `ilike`.** The framework`s `OperationRegistry` is a flat method-keyed
 * map and operator overriding is disallowed by project decision. Equally
 * importantly, cipherstash`s search operators are semantically distinct
 * from the framework built-ins — they take encrypted-aware envelope
 * arguments and lower to `eql_v2.eq` / `eql_v2.ilike`, which short-
 * circuit through EQL`s per-column index — so they belong under a
 * cipherstash-prefixed surface that flags the divergence at the call
 * site. The supported user-facing call shape on a cipherstash column is:
 *
 *     model.users.where((u) => u.email.cipherstashEq('alice@example.com'))
 *     model.users.where((u) => u.email.cipherstashIlike('%alice%'))
 *
 * The framework`s built-in `email.eq(...)` is **not reachable** on
 * cipherstash columns: the cipherstash codec declares no `equality`
 * trait (see `codec-runtime.ts` / `codec-metadata.ts` / `parameterized.ts`),
 * and the model-accessor synthesis in `sql-orm-client` gates
 * `COMPARISON_METHODS_META.eq` on the `equality` trait being present in
 * the column codec`s trait set. Calling `email.eq(...)` on a cipherstash
 * column is therefore `undefined` — the wrong-SQL footgun (where the
 * built-in `eq` would lower to standard SQL `=` against an
 * `eql_v2_encrypted` value, silently returning zero rows because EQL
 * ciphers contain randomized nonces) is closed at the codec layer, not
 * the operator layer. The trait declaration is regression-pinned by
 * `test/equality-trait-removal.test.ts`.
 *
 * The encrypted-arg path: the operator wraps the user-supplied value
 * in an `EncryptedString` envelope and stamps the column`s
 * `(table, column)` routing context onto the envelope`s handle. The
 * bulk-encrypt middleware then groups the envelope alongside
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
 * **`isNull` / `isNotNull` are NOT registered here.** The framework`s
 * always-on `isNull` / `isNotNull` comparison methods construct
 * `NullCheckExpr` directly, bypassing
 * the operator-registry dispatch, and lower to `<col> IS [NOT] NULL`
 * regardless of codec — pinned by `test/operator-lowering.test.ts`.
 */

import type { CodecTrait } from '@prisma-next/framework-components/codec';
import type { SqlOperationDescriptor, SqlOperationDescriptors } from '@prisma-next/sql-operations';
import type { CodecRef } from '@prisma-next/sql-relational-core/ast';
import { type AnyExpression, type ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
import {
  buildOperation,
  codecOf,
  type Expression,
  type ScopeField,
  toExpr,
} from '@prisma-next/sql-relational-core/expression';
import {
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
  CIPHERSTASH_STRING_CODEC_ID,
  CIPHERSTASH_TRAIT_EQUALITY,
  CIPHERSTASH_TRAIT_FREE_TEXT_SEARCH,
  CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
  CIPHERSTASH_TRAIT_SEARCHABLE_JSON,
  type CipherstashCodecId,
  isCipherstashCodecId,
} from '../extension-metadata/constants';
import type { EncryptedEnvelopeBase } from './envelope-base';
import { EncryptedBigInt } from './envelope-bigint';
import { EncryptedBoolean } from './envelope-boolean';
import { EncryptedDate } from './envelope-date';
import { EncryptedDouble } from './envelope-double';
import { EncryptedJson } from './envelope-json';
import { EncryptedString, setHandleRoutingKey } from './envelope-string';

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
 * Convert a user-supplied value (raw plaintext or an existing
 * `Encrypted*` envelope) into a `ParamRef` carrying an envelope
 * tagged with the column's cipherstash storage codec ref. The
 * envelope's handle is stamped with the column's `(table, column)`
 * routing context so the bulk-encrypt middleware can group it for
 * SELECT-side bulk encryption (the middleware's AST walk only stamps
 * for INSERT / UPDATE).
 *
 * Already-stamped envelopes are preserved write-once-wins per
 * `setHandleRoutingKey`'s contract.
 *
 * The `selfCodec` argument is the full {@link CodecRef} (codecId +
 * typeParams) derived from the `self` expression via {@link codecOf}.
 * Forwarding the complete ref — not just the codecId — keeps the
 * resulting `ParamRef` aligned with the AST-bound codec resolution
 * model introduced in TML-2456: `forCodecRef` validates `typeParams`
 * against the codec's `paramsSchema`, and parameterized cipherstash
 * codecs (`cipherstash/string@1`, `cipherstash/double@1`, ...)
 * require their search-index `typeParams` (`equality`,
 * `freeTextSearch`, `orderAndRange`) to be present.
 */
function asEncryptedParam(selfAst: AnyExpression, selfCodec: CodecRef, value: unknown): ParamRef {
  const envelope = coerceToEnvelope(selfCodec.codecId, value);
  const columnRef = extractColumnRef(selfAst);
  if (columnRef !== undefined) {
    setHandleRoutingKey(envelope, columnRef.table, columnRef.column);
  }
  return ParamRef.of(envelope, { codec: selfCodec });
}

/**
 * Read the column-bound {@link CodecRef} off the `self` expression.
 * Cipherstash predicate operators are reachable only via the ORM's
 * model-accessor path, which stamps the column's full CodecRef onto
 * the field-proxy's `codec` slot at synthesis time. If the ref is
 * missing the operator was reached without a column binding (likely
 * a programming error in a custom builder); throw with a stable
 * runtime envelope so the failure mode is loud.
 */
function requireSelfCodec(self: Expression<ScopeField>, publicMethod: string): CodecRef {
  const codec = codecOf(self);
  if (codec === undefined) {
    throw new TypeError(
      `cipherstash ${publicMethod}: self expression is missing a CodecRef. ` +
        'Cipherstash predicate operators require a column-bound self argument; ' +
        'reach the operator through the ORM model-accessor (e.g. `model.users.where((u) => u.email.cipherstashEq(...))`).',
    );
  }
  return codec;
}

/**
 * Coerce a user-supplied value into the envelope subclass appropriate
 * for the column's codec id. Each cipherstash column type has its own
 * concrete envelope subclass with a typed `from(plaintext)` factory;
 * this dispatcher matches the column codec id to the right subclass
 * and wraps the user value, while passing already-constructed
 * envelopes through unchanged. The error message lists the expected
 * plaintext type per codec so a user passing the wrong shape gets a
 * specific diagnostic at the call site.
 *
 * Dispatch is via a `Record<CipherstashCodecId, ...>` map so adding
 * a new cipherstash codec id (which extends the closed
 * {@link CipherstashCodecId} union) becomes a compile-time error
 * here until the new branch is wired — closing off the runtime-only
 * failure mode the previous if-chain shape tolerated.
 */
type EnvelopeCoercer = (value: unknown) => EncryptedEnvelopeBase<unknown>;

const ENVELOPE_COERCERS: Readonly<Record<CipherstashCodecId, EnvelopeCoercer>> = {
  [CIPHERSTASH_STRING_CODEC_ID]: (value) => {
    if (value instanceof EncryptedString) return value;
    if (typeof value === 'string') return EncryptedString.from(value);
    throw envelopeTypeError('EncryptedString', 'string', value);
  },
  [CIPHERSTASH_DOUBLE_CODEC_ID]: (value) => {
    if (value instanceof EncryptedDouble) return value;
    if (typeof value === 'number') return EncryptedDouble.from(value);
    throw envelopeTypeError('EncryptedDouble', 'number', value);
  },
  [CIPHERSTASH_BIGINT_CODEC_ID]: (value) => {
    if (value instanceof EncryptedBigInt) return value;
    if (typeof value === 'bigint') return EncryptedBigInt.from(value);
    throw envelopeTypeError('EncryptedBigInt', 'bigint', value);
  },
  [CIPHERSTASH_DATE_CODEC_ID]: (value) => {
    if (value instanceof EncryptedDate) return value;
    if (value instanceof Date) return EncryptedDate.from(value);
    throw envelopeTypeError('EncryptedDate', 'Date', value);
  },
  [CIPHERSTASH_BOOLEAN_CODEC_ID]: (value) => {
    if (value instanceof EncryptedBoolean) return value;
    if (typeof value === 'boolean') return EncryptedBoolean.from(value);
    throw envelopeTypeError('EncryptedBoolean', 'boolean', value);
  },
  [CIPHERSTASH_JSON_CODEC_ID]: (value) => {
    if (value instanceof EncryptedJson) return value;
    return EncryptedJson.from(value);
  },
};

function coerceToEnvelope(columnCodecId: string, value: unknown): EncryptedEnvelopeBase<unknown> {
  if (!isCipherstashCodecId(columnCodecId)) {
    throw new Error(
      `cipherstash operator: column codec id "${columnCodecId}" is not a cipherstash codec; ` +
        'this operator should not be reachable on a non-cipherstash column. ' +
        'If you see this error, the operator-registry trait dispatch is wired against a ' +
        'codec that should not advertise the cipherstash trait. File a bug against the package.',
    );
  }
  return ENVELOPE_COERCERS[columnCodecId](value);
}

function envelopeTypeError(envelopeType: string, expected: string, value: unknown): TypeError {
  const got = value === null ? 'null' : value instanceof Date ? 'Date' : typeof value;
  return new TypeError(
    `cipherstash operator: expected a ${expected} plaintext or an ${envelopeType} envelope, ` +
      `got ${got}. ` +
      `Use \`${envelopeType}.from(plaintext)\` to construct an envelope explicitly, or ` +
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
 * Build a single-codec cipherstash operator descriptor — the
 * original shape used by `cipherstashEq` / `cipherstashIlike`,
 * pinned to `cipherstash/string@1`. Multi-codec operators use
 * {@link envelopeOperator} with trait-based dispatch instead.
 *
 * @param publicMethod - The user-facing method name on the column
 *   accessor (e.g. `cipherstashEq`). Must not collide with any
 *   framework- or adapter-shipped method name.
 * @param eqlFunction - The EQL function to lower to (`eq`, `ilike`).
 *   Embedded into the SQL lowering template as `eql_v2.<eqlFunction>(...)`.
 */
function eqlOperator(publicMethod: string, eqlFunction: 'eq' | 'ilike'): SqlOperationDescriptor {
  return {
    self: { codecId: CIPHERSTASH_STRING_CODEC_ID },
    impl: (self: Expression<ScopeField>, value: unknown): Expression<PgBoolReturn> => {
      const selfCodec = requireSelfCodec(self, publicMethod);
      const selfAst = toExpr(self, selfCodec);
      return buildOperation({
        method: publicMethod,
        args: [selfAst, asEncryptedParam(selfAst, selfCodec, value)],
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
 * Build a cipherstash predicate operator dispatched via a
 * cipherstash-namespaced trait — the multi-codec shape used for the
 * trait-namespaced predicate surface (see ADR 214). The operator
 * attaches to every codec descriptor whose `traits` list contains
 * {@link trait}; the model-accessor's trait dispatch
 * (`packages/3-extensions/sql-orm-client/src/model-accessor.ts`)
 * handles the per-codec attachment.
 *
 * Each user-supplied argument is wrapped in the envelope subclass
 * that matches the column's codec id at impl time. The lowering
 * template uses the standard `{{self}}` and `{{argN}}` placeholders
 * that the postgres adapter's `sql-renderer` substitutes per call.
 *
 * @param publicMethod - User-facing method name on the column
 *   accessor (e.g. `cipherstashGt`). Must not collide with any
 *   framework- or adapter-shipped method name.
 * @param trait - Cipherstash-namespaced trait that gates the codec
 *   set the operator attaches to (see `extension-metadata/constants.ts`).
 * @param arity - Fixed user-arg count (1 for `gt`/`gte`/`lt`/`lte`/
 *   `eq`/`ne`/`ilike`/`notIlike`, 2 for `between`/`notBetween`).
 *   Excludes the `self` (column-bound) argument.
 * @param template - Lowering template, e.g. `eql_v2.gt({{self}}, {{arg0}})`
 *   or `NOT eql_v2.eq({{self}}, {{arg0}})`. Stored verbatim on the
 *   `OperationExpr` AST node and substituted by the postgres
 *   adapter at lower time.
 */
function envelopeOperator(
  publicMethod: string,
  trait: string,
  arity: number,
  template: string,
): SqlOperationDescriptor {
  return {
    // Cipherstash trait identifiers (`cipherstash:equality`, ...)
    // intentionally live outside the framework`s closed `CodecTrait`
    // union; the runtime dispatcher widens to `readonly string[]`
    // before matching, so the namespace round-trips unchanged. See
    // `extension-metadata/constants.ts:CIPHERSTASH_CODEC_TRAITS` for
    // the full rationale; AGENTS.md requires the rationale comment
    // alongside any `as unknown as` cast.
    self: { traits: [trait] as unknown as readonly CodecTrait[] },
    impl: (self: Expression<ScopeField>, ...userArgs: unknown[]): Expression<PgBoolReturn> => {
      if (userArgs.length !== arity) {
        throw new TypeError(
          `cipherstash ${publicMethod}: expected ${arity} argument${arity === 1 ? '' : 's'}, got ${userArgs.length}.`,
        );
      }
      const selfCodec = requireSelfCodec(self, publicMethod);
      const selfAst = toExpr(self, selfCodec);
      const argRefs = userArgs.map((value) => asEncryptedParam(selfAst, selfCodec, value));
      return buildOperation({
        method: publicMethod,
        args: [selfAst, ...argRefs],
        returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template,
        },
      });
    },
  };
}

/**
 * Build a cipherstash variable-arity predicate operator — the shape
 * used for `cipherstashInArray` / `cipherstashNotInArray`. Each
 * array element is wrapped in its own envelope sharing the
 * column's `(table, column)` routing key, and the lowering template
 * is built dynamically per call from {@link buildTemplate} based on
 * the array length so the framework's `{{argN}}` placeholder
 * substitution covers every element.
 *
 * Empty arrays are rejected with a descriptive error: an OR-of-zero
 * fragments lowers to a SQL syntax error and a silent rewrite to
 * `FALSE` (or `TRUE` for `notInArray`) would mask the user's likely
 * intent. Callers who want "match nothing" should use
 * `WHERE FALSE` directly; this operator is for non-empty arrays.
 *
 * @param publicMethod - User-facing method name (`cipherstashInArray`,
 *   `cipherstashNotInArray`).
 * @param trait - Cipherstash-namespaced trait that gates codec
 *   visibility (`cipherstash:equality` for both in-array operators).
 * @param buildTemplate - Pure function `(n) => template` that
 *   produces the lowering template for an `n`-element array. For
 *   `cipherstashInArray`: `(n) => "(<OR-of-n eq calls>)"`. For
 *   `cipherstashNotInArray`: `(n) => "NOT (<OR-of-n eq calls>)"`.
 */
function variableArityEnvelopeOperator(
  publicMethod: string,
  trait: string,
  buildTemplate: (arity: number) => string,
): SqlOperationDescriptor {
  return {
    // See `envelopeOperator` for the cast rationale.
    self: { traits: [trait] as unknown as readonly CodecTrait[] },
    impl: (self: Expression<ScopeField>, values: unknown): Expression<PgBoolReturn> => {
      if (!Array.isArray(values)) {
        throw new TypeError(
          `cipherstash ${publicMethod}: expected an array argument, got ${
            values === null ? 'null' : typeof values
          }.`,
        );
      }
      if (values.length === 0) {
        throw new TypeError(
          `cipherstash ${publicMethod}: empty array is not supported. ` +
            'An empty membership check has no well-defined SQL lowering — use ' +
            '`WHERE FALSE` directly if you want to match no rows.',
        );
      }
      const selfCodec = requireSelfCodec(self, publicMethod);
      const selfAst = toExpr(self, selfCodec);
      const argRefs = values.map((value) => asEncryptedParam(selfAst, selfCodec, value));
      return buildOperation({
        method: publicMethod,
        args: [selfAst, ...argRefs],
        returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: buildTemplate(values.length),
        },
      });
    },
  };
}

/**
 * Build the OR-of-equalities lowering template for an `n`-element
 * array: `(eql_v2.eq({{self}}, {{arg0}}) OR eql_v2.eq({{self}}, {{arg1}}) OR ...)`.
 * The single-element form collapses to one `eql_v2.eq` call with
 * outer parentheses retained for shape stability.
 */
function buildInArrayTemplate(n: number): string {
  const terms: string[] = [];
  for (let i = 0; i < n; i++) {
    terms.push(`eql_v2.eq({{self}}, {{arg${i}}})`);
  }
  return `(${terms.join(' OR ')})`;
}

function buildNotInArrayTemplate(n: number): string {
  return `NOT ${buildInArrayTemplate(n)}`;
}

/**
 * Build the cipherstash JSONB-path-exists operator. Unlike the
 * envelope-wrapping operators above, the path argument is a plain
 * SQL text literal — the JSONpath expression is a user-authored
 * static input, not an encrypted value — so this operator passes
 * the path through `toExpr` directly without envelope wrapping. The
 * column self IS encrypted; only the path argument is plain.
 *
 * Note: predicate filtering via this operator is gapped against the
 * live EQL bundle pending STE-VEC selector hashing — see TML-2504.
 * The framework binds the JSONpath as a plain `pg/text@1` `ParamRef`
 * but EQL probes the per-column STE-VEC index for a hashed-selector
 * key. The lowering template + AST construction below are correct;
 * the bundle-side hashing is the missing piece.
 */
function jsonbPathExistsOperator(): SqlOperationDescriptor {
  return {
    // See `envelopeOperator` for the cast rationale.
    self: {
      traits: [CIPHERSTASH_TRAIT_SEARCHABLE_JSON] as unknown as readonly CodecTrait[],
    },
    impl: (self: Expression<ScopeField>, path: unknown): Expression<PgBoolReturn> => {
      if (typeof path !== 'string') {
        throw new TypeError(
          `cipherstash cipherstashJsonbPathExists: expected a string path argument, got ${
            path === null ? 'null' : typeof path
          }.`,
        );
      }
      const selfAst = toExpr(self);
      return buildOperation({
        method: 'cipherstashJsonbPathExists',
        args: [selfAst, ParamRef.of(path, { codec: { codecId: 'pg/text@1' } })],
        returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
        lowering: {
          targetFamily: 'sql',
          strategy: 'function',
          template: 'eql_v2.jsonb_path_exists({{self}}, {{arg0}})',
        },
      });
    },
  };
}

/**
 * Cipherstash`s query-operations contributions. Wired into the
 * runtime descriptor by `createCipherstashRuntimeDescriptor` and read
 * by the SQL runtime`s `extractCodecLookup` / `queryOperations`
 * aggregation (`packages/2-sql/5-runtime/src/sql-context.ts`).
 *
 * Two registration shapes are in use:
 *
 *   - **Single-codec** (`cipherstashEq`, `cipherstashIlike`) —
 *     `self: { codecId: 'cipherstash/string@1' }`. Predates the
 *     trait-namespaced surface; visibility is fixed to the string
 *     codec.
 *   - **Trait-namespaced** (everything else, see ADR 214) —
 *     `self: { traits: ['cipherstash:<x>'] }`. Visible on every
 *     codec descriptor whose `traits` list contains the trait
 *     identifier. The `cipherstash:` prefix isolates these from
 *     the framework`s closed `CodecTrait` union (`'equality'`,
 *     `'order'`, ...) so adding them to a cipherstash codec
 *     descriptor cannot silently re-attach a framework built-in.
 *
 * Operator -> codec visibility:
 *
 *   - `cipherstashEq` (string only — single-codec, legacy)
 *   - `cipherstashIlike` (string only — single-codec, legacy)
 *   - `cipherstashNe` / `cipherstashInArray` /
 *     `cipherstashNotInArray` (trait `cipherstash:equality` ->
 *     string, double, bigint, date, boolean)
 *   - `cipherstashNotIlike` (trait `cipherstash:free-text-search`
 *     -> string)
 *   - `cipherstashGt` / `cipherstashGte` / `cipherstashLt` /
 *     `cipherstashLte` / `cipherstashBetween` /
 *     `cipherstashNotBetween` (trait `cipherstash:order-and-range`
 *     -> string, double, bigint, date)
 *   - `cipherstashJsonbPathExists` (trait
 *     `cipherstash:searchable-json` -> json)
 *
 * The lowering templates mirror the canonical EQL function calls.
 * The variable-arity `inArray` / `notInArray`
 * lowerings build their template per call from the array length
 * (see {@link variableArityEnvelopeOperator}).
 */
export function cipherstashQueryOperations(): SqlOperationDescriptors {
  return {
    cipherstashEq: eqlOperator('cipherstashEq', 'eq'),
    cipherstashIlike: eqlOperator('cipherstashIlike', 'ilike'),
    cipherstashNe: envelopeOperator(
      'cipherstashNe',
      CIPHERSTASH_TRAIT_EQUALITY,
      1,
      'NOT eql_v2.eq({{self}}, {{arg0}})',
    ),
    cipherstashInArray: variableArityEnvelopeOperator(
      'cipherstashInArray',
      CIPHERSTASH_TRAIT_EQUALITY,
      buildInArrayTemplate,
    ),
    cipherstashNotInArray: variableArityEnvelopeOperator(
      'cipherstashNotInArray',
      CIPHERSTASH_TRAIT_EQUALITY,
      buildNotInArrayTemplate,
    ),
    cipherstashNotIlike: envelopeOperator(
      'cipherstashNotIlike',
      CIPHERSTASH_TRAIT_FREE_TEXT_SEARCH,
      1,
      'NOT eql_v2.ilike({{self}}, {{arg0}})',
    ),
    cipherstashGt: envelopeOperator(
      'cipherstashGt',
      CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
      1,
      'eql_v2.gt({{self}}, {{arg0}})',
    ),
    cipherstashGte: envelopeOperator(
      'cipherstashGte',
      CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
      1,
      'eql_v2.gte({{self}}, {{arg0}})',
    ),
    cipherstashLt: envelopeOperator(
      'cipherstashLt',
      CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
      1,
      'eql_v2.lt({{self}}, {{arg0}})',
    ),
    cipherstashLte: envelopeOperator(
      'cipherstashLte',
      CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
      1,
      'eql_v2.lte({{self}}, {{arg0}})',
    ),
    cipherstashBetween: envelopeOperator(
      'cipherstashBetween',
      CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
      2,
      'eql_v2.gte({{self}}, {{arg0}}) AND eql_v2.lte({{self}}, {{arg1}})',
    ),
    cipherstashNotBetween: envelopeOperator(
      'cipherstashNotBetween',
      CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
      2,
      'NOT (eql_v2.gte({{self}}, {{arg0}}) AND eql_v2.lte({{self}}, {{arg1}}))',
    ),
    cipherstashJsonbPathExists: jsonbPathExistsOperator(),
  };
}
