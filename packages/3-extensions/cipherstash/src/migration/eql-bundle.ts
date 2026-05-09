/**
 * Vendored CipherStash EQL bundle SQL.
 *
 * The CipherStash team ships the bundle as a single Postgres script
 * (~5,750 lines, currently `eql-2.2.1`) that creates the `eql_v2`
 * schema, the `eql_v2_*` composite types / domains, the
 * `eql_v2_configuration` table, plus roughly 169 functions, 46
 * operators, 4 casts, and 9 operator classes / families. CipherStash
 * treats the bundle as one indivisible artefact; project spec NFR4 /
 * AC7 require its contents flow into the
 * `cipherstash:install-eql-bundle-v1` migration op **byte-for-byte**
 * with no fork or split.
 *
 * The bundle source lives in
 * {@link ./eql-install.generated} — a single committed `.generated.ts`
 * file produced by `scripts/vendor-eql-install.ts` (TML-2373's
 * tooling). M3 R2 ports the file verbatim from the TML-2373 sibling
 * branch (`c38c83bae:packages/3-extensions/cipherstash/src/core/
 * eql-install.generated.ts`) and re-exports the constant under the
 * project-spec name `EQL_BUNDLE_SQL` here, so the rest of cipherstash
 * imports the same identifier across R1's placeholder and R2's real
 * bundle. Bumping the bundle version cherry-picks the regenerated
 * `.generated.ts` file from the upstream branch and re-runs
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
