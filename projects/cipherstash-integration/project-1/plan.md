# Project 1 — CR follow-ups — Plan

Two milestones, sequential: m1 (CR-1 — migration-op factories + renderable IR) followed by m2 (CR-5 — operator type-visibility). Each milestone has its own validation gate; both gates run as a full sweep (workspace-wide test:packages + example typecheck + lint:deps + targeted package builds).

Locked-in design — file paths, code snippets, exact signatures — lives in [`../project-1-rebase-followups.md`](../project-1-rebase-followups.md). The implementer reads that doc as the source of truth for *what* to build; this plan describes *how* to sequence and validate it.

# m1 — CR-1: Public migration-op factories + renderable IR via the codec hook

**Scope:** Promote the framework `OpFactoryCall` interface; widen the codec hook contract; drop the postgres planner's `RawSqlCall` wrap; cipherstash gets its own `*Call` classes implementing the framework interface, with public factory functions exported from a new `/migration` subpath; codec hook returns the renderable IR; ADR 195 + 212 amendments.

**Acceptance criteria covered:** AC-1, AC-3 (ADR 195 + 212).

## Tasks

Ordered. Each task lands in its own commit (or a tight group) per the repo's commit-as-you-go rule.

### T1.1 — Promote framework `OpFactoryCall` interface

[`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:92-99`](../../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:92-99). Add `renderTypeScript(): string`, `importRequirements(): readonly ImportRequirement[]`, `toOp(): MigrationPlanOperation` to the interface. Pull `ImportRequirement` from `@prisma-next/ts-render`. Update the doc comment to reflect that this interface is the framework-level contract for any factory call participating in the planner IR / two-renderer pattern (ADR 195).

This is structurally a breaking change to a framework-public type. Postgres + mongo already satisfy the promoted shape (verify each builds + tests).

**Validates with:** `pnpm --filter @prisma-next/framework-components build`, `pnpm --filter @prisma-next/family-sql build`, `pnpm --filter @prisma-next/target-postgres build`, `pnpm --filter @prisma-next/target-mongo build`.

### T1.2 — Widen `CodecControlHooks.onFieldEvent` return type

[`packages/2-sql/9-family/src/core/migrations/types.ts`](../../../packages/2-sql/9-family/src/core/migrations/types.ts) — change `onFieldEvent` return type from `readonly SqlMigrationPlanOperation<TTargetDetails>[]` to `readonly OpFactoryCall[]`.

[`packages/2-sql/9-family/src/core/migrations/field-event-planner.ts:65-67`](../../../packages/2-sql/9-family/src/core/migrations/field-event-planner.ts:65-67) — change `planFieldEventOperations` return type from `readonly SqlMigrationPlanOperation<unknown>[]` to `readonly OpFactoryCall[]`. Update internal accumulator + tests' fixture stubs in lockstep.

Hard-cut, no `OpFactoryCall | SqlMigrationPlanOperation` widening. Cipherstash is the only production implementer; tests update in this same task.

**Validates with:** `pnpm --filter @prisma-next/family-sql test`, plus T1.1 validation gates (still green).

### T1.3 — Drop the postgres planner's `RawSqlCall` wrap

[`packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:170-175`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:170-175) — replace the `.map((op) => new RawSqlCall(op as SqlMigrationPlanOperation<PostgresPlanTargetDetails>))` call with a plain spread of `fieldEventOps`.

[`packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts:46`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts:46) — widen `renderCallsToTypeScript` parameter type from `ReadonlyArray<PostgresOpFactoryCall>` to `ReadonlyArray<OpFactoryCall>`. The body is already polymorphic over `call.renderTypeScript()` + `call.importRequirements()`; no body change required.

`TypeScriptRenderablePostgresMigration`'s constructor signature widens to match.

**Validates with:** `pnpm --filter @prisma-next/target-postgres test`.

### T1.4 — Cipherstash `*Call` classes

New file [`packages/3-extensions/cipherstash/src/core/migration-call-classes.ts`](../../../packages/3-extensions/cipherstash/src/core/migration-call-classes.ts) — package-internal:

- `abstract class CipherstashOpFactoryCallNode extends TsExpression implements OpFactoryCall` with `factoryName`, `operationClass`, `label`, `toOp()` abstract; `importRequirements()` provided.
- `CipherstashAddSearchConfigCall` — concrete, `factoryName: 'cipherstashAddSearchConfig'`, `operationClass: 'additive'`. Constructor stamps `(table, column, index, castAs)`. `toOp()` produces the same `SqlMigrationPlanOperation<unknown>` today's `buildAddOp` produces. `renderTypeScript()` emits `cipherstashAddSearchConfig({ table, column, index, castAs? })` via `jsonToTsSource`.
- `CipherstashRemoveSearchConfigCall` — mirror, `operationClass: 'destructive'`.
- Frozen at construction.

Plus the public types: `CipherstashSearchIndex` (`'unique' | 'match'`), `CipherstashSearchConfigArgs` (`{ table, column, index, castAs? }`).

**Validates with:** `pnpm --filter @prisma-next/extension-cipherstash test` (existing 167 tests still green; new unit tests for the Call classes added in this task).

### T1.5 — Public factory functions + new `/migration` subpath

New file [`packages/3-extensions/cipherstash/src/exports/migration.ts`](../../../packages/3-extensions/cipherstash/src/exports/migration.ts):

```typescript
export {
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from '../core/migration-call-classes';
export type {
  CipherstashSearchIndex,
  CipherstashSearchConfigArgs,
} from '../core/migration-call-classes';
```

The factory functions construct the corresponding `*Call` classes; they live in `migration-call-classes.ts` alongside the class definitions.

[`packages/3-extensions/cipherstash/package.json`](../../../packages/3-extensions/cipherstash/package.json) — add a `./migration` entry to `exports`. Mirror the existing `./control` / `./runtime` shape.

[`packages/3-extensions/cipherstash/tsdown.config.ts`](../../../packages/3-extensions/cipherstash/tsdown.config.ts) (or equivalent — verify the package's bundler config) — register the new entry.

**Validates with:** `pnpm --filter @prisma-next/extension-cipherstash build` (new subpath emits), `pnpm --filter cipherstash-integration-example typecheck` (downstream resolves).

### T1.6 — Cipherstash codec hook returns Calls

[`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts`](../../../packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts) — change `onFieldEvent` return type to `readonly OpFactoryCall[]`. Replace `buildAddOp` / `buildRemoveOp` plain-object construction with calls to `cipherstashAddSearchConfig({...})` / `cipherstashRemoveSearchConfig({...})`. The flag-to-index walk (`equality → 'unique'`, `freeTextSearch → 'match'`) stays inside this file; the public factory args expose `index` directly.

Delete `buildAddOp` / `buildRemoveOp` and any now-dead helpers. (No back-compat shims — the only caller is this codec.)

**Validates with:** `pnpm --filter @prisma-next/extension-cipherstash test`.

### T1.7 — Regenerate the example app's baseline migration; verify round-trip invariants

[`examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts`](../../../examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts) regenerates as part of `pnpm --filter cipherstash-integration-example build:contract-space` (or the equivalent migration-plan command — confirm against the example's package.json scripts).

Verify:

1. Codec-emitted ops render as `cipherstashAddSearchConfig({...})` / `cipherstashRemoveSearchConfig({...})` calls. **Zero** `rawSql({ id: 'cipherstash-codec.*', ... })` blocks remain (grep the regenerated file).
2. Auto-import: `import { cipherstashAddSearchConfig, ... } from '@prisma-next/extension-cipherstash/migration';` is at the top of the regenerated file, deduped alongside postgres imports.
3. Re-run `pnpm tsx migrations/20260508T1721_migration/migration.ts` and verify `ops.json` is byte-identical to the pre-CR-1 baseline (capture the baseline before the regen; compare after).
4. `migration.json` `migrationHash` is unchanged.

**Validates with:** the round-trip checks above (scripted as part of this task), plus `pnpm --filter cipherstash-integration-example typecheck`.

### T1.8 — ADR 195 + ADR 212 amendments

ADR 195 ([`docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md`](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md)):

- Record that the framework-level `OpFactoryCall` interface (in `framework-components/control`) is now the canonical contract for the IR; postgres + mongo + cipherstash all implement it directly.
- Note that the visitor-pattern section is illustrative-only; production implementations use inheritance-with-abstract-methods (`renderTypeScript`, `importRequirements`, `toOp`). The visitor / `accept` form is not what the postgres or mongo `OpFactoryCallNode` actually look like.
- Note that extensions can implement the framework `OpFactoryCall` directly without depending on a target's package-private base.

ADR 212 ([`docs/architecture docs/adrs/ADR 212 - Codec lifecycle hooks.md`](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Codec%20lifecycle%20hooks.md)):

- Update the hook contract code block: return type `readonly OpFactoryCall[]` (was `readonly SqlMigrationPlanOperation<TTargetDetails>[]`).
- Update the mermaid diagram to reflect that codec-emitted output flows through the planner's call list (rendered to `migration.ts`) AND through `toOp()` derivation (rendered to `ops.json`). The two-fan-out shape from ADR 195 applies here.
- Cross-link to ADR 195 explicitly.

**Validates with:** doc-build / link-check whatever this repo runs (likely none specifically for ADRs; rely on review).

## m1 validation gate

All of these must pass green before the milestone is `SATISFIED`:

```bash
pnpm --filter @prisma-next/framework-components build
pnpm --filter @prisma-next/family-sql build
pnpm --filter @prisma-next/target-postgres build
pnpm --filter @prisma-next/target-mongo build
pnpm --filter @prisma-next/extension-cipherstash build
pnpm --filter cipherstash-integration-example typecheck
pnpm test:packages
pnpm lint:deps
```

Plus the round-trip invariants from T1.7 (scripted check; result captured in the implementer's report).

# m2 — CR-5: Operator type-visibility

**Scope:** Mirror pgvector's `QueryOperationTypes` pattern for `cipherstashEq` / `cipherstashIlike` on `cipherstash/string@1`; new `/operation-types` subpath; positive + negative type tests in the example app; ADR 211 amendment; cancel TML-2435 Linear ticket.

**Acceptance criteria covered:** AC-2, AC-3 (ADR 211).

## Tasks

### T2.1 — `QueryOperationTypes` declaration

New file [`packages/3-extensions/cipherstash/src/types/operation-types.ts`](../../../packages/3-extensions/cipherstash/src/types/operation-types.ts):

```typescript
export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly cipherstashEq: { readonly self: { readonly codecId: 'cipherstash/string@1' }; readonly impl: ... };
    readonly cipherstashIlike: { readonly self: { readonly codecId: 'cipherstash/string@1' }; readonly impl: ... };
  }
>;
```

Reference: [`packages/3-extensions/pgvector/src/types/operation-types.ts`](../../../packages/3-extensions/pgvector/src/types/operation-types.ts).

Verify the return-codec type matches what `cipherstashQueryOperations()` actually lowers to at runtime ([`packages/3-extensions/cipherstash/src/core/operators.ts`](../../../packages/3-extensions/cipherstash/src/core/operators.ts)). The boolean codec ID may be `pg/bool@1` (matching pgvector) or something else; pin to the runtime's truth.

**Validates with:** `pnpm --filter @prisma-next/extension-cipherstash build` (types compile).

### T2.2 — `/operation-types` subpath export

New file [`packages/3-extensions/cipherstash/src/exports/operation-types.ts`](../../../packages/3-extensions/cipherstash/src/exports/operation-types.ts):

```typescript
export type { QueryOperationTypes } from '../types/operation-types';
```

[`packages/3-extensions/cipherstash/package.json`](../../../packages/3-extensions/cipherstash/package.json) — add `./operation-types` exports entry.

Bundler config (tsdown or equivalent) — register the new entry.

**Validates with:** `pnpm --filter @prisma-next/extension-cipherstash build` (new subpath emits cleanly).

### T2.3 — Positive + negative type tests in the example app

[`examples/cipherstash-integration`](../../../examples/cipherstash-integration) — wire the cipherstash extension's `QueryOperationTypes` through the example's contract / type composition. Mirror however the example currently composes pgvector's operations if pgvector is set up there; otherwise follow the framework's contract-emit composition pattern.

Add type tests (preferably as part of an existing typecheck-only file in the example, or a new `*.types.ts` sibling):

- **Positive:** `db.user.findMany({ where: { email: { cipherstashEq: 'x' } } })` type-checks. `sql(t).where(t => t.email.cipherstashEq('x'))` type-checks.
- **Negative (`@ts-expect-error`):** `db.user.findMany({ where: { name: { cipherstashEq: 'x' } } })` — `name` is `pg/text@1`, should error.

**Validates with:** `pnpm --filter cipherstash-integration-example typecheck`.

### T2.4 — ADR 211 amendment

[`docs/architecture docs/adrs/ADR 211 - Extension operator surface namespaced replacement operators.md`](../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md):

- Add a section noting that namespaced replacement operators must also project type-visibility through `QueryOperationTypes` for the operator to be discoverable on model accessors and the SQL query builder.
- Reference the `/operation-types` subpath convention.
- Cipherstash + pgvector are the canonical examples.

**Validates with:** none specifically; rely on review.

### T2.5 — Cancel TML-2435

Cancel the Linear ticket TML-2435 (separate ticket previously tracking this work). The change log entry in the ticket should reference the project-1 PR.

**Validates with:** ticket is cancelled (verify via Linear MCP).

## m2 validation gate

```bash
pnpm --filter @prisma-next/extension-cipherstash build
pnpm --filter @prisma-next/extension-cipherstash test
pnpm --filter cipherstash-integration-example typecheck
pnpm test:packages
pnpm lint:deps
```

# Open items

- The orchestration uses Cursor's `Task` tool with `resume` for subagent continuity. The implementer + reviewer subagent IDs land in `reviews/code-review.md § Subagent IDs` after R1 spawns them.
- ADR amendments (T1.8, T2.4) ride with their implementing milestone's PR rather than landing in a separate doc-only PR.
- TML-2435 cancellation (T2.5) waits for the PR to be in-flight (post-`SATISFIED`) so the ticket reference points at a real PR.

## Pre-existing items surfaced during execution (out of scope for this PR)

The following surfaced during m1 R1 implementation/review and were verified pre-existing on the rebased branch (i.e. they pre-date m1 and are not introduced by CR-1 work). They are out-of-scope for this PR; the implementer is **not** to address them in subsequent rounds.

- **E1 — `ExtensionMigrationPackage` TS2614 in three cipherstash e2e integration tests.** `storage-roundtrip.e2e.integration.test.ts`, `umbrella.e2e.integration.test.ts`, `umbrella-nullable.e2e.integration.test.ts` carry a type-only import `ExtensionMigrationPackage` from `@prisma-next/family-sql/control` that errors `TS2614: Module ... has no exported member ...`. Verified missing from the family-sql barrel at `7f651eb62` and at HEAD; tests run + pass at runtime; the import is type-only. Pre-existing post-rebase artefact; track separately. **Action:** file as a follow-up Linear ticket (test infra hardening) referencing the failing test paths; out-of-scope for Project 1 CR follow-ups.
- **E2 — `pnpm test:packages` cold-run flakes.** Cold-cache runs reproduce 2-3 transient failures across `target-mongo`, `extension-cipherstash`, occasionally `cli` / `adapter-postgres`. Failures are timing-bound (100ms `beforeEach` hooks + temp-dir races; 8s render-typescript test timeout). Each failing package, run individually, passes 100% of tests. After per-package warm-up runs, full sweep reports 113/113. None of the failing tests touch CR-1 surfaces. **Action:** file as a follow-up Linear ticket (test infra hardening — hook timeouts + temp-dir handling); out-of-scope for Project 1 CR follow-ups.
