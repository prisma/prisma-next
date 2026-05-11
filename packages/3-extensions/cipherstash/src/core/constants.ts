/**
 * Static names and identifiers used across CipherStash's contract space.
 *
 * Centralising the strings here so:
 *   - the contract IR (`./contract`), the migration ops (`./migrations`),
 *     and the descriptor (`../exports/control`) all reference the same
 *     values without typos;
 *   - the `cipherstash:*` invariantId namespace is locked in one place:
 *     once a `cipherstash:*` invariantId is published it cannot be renamed
 *     without breaking downstream consumers that reference it by string.
 *
 * The space identifier `'cipherstash'` is what the framework writes to
 * `migrations/cipherstash/` in the user's repo and what the marker table's
 * `space` column carries for CipherStash-owned rows.
 */

export const CIPHERSTASH_SPACE_ID = 'cipherstash';

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

/** Domain types EQL exposes (declared under the `eql_v2` schema). */
export const EQL_V2_DOMAIN_TYPES = ['bloom_filter', 'hmac_256', 'blake3'] as const;

/**
 * Composite types backing the various ORE (Order-Revealing Encryption)
 * search-mode payloads, enumerated from the vendored EQL bundle's
 * `CREATE TYPE eql_v2.<name>` statements:
 *
 *   - `ore_block_u64_8_256_term` — single ORE block term (bytea wrapper).
 *   - `ore_block_u64_8_256` — array of ORE block terms; backs `ore` index.
 *   - `ore_cllw_u64_8` — fixed-width Comparable Linear Wide.
 *   - `ore_cllw_var_8` — variable-width Comparable Linear Wide.
 *
 * Subsequent bundle bumps that add ORE shapes must extend this list and
 * mint a new `cipherstash:create-eql_v2_<name>-v1` invariantId via
 * {@link CIPHERSTASH_INVARIANTS.createOreComposite}.
 */
export const EQL_V2_ORE_COMPOSITE_TYPES = [
  'ore_block_u64_8_256_term',
  'ore_block_u64_8_256',
  'ore_cllw_u64_8',
  'ore_cllw_var_8',
] as const;

/**
 * Migration directory name for the baseline.
 *
 * Preserved verbatim when the framework writes the package to
 * `migrations/cipherstash/<this-name>/` in the user's repo.
 */
export const CIPHERSTASH_BASELINE_MIGRATION_NAME = '20260601T0000_install_eql_bundle';

/**
 * `cipherstash:*` invariantIds emitted by the baseline migration. Each
 * id, once published, is immutable: downstream consumers (other extensions,
 * the marker table) reference them by literal string match.
 */
export const CIPHERSTASH_INVARIANTS = {
  installBundle: 'cipherstash:install-eql-bundle-v1',
  createConfiguration: 'cipherstash:create-eql_v2_configuration-v1',
  createConfigurationState: 'cipherstash:create-eql_v2_configuration_state-v1',
  createEncrypted: 'cipherstash:create-eql_v2_encrypted-v1',
  createDomain: (name: (typeof EQL_V2_DOMAIN_TYPES)[number]) =>
    `cipherstash:create-eql_v2_${name}-v1`,
  createOreComposite: (name: (typeof EQL_V2_ORE_COMPOSITE_TYPES)[number]) =>
    `cipherstash:create-eql_v2_${name}-v1`,
} as const;
