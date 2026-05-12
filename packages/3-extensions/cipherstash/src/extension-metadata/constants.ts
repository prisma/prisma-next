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
