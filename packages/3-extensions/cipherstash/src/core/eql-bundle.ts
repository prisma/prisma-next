/**
 * Vendored CipherStash EQL bundle SQL.
 *
 * The CipherStash team ships the bundle as a single Postgres script
 * (~5,750 lines) that creates the `eql_v2` schema, the `eql_v2_*`
 * composite types / domains, the `eql_v2_configuration` table, plus
 * roughly 169 functions, 46 operators, 4 casts, and 9 operator classes /
 * families. CipherStash treats the bundle as one indivisible artefact;
 * its contents must flow into the `cipherstash:install-eql-bundle-v1`
 * migration op **byte-for-byte** with no fork or split.
 *
 * The bundle source lives in {@link ./eql-install.generated} — a single
 * committed `.generated.ts` file produced by vendoring tooling. This
 * module re-exports it as `EQL_BUNDLE_SQL` so the rest of the cipherstash
 * package imports a stable identifier regardless of which bundle version
 * is active.
 *
 * Hash impact: the bundle string lives inside the `installEqlBundle`
 * migration op's `execute[]`, **not** in `contract.json` — so swapping
 * the bundle changes `migrationHash` (consumed by the runner at apply
 * time) but leaves `headRef.hash` (which only digests the contract IR)
 * untouched.
 */
export { EQL_INSTALL_SQL as EQL_BUNDLE_SQL, EQL_INSTALL_VERSION } from './eql-install.generated';
