# Migration write-path validation

Linear: [TML-2271](https://linear.app/prisma-company/issue/TML-2271/class-flow-migrationrun-validate-existing-manifest-operation-entries) · CodeRabbit findings on PR #354

## Summary

Harden the class-flow `Migration` write path (the code path invoked by `node migration.ts`) so it fast-fails on three classes of invalid input that today are silently accepted: an unparseable `migration.json`, a previously-scaffolded `migration.json` whose preserved contract bookends disagree with the migration's current `describe()` metadata, and operation entries that don't match the canonical `MigrationPlanOperation` shape.

## Description

The class-flow write path consists of two cooperating pieces:

- The CLI side ([`packages/1-framework/3-tooling/cli/src/migration-cli.ts`](../../packages/1-framework/3-tooling/cli/src/migration-cli.ts)) reads `migration.json` from disk and passes the parsed value as `existing` into the pure builder.
- The pure builder ([`buildMigrationArtifacts` in `packages/1-framework/3-tooling/migration/src/migration-base.ts`](../../packages/1-framework/3-tooling/migration/src/migration-base.ts)) takes the migration instance plus `existing`, derives the attested metadata, computes the `migrationHash`, and returns the in-memory `ops.json` / `migration.json` strings. The CLI persists the result.

CodeRabbit identified three cases where the write path either swallows an error or accepts a structurally invalid input and persists it:

1. **Unparseable `migration.json`.** `readExistingMetadata` returns `null` on `JSON.parse` failure. The builder then takes the synthesis path (treating the package as scratch), losing the user's hand-edited content and any indication that something was wrong on disk.
2. **Stale contract bookends.** `buildAttestedMetadata` reuses `existing.fromContract` / `existing.toContract` blindly, even when `existing.fromContract.storage.storageHash !== meta.from` (or the symmetric `to` case). After a `describe()` edit and a re-emit the resulting `migration.json` mixes fresh top-level `from` / `to` with stale `fromContract` / `toContract`. Downstream commands (`migration plan`, `migration apply`) read `metadata.toContract` as the authoritative contract for the package; a self-inconsistent manifest would be carried into apply, where the marker check would eventually fail with a less actionable diagnostic.
3. **Malformed operation entries.** The builder only checks `Array.isArray(instance.operations)`. Entries missing `id` / `label` / `operationClass`, or carrying an `operationClass` outside the `'additive' | 'widening' | 'destructive' | 'data'` union, are written into `ops.json` and attested via `migrationHash`. The apply-time loader (`readMigrationPackage` in [`io.ts`](../../packages/1-framework/3-tooling/migration/src/io.ts)) already validates the same shape via the same arktype schema; we want to fail at write time rather than apply time so the diagnostic points at the authored class instead of the persisted artifact.

The structured-error vocabulary already lives in [`migration/src/errors.ts`](../../packages/1-framework/3-tooling/migration/src/errors.ts) (the `MIGRATION` namespace from ADR 027). `MIGRATION.INVALID_JSON` already covers the parse case and is used by the apply-time loader; the other two cases need new codes.

## Decisions

1. **Parse-error fast-fail lives in the CLI.** `readExistingMetadata` is the only place that touches the file. Distinguish "missing → `null`" (unchanged: scratch path) from "present-but-unparseable → throw `MIGRATION.INVALID_JSON`". This is the simplest split and matches the ownership boundary already documented in the file's JSDoc ("File I/O lives here, in `@prisma-next/cli`").
2. **Bookend-mismatch fast-fail lives in `buildMigrationArtifacts`.** The builder already takes `existing` and `meta`; promoting the comparison there enforces the invariant for every caller (CLI today, programmatic callers tomorrow) and keeps the CLI a thin file-I/O wrapper. Comparison is strict equality of `existing.fromContract?.storage?.storageHash` against `meta.from` and `existing.toContract?.storage?.storageHash` against `meta.to`. The `from` side is skipped when `meta.from === ''` and `existing.fromContract === null` (origin-less migration); the `to` side is always checked when `existing.toContract` is non-null. Either side mismatching throws `MIGRATION.STALE_CONTRACT_BOOKENDS`.
3. **Ops-shape validation lives in `buildMigrationArtifacts`.** Validate `instance.operations` against the same arktype schema the apply-time loader uses (`MigrationOpSchema` in [`io.ts`](../../packages/1-framework/3-tooling/migration/src/io.ts)). Promote the schema into a shared module (`packages/1-framework/3-tooling/migration/src/op-schema.ts`) and import from both `io.ts` (apply-time) and `migration-base.ts` (write-time) to keep a single source of truth. The first failing entry throws `MIGRATION.INVALID_OPERATION_ENTRY` with the offending `index` in `details`; subsequent failures are not reported in the same throw (existing convention — arktype's own short-circuit behaviour, and matches how the apply-time loader surfaces `MIGRATION.INVALID_MANIFEST`).
4. **No backward-compatibility shims.** Per `AGENTS.md` golden rules, we update call sites if the existing-metadata loader signature changes. The change here is additive (the loader can now throw), so no signature change is required.
5. **`kind` validation is out of scope.** TML-2270 owns the `'regular' | 'baseline'` discriminator rework; we don't touch it.
6. **Bookend removal (TML-2274) is acknowledged but separate.** Removing `fromContract` / `toContract` from the manifest will make the bookend-mismatch check structurally impossible to violate, at which point this check can be deleted as part of TML-2274's diff. The cost of writing the check now and removing it later is small (one helper, one error code, three tests) compared to the cost of bundling a structural refactor with a hardening fix. Both PRs reference each other.

## Non-goals

- Removing `fromContract` / `toContract` from `MigrationMetadata`. Tracked separately as [TML-2274](https://linear.app/prisma-company/issue/TML-2274/remove-tocontract-and-fromcontract-from-migration-manifest).
- Reworking the `kind: 'regular' | 'baseline'` discriminator. Tracked as [TML-2270](https://linear.app/prisma-company/issue/TML-2270).
- Changing the `migrationHash` algorithm or the canonicalisation rules in [`hash.ts`](../../packages/1-framework/3-tooling/migration/src/hash.ts). The bookend stripping there is unaffected by anything in this spec.
- Validating the `Contract` object inside the bookends beyond the `storage.storageHash` comparison. The arktype schema in `io.ts` already declares `fromContract: 'object | null'` and `toContract: 'object'` — that shallow check is sufficient at the artifact-loader level. Deep contract validation is owned by `validateContract` in the family pack.
- Surfacing all malformed operation entries in a single throw. We surface the first failure with its index; the author re-runs after fixing.
- Touching the apply-time loader's behaviour. It already validates the same shape; promoting the schema is purely a deduplication.

## Acceptance criteria

### Parse-error fast-fail (CLI)

- [ ] `MigrationCLI.run` throws `MIGRATION.INVALID_JSON` (and exits non-zero with the diagnostic on stderr) when `migration.json` exists in the migration directory but cannot be parsed as JSON.
- [ ] `MigrationCLI.run` continues to take the synthesis path (no error) when `migration.json` is absent. (Regression: existing behaviour.)
- [ ] The `MIGRATION.INVALID_JSON` diagnostic includes the absolute path to the unparseable file and the underlying parse-error message in `details`.

### Bookend-mismatch fast-fail (`buildMigrationArtifacts`)

- [ ] `buildMigrationArtifacts` throws `MIGRATION.STALE_CONTRACT_BOOKENDS` when `existing.fromContract.storage.storageHash !== meta.from`.
- [ ] `buildMigrationArtifacts` throws `MIGRATION.STALE_CONTRACT_BOOKENDS` when `existing.toContract.storage.storageHash !== meta.to`.
- [ ] The check is skipped when the relevant `existing` bookend is `null`/absent (synthesis path stays open for the `from` side of an initial migration).
- [ ] The diagnostic identifies which side mismatched (`'from' | 'to'`), the expected hash (`meta`), and the contract's hash, all in `details` for machine consumers.
- [ ] The fix-hint guides the author toward `migration plan` to regenerate bookends, not toward `node migration.ts` (the latter is the loop they're already in).

### Operation-entry validation (`buildMigrationArtifacts`)

- [ ] `buildMigrationArtifacts` throws `MIGRATION.INVALID_OPERATION_ENTRY` when any element of `instance.operations` is missing `id`, `label`, or `operationClass`.
- [ ] `buildMigrationArtifacts` throws `MIGRATION.INVALID_OPERATION_ENTRY` when any element's `operationClass` is outside `'additive' | 'widening' | 'destructive' | 'data'`.
- [ ] The diagnostic includes the offending entry's `index` (zero-based) and the arktype summary in `details`.
- [ ] The check fires before `migrationHash` computation and before `deriveProvidedInvariants` (so a malformed op never produces an attested artifact and never reaches the invariant validator with a malformed payload).
- [ ] The shared schema module (`op-schema.ts`) is consumed by both `io.ts` and `migration-base.ts`; no behaviour regression at apply-time.

### Cross-cutting

- [ ] All three new throws are `MigrationToolsError` instances (i.e. `MigrationToolsError.is(err)` returns true) carrying `code`, `category: 'MIGRATION'`, `why`, `fix`, and `details`.
- [ ] All three failure modes have unit-test coverage in either `packages/1-framework/3-tooling/migration/test/migration-base.test.ts` (builder) or `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts` (CLI parse-error), as appropriate to where the throw originates.
- [ ] The existing happy-path tests (`buildMigrationArtifacts` with well-formed `existing`, `MigrationCLI.run` round-trip with no `migration.json`, `MigrationCLI.run` re-emit with consistent `migration.json`) still pass unchanged.
- [ ] `pnpm test:packages` passes; `pnpm lint:deps` passes; `pnpm build` for `@prisma-next/migration-tools` passes (declarations refresh because we add an exported function/type for the new error helpers).

## Other considerations

### Error codes

Two new codes under the `MIGRATION` namespace, sitting alongside the existing helpers in [`errors.ts`](../../packages/1-framework/3-tooling/migration/src/errors.ts):

- **`MIGRATION.STALE_CONTRACT_BOOKENDS`** — emitted when `existing.fromContract.storage.storageHash` or `existing.toContract.storage.storageHash` disagrees with the corresponding side of `describe()`'s output.
  - `summary`: "Migration manifest contract bookends disagree with describe()"
  - `why`: "migration.json at <path> stores <side>Contract.storage.storageHash <contractHash>, but describe() returned meta.<side> = <metaHash>. The bookend is stale — most likely the migration's `describe()` was edited after the package was scaffolded by `migration plan`."
  - `fix`: helper-canonical form: "Re-run `migration plan` to regenerate the package with fresh contract bookends, or restore the directory from version control."
  - `details`: `{ filePath, side, metaHash, contractHash }`
- **`MIGRATION.INVALID_OPERATION_ENTRY`** — emitted when an entry of `instance.operations` fails the shared op-shape schema.
  - `summary`: "Migration operation entry is malformed"
  - `why`: "Operation at index <index> returned by the migration class is missing required fields or has an out-of-union `operationClass`: <arktype-summary>."
  - `fix`: "Update the migration class so each entry of `operations` carries `id` (string), `label` (string), and `operationClass` (one of 'additive' | 'widening' | 'destructive' | 'data')."
  - `details`: `{ index, reason }` where `reason` is the arktype summary. The offending entry itself is not embedded in `details` to keep error payloads bounded; authors can locate it by index.

The existing `MIGRATION.INVALID_JSON` (from `errors.ts`) is reused for the parse case — its current shape (`{ filePath, parseError }`) and remediation hint (`reemitHint(dirname(filePath), 'or restore the directory from version control.')`) are already exactly what we want.

### Schema location

The arktype schema for an operation entry already exists in [`io.ts` (lines 54–62)](../../packages/1-framework/3-tooling/migration/src/io.ts):

```ts
const MigrationOpSchema = type({
  id: 'string',
  label: 'string',
  operationClass: "'additive' | 'widening' | 'destructive' | 'data'",
  'invariantId?': 'string',
});
const MigrationOpsSchema = MigrationOpSchema.array();
```

We extract this into a new `packages/1-framework/3-tooling/migration/src/op-schema.ts`, exporting both `MigrationOpSchema` and `MigrationOpsSchema`. `io.ts` and `migration-base.ts` import from there. The schema's behaviour is unchanged; only its module home changes. (The existing JSDoc note "Intentionally shallow: operation-specific payload validation is owned by planner/runner layers" moves with it.)

### Test placement

- **Builder tests** (bookend mismatch + operation-entry validation) go into [`packages/1-framework/3-tooling/migration/test/migration-base.test.ts`](../../packages/1-framework/3-tooling/migration/test/migration-base.test.ts) — already the canonical home for `buildMigrationArtifacts` coverage. They cover both directions of the bookend check (`from`-side mismatch, `to`-side mismatch, both-sides-OK) and the four invalid-entry cases (missing `id`, missing `label`, missing `operationClass`, out-of-union `operationClass`).
- **CLI parse-error test** goes into [`packages/1-framework/3-tooling/cli/test/migration-cli.test.ts`](../../packages/1-framework/3-tooling/cli/test/migration-cli.test.ts), which already exercises `MigrationCLI.run` end-to-end with mocked `loadConfig` and `createControlStack`. We add one test that writes a malformed `migration.json` to the temp dir before invoking `MigrationCLI.run` and asserts that `process.exitCode === 1`, the stderr text contains the `MIGRATION.INVALID_JSON` summary, and no `ops.json` is written.

### Risk

- **Author UX during iteration.** A re-emit after editing `describe()` will now error rather than silently produce a stale-bookend manifest. The fix-hint points the user at `migration plan`, which is the correct primitive for regenerating the bookends. (Today's silent path was a foot-gun; this is the fix.)
- **Existing on-disk migrations.** Any `migration.json` already on disk in fixtures, examples, or demo apps that has stale bookends will now fail the next re-emit. We expect zero such cases in the repo (the example migrations are emitted by the CLI which keeps bookends consistent). If the test suite surfaces one, we re-emit it as part of this PR.
- **Apply-time path.** Untouched. The apply-time loader continues to throw `MIGRATION.INVALID_MANIFEST` on shape failures and `MIGRATION.HASH_MISMATCH` on integrity failures; promoting `MigrationOpSchema` to a shared module is a no-op there.
- **Public surface.** `MigrationOpSchema` is currently a file-private const in `io.ts`. Promoting it to a shared module makes it cross-file but it remains an internal concern of the `@prisma-next/migration-tools` package; we do not add it to `exports/`. The two new error helpers (`errorStaleContractBookends`, `errorInvalidOperationEntry`) are added to `errors.ts` next to the existing helpers and are not re-exported either (existing helpers aren't either; consumers catch via `MigrationToolsError.is(err)` and inspect `err.code`).

### Observability

The diagnostics follow the structured-error convention already in use across the package: a one-line `summary`, an explanatory `why`, an actionable `fix`, and a machine-readable `details` payload. No new logging, telemetry, or analytics events are introduced — the throws surface through `MigrationCLI.run`'s existing try/catch which writes `${err.message}: ${err.why}\n` to stderr and sets `process.exitCode = 1`.

## References

- Linear: [TML-2271](https://linear.app/prisma-company/issue/TML-2271/class-flow-migrationrun-validate-existing-manifest-operation-entries) (this work)
- Linear: [TML-2270](https://linear.app/prisma-company/issue/TML-2270) (deferred — `kind` discriminator)
- Linear: [TML-2274](https://linear.app/prisma-company/issue/TML-2274/remove-tocontract-and-fromcontract-from-migration-manifest) (related — supersedes the bookend check)
- PR review: [#354 CodeRabbit findings](https://github.com/prisma/prisma-next/pull/354) on `migration-base.ts` (note: function names referenced in the review have since been refactored — `readExistingManifest` → `readExistingMetadata` in `migration-cli.ts`; `serializeMigration` → `buildMigrationArtifacts` in `migration-base.ts`)
- ADR 027 — Error namespace conventions (referenced from `errors.ts` JSDoc)
- ADR 199 — Storage-only migration identity (rationale for stripping bookends from the hash; relevant context for why bookend-mismatch is a "side payload" hazard rather than a hash-integrity hazard)

## Open questions

None at this point — the design discussion in chat resolved the scope, error codes, schema location, and test placement. Implementation-time decisions (e.g. exact wording of the diagnostic strings) are flagged in the plan and resolved by the implementer.
