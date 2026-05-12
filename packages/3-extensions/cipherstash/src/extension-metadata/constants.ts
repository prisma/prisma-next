/**
 * Static names and identifiers used across CipherStash's contract space.
 *
 * Centralising the strings here so:
 *   - the contract IR (`./contract`), the migration ops (`./migrations`),
 *     the head ref (`./head-ref`), and the descriptor (`../exports/control`)
 *     all reference the same values without typos;
 *   - the `cipherstash:*` invariantId namespace is locked in one place
 *     (once published, an invariantId cannot be renamed).
 *
 * The space identifier `'cipherstash'` is what the framework writes to
 * the consuming app's `migrations/cipherstash/` directory and what the marker table's
 * `space` column carries for CipherStash-owned rows.
 */

export const CIPHERSTASH_SPACE_ID = 'cipherstash';

/**
 * Version advertised by both `cipherstashPackMeta.version` (control plane)
 * and the SDK-bound `SqlRuntimeExtensionDescriptor` (runtime plane).
 *
 * Single source of truth so the descriptor surfaces and the contract-emit
 * pack metadata cannot drift apart; consumed downstream by capability
 * gating and contract round-trips.
 */
export const CIPHERSTASH_EXTENSION_VERSION = '0.0.1' as const;

/**
 * Codec id the application-side `Encrypted<string>` lowering targets.
 * Lives here so the codec lifecycle hook (which emits
 * `add_search_config` / `remove_search_config` ops on field events) and
 * the descriptor's `controlPlaneHooks` wiring share the same constant.
 */
export const CIPHERSTASH_STRING_CODEC_ID = 'cipherstash/string@1';

/**
 * Codec id for the `cipherstash/double@1` codec — IEEE-754 double
 * plaintext (`number`) lowering to `eql_v2_encrypted` with EQL
 * `cast_as = 'double'`. See spec D2 for the codec id naming rationale.
 */
export const CIPHERSTASH_DOUBLE_CODEC_ID = 'cipherstash/double@1';

/**
 * Codec id for the `cipherstash/bigint@1` codec — JS `bigint`
 * plaintext lowering to `eql_v2_encrypted` with EQL
 * `cast_as = 'big_int'`. See spec D2.
 */
export const CIPHERSTASH_BIGINT_CODEC_ID = 'cipherstash/bigint@1';

/**
 * Codec id for the `cipherstash/date@1` codec — `Date` plaintext
 * (calendar date) lowering to `eql_v2_encrypted` with EQL
 * `cast_as = 'date'`. See spec D2.
 */
export const CIPHERSTASH_DATE_CODEC_ID = 'cipherstash/date@1';

/**
 * Codec id for the `cipherstash/boolean@1` codec — `boolean`
 * plaintext lowering to `eql_v2_encrypted` with EQL
 * `cast_as = 'boolean'`. See spec D2.
 */
export const CIPHERSTASH_BOOLEAN_CODEC_ID = 'cipherstash/boolean@1';

/**
 * Codec id for the `cipherstash/json@1` codec — JSON-serialisable
 * `unknown` plaintext lowering to `eql_v2_encrypted` with EQL
 * `cast_as = 'jsonb'`. See spec D2.
 */
export const CIPHERSTASH_JSON_CODEC_ID = 'cipherstash/json@1';

/**
 * The closed set of every codec id this package owns. Single source of
 * truth for the bulk-encrypt middleware filter and any other call site
 * that needs "is this a cipherstash codec id?" — using a closed set
 * (rather than a `cipherstash/` prefix match) means the middleware
 * never accidentally claims jurisdiction over a future cipherstash
 * codec that hasn't been wired through the rest of the package yet
 * (envelope subclass, codec hook, runtime descriptor, etc.). When a
 * new codec is introduced its id lands here in the same diff that
 * wires the rest of its surface; out-of-package consumers (e.g. tests
 * pinning the closed set) catch a missed wiring with one assertion.
 *
 * Order mirrors `createParameterizedCodecDescriptors`'s descriptor
 * list so an iteration here matches the iteration there cell-for-cell.
 */
export const CIPHERSTASH_CODEC_IDS = [
  CIPHERSTASH_STRING_CODEC_ID,
  CIPHERSTASH_DOUBLE_CODEC_ID,
  CIPHERSTASH_BIGINT_CODEC_ID,
  CIPHERSTASH_DATE_CODEC_ID,
  CIPHERSTASH_BOOLEAN_CODEC_ID,
  CIPHERSTASH_JSON_CODEC_ID,
] as const;

/**
 * Set form of {@link CIPHERSTASH_CODEC_IDS} for `O(1)` membership
 * tests (the bulk-encrypt middleware's hot per-`ParamRef` filter).
 */
export const CIPHERSTASH_CODEC_ID_SET: ReadonlySet<string> = new Set(CIPHERSTASH_CODEC_IDS);

/**
 * Cipherstash-namespaced codec traits. Used as the dispatch key for
 * the multi-codec predicate operators in `src/execution/operators.ts`
 * — operators register with `self: { traits: ['cipherstash:<x>'] }`
 * and the model accessor (`packages/3-extensions/sql-orm-client/src/
 * model-accessor.ts`) attaches the operator to every codec descriptor
 * whose `traits` list contains the same trait identifier.
 *
 * The `cipherstash:` prefix is load-bearing — it isolates these
 * traits from the framework's built-in trait surface (`'equality'`,
 * `'orderable'`, `'numeric'`, `'boolean'`, ...) so adding them to a
 * cipherstash codec does not silently re-enable a built-in operator
 * (e.g. `equality` would re-attach the framework's `eq` which lowers
 * to standard SQL `=` — wrong for EQL ciphers, see
 * `equality-trait-removal.test.ts`). The cipherstash extension owns
 * its namespace; collisions with a future framework trait are not
 * possible.
 *
 * Per spec D7, codec ↔ trait mapping:
 *
 *   - `cipherstash:equality`         — string, double, bigint, date, boolean
 *   - `cipherstash:order-and-range`  — string, double, bigint, date
 *   - `cipherstash:free-text-search` — string
 *   - `cipherstash:searchable-json`  — json
 *
 * Each predicate operator registers under exactly one of these
 * traits; the codec ↔ operator visibility surface follows from the
 * trait set declared on each codec descriptor.
 */
export const CIPHERSTASH_TRAIT_EQUALITY = 'cipherstash:equality' as const;
export const CIPHERSTASH_TRAIT_ORDER_AND_RANGE = 'cipherstash:order-and-range' as const;
export const CIPHERSTASH_TRAIT_FREE_TEXT_SEARCH = 'cipherstash:free-text-search' as const;
export const CIPHERSTASH_TRAIT_SEARCHABLE_JSON = 'cipherstash:searchable-json' as const;

/**
 * Per-codec trait sets keyed by codec id. Each codec descriptor in
 * `parameterized.ts` / `codec-runtime.ts` / `codec-metadata.ts` reads
 * the traits for its codec id from this map; the
 * `equality-trait-removal.test.ts` regression also reads from here so
 * the three trait declarations (runtime / parameterized / pack-meta)
 * stay agreement-by-construction.
 */
// Local re-alias of the framework's `CodecTrait` union, used solely as
// the cast target below. Type-only import — adds no runtime
// dependency.
type FrameworkCodecTrait = import('@prisma-next/framework-components/codec').CodecTrait;

const CIPHERSTASH_CODEC_TRAITS_RAW: Readonly<Record<string, readonly string[]>> = {
  [CIPHERSTASH_STRING_CODEC_ID]: [
    CIPHERSTASH_TRAIT_EQUALITY,
    CIPHERSTASH_TRAIT_FREE_TEXT_SEARCH,
    CIPHERSTASH_TRAIT_ORDER_AND_RANGE,
  ],
  [CIPHERSTASH_DOUBLE_CODEC_ID]: [CIPHERSTASH_TRAIT_EQUALITY, CIPHERSTASH_TRAIT_ORDER_AND_RANGE],
  [CIPHERSTASH_BIGINT_CODEC_ID]: [CIPHERSTASH_TRAIT_EQUALITY, CIPHERSTASH_TRAIT_ORDER_AND_RANGE],
  [CIPHERSTASH_DATE_CODEC_ID]: [CIPHERSTASH_TRAIT_EQUALITY, CIPHERSTASH_TRAIT_ORDER_AND_RANGE],
  [CIPHERSTASH_BOOLEAN_CODEC_ID]: [CIPHERSTASH_TRAIT_EQUALITY],
  [CIPHERSTASH_JSON_CODEC_ID]: [CIPHERSTASH_TRAIT_SEARCHABLE_JSON],
};

// `CodecDescriptor.traits` is typed `readonly CodecTrait[]` where
// `CodecTrait` is a closed union of framework built-ins
// (`'equality' | 'order' | 'boolean' | 'numeric' | 'textual'`). The
// cipherstash trait strings live in the extension-private
// `cipherstash:` namespace and are intentionally not part of that
// union — they sit in their own namespace so adding them here cannot
// silently re-attach a framework built-in (e.g. `'equality'` would
// re-attach the wrong-SQL `eq` footgun, see
// `equality-trait-removal.test.ts`). The model-accessor's trait
// dispatch widens `descriptor.traits` to `readonly string[]` before
// the membership check (`packages/3-extensions/sql-orm-client/src/
// model-accessor.ts:74-80`), so the extension-namespaced strings
// round-trip through the registry unchanged at runtime; the cast
// here is purely a type-level adapter from an extension namespace
// into the framework union. AGENTS.md requires the rationale comment
// alongside any `as unknown as` cast.
export const CIPHERSTASH_CODEC_TRAITS = CIPHERSTASH_CODEC_TRAITS_RAW as unknown as Readonly<
  Record<string, readonly FrameworkCodecTrait[]>
>;

/** Schema CipherStash installs its functions/operators/casts/types into. */
export const EQL_V2_SCHEMA = 'eql_v2';

/** Configuration table used by EQL's per-column index configuration. */
export const EQL_V2_CONFIGURATION_TABLE = 'eql_v2_configuration';

/** Enum type backing the `state` column on `eql_v2_configuration`. */
export const EQL_V2_CONFIGURATION_STATE_TYPE = 'eql_v2_configuration_state';

/** JSONB-domain composite type user `Encrypted<string>` columns reference. */
export const EQL_V2_ENCRYPTED_TYPE = 'eql_v2_encrypted';

/**
 * Migration directory name for the baseline.
 *
 * Per the framework's per-space layout convention this name is
 * preserved verbatim when the framework writes the package to
 * `migrations/cipherstash/<this-name>/` in the user's repo.
 */
export const CIPHERSTASH_BASELINE_MIGRATION_NAME = '20260601T0000_install_eql_bundle';

/**
 * `cipherstash:*` invariantIds emitted by the baseline migration. Each
 * `cipherstash:*` id, once published, is immutable: downstream
 * consumers (other extensions, the marker table) reference them by
 * literal string match.
 *
 * Today the baseline emits a single op (`installBundle`); the bundle
 * SQL is the source of truth for every typed object it creates inside
 * the `eql_v2` schema. New bundle versions or additional structural
 * ops will mint new `cipherstash:*` ids alongside this entry.
 */
export const CIPHERSTASH_INVARIANTS = {
  installBundle: 'cipherstash:install-eql-bundle-v1',
} as const;
