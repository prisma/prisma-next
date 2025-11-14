# Brief: Control Plane Executor (replace queryRunnerFactory)

This brief proposes a Control Plane executor that mirrors runtime assembly (adapter + driver + context → executor), removes `db.queryRunnerFactory` from config, and cleanly separates planes into Execution and Control with a small Shared Artifacts ring. It also moves `readMarker()` into the family to fully decouple the Control Plane from SQL specifics.

## Background and Sources

- AGENTS.md “Quick Context”, “Boundaries & Safety Rails”, and “Targets domain separation” set the rules for multi-plane entrypoints and layering. See: `AGENTS.md` (directory layout, adapter/driver split, multi-plane entrypoints).
- Architecture Overview describes current planes and responsibilities; this brief simplifies to two planes while maintaining the same constraints. See: `docs/Architecture Overview.md`.
- Runtime assembly pattern lives in `@prisma-next/sql-runtime` and `@prisma-next/runtime-executor`:
  - Runtime Core: `packages/framework/runtime-executor` (target-agnostic)
  - SQL Runtime: `packages/sql/sql-runtime` (family composition around Runtime Core)
- Current CLI configuration and verify path:
  - Config types: `packages/framework/tooling/cli/src/config-types.ts`
  - Config loader: `packages/framework/tooling/cli/src/config-loader.ts`
  - Verify DB API: `packages/framework/tooling/cli/src/api/verify-database.ts`
  - SQL family CLI descriptor (verify helpers): `packages/sql/tooling/cli/src/exports/cli.ts`
  - Adapter/Target CLI descriptors: `packages/targets/postgres-adapter/src/exports/cli.ts`, `packages/targets/postgres/src/exports/cli.ts`

Golden rules this design adheres to:
- Use adapters vs branching on target (AGENTS.md rule).
- Keep planes separated; do not import runtime into control.
- No backward-compat shims long-term; provide a brief deprecation window.
- Keep docs current; this brief includes a doc update checklist.

## Objectives

- Mirror runtime assembly in the Control Plane: assemble `adapter + driver + family helpers + manifests` to perform DB-connected CLI ops.
- Remove ad‑hoc `db.queryRunnerFactory` from app config.
- Keep two planes (Execution and Control) plus a minimal Shared Artifacts ring.
- Decouple Control from SQL: family exposes `readMarker()` rather than SQL text.
- Provide tests proving the driver-based path works (unit + e2e).

## Current Implementation (What Exists Today)

- Config uses `db.queryRunnerFactory` (custom runner) (`packages/framework/tooling/cli/src/config-types.ts:114`).
- `verify-database.ts` loads the contract, retrieves SQL from `family.verify.readMarkerSql()`, and executes SQL via the ad‑hoc runner; then compares hashes and target (`packages/framework/tooling/cli/src/api/verify-database.ts`).
- SQL family exports `verify.readMarkerSql` and `collectSupportedCodecTypeIds` (`packages/sql/tooling/cli/src/exports/cli.ts`). The Control Plane parses rows via `parseContractMarkerRow`.
- `@prisma-next/driver-postgres/cli` is currently a stub; drivers aren’t wired for CLI control usage.

Limitations:
- Diverges from runtime assembly (no driver in config, app supplies runner).
- Couples Control Plane to SQL statement shapes.
- Harder to support non-SQL families or alternate transports.

## Planes and Ring

- Execution Plane (runtime): plan execution, encode/decode, plugins, telemetry, runtime marker verification.
- Control Plane (CLI): config load/validation, contract emit, pack assembly, DB verification, migrations (plan, preflight/shadow/explain, apply), control telemetry.
- Shared Artifacts ring: contract IR/types, plan types, marker parsing, error envelopes. No imports from Control or Execution.

This replaces previous “migration vs runtime vs shared” wording with simpler Execution vs Control, matching how the system actually runs, and treats Shared as a small type/data ring.

## Config Shape (Control Plane)

- Keep: `family`, `target`, `adapter`, `extensions`, `db: { url }`, `contract`.
- Add: `driver` (DriverDescriptor) via `@prisma-next/driver-<id>/cli`.
- Remove (deprecate): `db.queryRunnerFactory`.

Example:

```ts
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,      // new
  extensions: [],
  db: { url: process.env.DATABASE_URL },
  contract: { source, output, types },
});
```

## New/Updated Types (Control Plane)

CliDriver
- `query<Row>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>`
- `close(): Promise<void>`

DriverDescriptor
- `kind: 'driver'`
- `id: string`
- `family: string`
- `manifest: ExtensionPackManifest`
- `create(url: string): Promise<CliDriver>`

FamilyDescriptor.verify (updated)
- `readMarker(driver: CliDriver): Promise<Marker | null>`
- `collectSupportedCodecTypeIds?(descriptors: readonly (Target|Adapter|Extension)[]): readonly string[]`

Notes
- Moving `readMarker()` into the family removes SQL coupling from Control logic and allows non-SQL families to implement marker reads however they need.
- For MVP, implement `readMarker()` in the SQL family by executing parameterized SQL via the driver and returning a structured marker.

## Driver CLI Entry Point

- Implement `@prisma-next/driver-postgres/cli` to export a `DriverDescriptor` with `create(url)` returning a `CliDriver` using `pg` under the hood.
- Maintain separation: adapter handles lowering/capabilities, driver handles transport, target exposes dialect manifest.

Example (sketch):

```ts
// packages/targets/postgres-driver/src/exports/cli.ts
import { Client } from 'pg';
const driver = {
  kind: 'driver' as const,
  id: 'postgres',
  family: 'sql',
  manifest: loadManifest(),
  async create(url) {
    const client = new Client({ connectionString: url });
    await client.connect();
    return {
      async query(sql, params) { const r = await client.query(sql, params); return { rows: r.rows }; },
      async close() { await client.end(); },
    };
  },
};
export default driver;
```

## Family Verify: readMarker()

- Location: `packages/sql/tooling/cli/src/exports/cli.ts` (SQL family CLI descriptor)
- Add `verify.readMarker(driver)` that:
  - Executes the SQL used previously by `readMarkerSql()` via `driver.query()`
  - Parses the row into `{ coreHash, profileHash }` (and any needed metadata)
  - Returns `null` if no rows found (marker missing)
- Remove `readMarkerSql()` from Control usage (keep internal or remove in a later cleanup).

## Control Executor (new)

Location: `packages/framework/tooling/cli/src/control/executor.ts`

Inputs
- `family.verify.readMarker()` (family-owned DB read)
- `family.verify.collectSupportedCodecTypeIds?()` (manifest-based codec coverage)
- `driver: CliDriver`
- descriptors: `adapter`, `target`, `extensions`
- `contractIR` (validated via `family.validateContractIR`)

API
- `readMarker(): Promise<Marker | null>` → delegates to `family.verify.readMarker(driver)`
- `verifyAgainst(contractIR, expectedTargetId): VerifyDatabaseResult`
- `close(): Promise<void>`

Responsibilities
- Use family-provided `readMarker()` to fetch a structured marker.
- Compare target/coreHash/profileHash.
- Optional codec coverage using family‑provided helper and manifests.
- No encode/decode, no runtime plugins — this is a thin control-only executor.

## verify-database Refactor

Update `packages/framework/tooling/cli/src/api/verify-database.ts` to:
- Load config and contract IR (unchanged).
- Obtain `driver` via `await config.driver.create(dbUrl)`.
- Construct ControlExecutor with `family.verify`, `driver`, `adapter/target/extensions`.
- Call `executor.verifyAgainst(contractIR, config.target.id)` and format output.
- Ensure `driver.close()` in a `finally` block.

Backward compatibility
- If `driver` is missing but `db.queryRunnerFactory` exists, emit a deprecation warning and use the factory for a transitional period.
- Introduce `PN-CLI-4010` when neither is supplied (driver preferred path).

## Validation and Errors

- Config loader validates `driver` presence/shape for DB-connected commands.
- Errors maintained:
  - PN-RTM-3001: Marker missing
  - PN-RTM-3002: Hash mismatch (core/profile)
  - PN-RTM-3003: Target mismatch
  - PN-CLI-4010: Driver missing for DB-connected command (new)
  - PN-CLI-4007: Family `readMarker` missing (replacing the previous `readMarkerSql` check)

## Testing

E2E (driver path)
- Update `packages/framework/tooling/cli/test/db-verify.e2e.test.ts` to import `driver: postgresDriver` and remove inline `queryRunnerFactory` for main path.
- Cases:
  - Matching marker → success output
  - Marker missing → PN-RTM-3001 error
  - JSON output mode

Unit/API
- `packages/framework/tooling/cli/test/api/verify-database.test.ts`:
  - “verifies database with matching marker via driver”
  - “reports error when marker is missing via driver”
  - “outputs JSON with driver path”
  - “reports PN-CLI-4010 when driver is missing”
  - “accepts deprecated db.queryRunnerFactory with warning” (temporary)

Behavior parity
- Assert same summaries/codes as current tests.
- JSON result structure unchanged.

## Rollout

Phase 1 (compat)
- Implement driver and ControlExecutor.
- Prefer driver; warn if `db.queryRunnerFactory` used.
- Keep one e2e path covering deprecated behavior to avoid regressions.

Phase 2 (default to driver)
- Update docs/examples to driver path.
- Error with PN-CLI-4010 when both driver and factory are missing.

Phase 3 (remove factory)
- Drop `db.queryRunnerFactory` support and the associated test.

## Risks and Mitigations

- Driver surface creep: keep `CliDriver` minimal (query/close). Add `begin/commit/rollback` later for migrations.
- Shared leakage: keep marker parsing and envelopes in a small shared module usable by both planes; don’t import runtime-only code.
- Docs drift: update AGENTS.md and Architecture Overview in the same PR.

## Open Questions

- Transactions in `CliDriver` now vs later? Prefer later; keep interface extensible.
- Non-SQL families: `family.verify.readMarker()` abstracts statement shapes; can accept richer driver/query shapes later without Control changes.

## Implementation Checklist

- Types and config
  - Update `packages/framework/tooling/cli/src/config-types.ts` with `CliDriver`, `DriverDescriptor`, and updated `FamilyDescriptor.verify` including `readMarker()`.
  - Update `packages/framework/tooling/cli/src/config-loader.ts` to validate `driver` and deprecate `db.queryRunnerFactory`.

- Driver CLI entrypoint
  - Implement `packages/targets/postgres-driver/src/exports/cli.ts` exporting `default` `DriverDescriptor` with `create(url)`.

- Family verify
  - Update `packages/sql/tooling/cli/src/exports/cli.ts` to provide `verify.readMarker(driver)` and keep/remove `readMarkerSql` as needed.

- Control executor
  - Add `packages/framework/tooling/cli/src/control/executor.ts` with `readMarker/verifyAgainst/close`.

- Verify refactor
  - Update `packages/framework/tooling/cli/src/api/verify-database.ts` to assemble via `driver` and delegate `readMarker()` to `family.verify`.

- Tests
  - Update `packages/framework/tooling/cli/test/db-verify.e2e.test.ts` to exercise driver path.
  - Update/add `packages/framework/tooling/cli/test/api/verify-database.test.ts` for driver path and new errors.

- Docs
  - Update plane terminology in `AGENTS.md` and `docs/Architecture Overview.md`.

## Success Criteria

- `pnpm test:packages` and `pnpm test:e2e` pass.
- Driver-based path validated in unit and e2e tests.
- Deprecated factory path warns (during transition), then fully removed in Phase 3.
- Config loader errors with PN-CLI-4010 when driver missing.
