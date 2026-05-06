/**
 * Vendored EQL Postgres install bundle.
 *
 * The bundle is the canonical install SQL for the EQL Postgres
 * extension (encrypt-query-language). It is sourced from a pinned EQL
 * release and committed to source control as a TypeScript string
 * literal so installation works offline and the SQL is trivially
 * inlinable into both ESM and CJS dist outputs.
 *
 * The constant is the input to `databaseDependencies.init` (see
 * `src/exports/control.ts`); when a control plane runs `dbInit`
 * against a fresh Postgres database, the runtime executes this SQL
 * once. Subsequent `dbInit` calls short-circuit through the
 * `cs_configuration_v2`/`eql_v2` schema precheck (AC-INSTALL3).
 *
 * To bump the pinned version, replace `eql-install.generated.ts` from
 * the upstream `encrypt-query-language` release. The generated file is
 * intentionally separated from this module so the version-bump diff
 * stays mechanical and auditable.
 */

export { EQL_INSTALL_SQL, EQL_INSTALL_VERSION } from './eql-install.generated';
