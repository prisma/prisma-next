/**
 * Vendored CipherStash EQL bundle SQL.
 *
 * The CipherStash team ships the bundle as a single Postgres script
 * (~5,750 lines, currently `eql-2.2.1`) that creates the `eql_v2`
 * schema, the `eql_v2_*` composite types / domains, the
 * `eql_v2_configuration` table, plus roughly 169 functions, 46
 * operators, 4 casts, and 9 operator classes / families. CipherStash
 * treats the bundle as one indivisible artefact: its contents flow
 * into the `cipherstash:install-eql-bundle-v1` migration op
 * **byte-for-byte** with no fork or split.
 *
 * The bundle source lives in {@link ./eql-install.generated} — a
 * single committed `.generated.ts` file produced by
 * `scripts/vendor-eql-install.ts`. Bumping the bundle version
 * regenerates that file and re-runs
 * `pnpm --filter @prisma-next/extension-cipherstash test` to confirm
 * descriptor self-consistency.
 *
 * Hash impact: the bundle string lives inside the `installEqlBundle`
 * migration op's `execute[]`, **not** in `contract.json` — so swapping
 * the bundle changes `migrationHash` (consumed by the runner at apply
 * time, see `packages/1-framework/3-tooling/migration/src/hash.ts`)
 * but leaves `headRef.hash` (which only digests the contract IR)
 * untouched. The descriptor self-consistency test in
 * `test/descriptor.test.ts` re-runs `assertDescriptorSelfConsistency`
 * to confirm that invariant.
 */
export { EQL_INSTALL_SQL as EQL_BUNDLE_SQL, EQL_INSTALL_VERSION } from './eql-install.generated';
