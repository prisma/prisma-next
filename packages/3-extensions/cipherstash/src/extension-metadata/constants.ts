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
 * The baseline emits one substantive op (`installBundle`, carrying the
 * vendored EQL bundle SQL) plus a structural verification op per typed
 * object the bundle creates inside the `eql_v2` schema. The structural
 * ops carry a postcheck that probes `pg_type` / `pg_class` for the
 * corresponding object and an empty `execute` step — the bundle SQL
 * already created the object, so the structural op exists purely to
 * (a) verify the bundle did so and (b) register the structural
 * invariantId on the marker. This keeps `applied_invariants` on the
 * marker structurally aligned with the typed objects the IR will
 * eventually represent directly once the vocabulary expands to
 * first-class composite types, standalone enums, and domains.
 */
export const CIPHERSTASH_INVARIANTS = {
  installBundle: 'cipherstash:install-eql-bundle-v1',
  createBlake3: 'cipherstash:create-eql_v2_blake3-v1',
  createBloomFilter: 'cipherstash:create-eql_v2_bloom_filter-v1',
  createConfiguration: 'cipherstash:create-eql_v2_configuration-v1',
  createConfigurationState: 'cipherstash:create-eql_v2_configuration_state-v1',
  createEncrypted: 'cipherstash:create-eql_v2_encrypted-v1',
  createHmac256: 'cipherstash:create-eql_v2_hmac_256-v1',
  createOreBlockU64_8_256: 'cipherstash:create-eql_v2_ore_block_u64_8_256-v1',
  createOreBlockU64_8_256Term: 'cipherstash:create-eql_v2_ore_block_u64_8_256_term-v1',
  createOreCllwU64_8: 'cipherstash:create-eql_v2_ore_cllw_u64_8-v1',
  createOreCllwVar8: 'cipherstash:create-eql_v2_ore_cllw_var_8-v1',
} as const;
