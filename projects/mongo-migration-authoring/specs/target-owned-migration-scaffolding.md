# Target-Owned Migration Scaffolding

## Context

`packages/1-framework/3-tooling/migration/src/migration-ts.ts` is the shared utility that writes a `migration.ts` file when the CLI runs `migration plan` or `migration new`. It lives in Domain 1 (framework, target-agnostic) per the numbered-layer rules.

An earlier pass on this branch introduced `MigrationScaffoldingCapability` as a three-method SPI (`renderPreamble` + `renderDescriptor` + `knownDescriptorKinds`) and moved target-specific strings out of the framework into Postgres and Mongo scaffolding modules. That landed the layering fix but kept two residual design mistakes:

1. The SPI is coupled to `OperationDescriptor` — the framework-level shape `{ kind: string; [k: string]: unknown }`. Any target that authors migrations must shape its plan as descriptors or adapt to them, even though the planner and resolver for a non-descriptor target (Mongo's `OpFactoryCall`-based pipeline, eventually SQL's) never speaks that shape internally.
2. The framework still performs per-line string assembly — map descriptors through `renderDescriptor`, comma-join, wrap in `export default () => [ ... ]` — which means rendering logic is split between the framework and the target. The target can't change the enclosing form without editing the framework.

This spec collapses the three-method SPI into a single `renderTypeScript(plan, context) => string` method, makes the plan shape opaque at the framework boundary, and moves all rendering into the target. The framework becomes a pipe: it gets a plan from whichever target-level planner the target exposes, hands it to the target's `renderTypeScript`, and writes the returned string to disk.

## Problem

### Coupling to `OperationDescriptor` at the framework boundary

`MigrationScaffoldingCapability.renderDescriptor` takes `OperationDescriptor` directly. `MigrationScaffoldContext.descriptors` is `readonly OperationDescriptor[]`. That ties the scaffolding SPI to a specific plan shape even though:

- Postgres's internal plan representation happens to be descriptor-shaped today, but that's a family-internal choice, not a framework invariant.
- Mongo's internal plan representation is `OpFactoryCall[]` (a tagged-union visitor shape, internal to `@prisma-next/target-mongo`). The current scaffolding capability forces Mongo to either adapt its ops into descriptors just for the scaffolder or leave scaffolding aspirational (which is what we did).
- The long-term direction is to compare both strategies side-by-side and consolidate. Forcing one shape into the SPI pre-commits that decision.

### Framework owns rendering logic it shouldn't

The framework-side assembly in `scaffoldMigrationTs` looks like this:

```ts
const preamble = options.scaffolding.renderPreamble(context);
const calls = descriptors.map((d) => `  ${options.scaffolding.renderDescriptor(d)},`);
const lines = [...preamble, '', `export default () => [${...calls...}]`, ''];
```

`export default () => [...]` is an assumption about what a migration.ts file looks like. It's true for descriptor-flow targets (Postgres): default export is a function returning an array of descriptors. It's false for class-flow targets (Mongo's current direction): default export is a `Migration` subclass with a `describe()` / `plan()` method pair and a `Migration.run(import.meta.url, Class)` invocation at the bottom of the file. The framework can't generate both shapes from one assembly template.

### `knownDescriptorKinds` is a framework concession

That third SPI method existed so the framework could compute the import set:

```ts
const importKinds = descriptors.map((d) => d.kind).filter((k) => knownKinds.has(k));
```

With the target owning full file assembly, it computes its own import set inline. No hook required.

## Design

### Principle

The framework owns file I/O. The target owns file content. The plan shape is target-internal; the framework never inspects it.

### Single-method SPI

```typescript
// @prisma-next/framework-components/control
// control-migration-types.ts

export interface MigrationScaffoldContext {
  /** Absolute path to the migration package directory. Used by targets to compute relative imports. */
  readonly packageDir: string;
  /** Absolute path to the contract.json file, if one exists. Used by targets that emit typed-contract imports. */
  readonly contractJsonPath?: string;
}

export interface MigrationScaffoldingCapability<TPlan = unknown> {
  /**
   * Produce the complete text of `migration.ts`. The framework writes the returned
   * string to `<packageDir>/migration.ts`; it does not inspect or post-process it.
   *
   * The plan's shape is target-internal. The framework passes `TPlan` through from
   * whichever target-level planner produced it. Empty-plan scaffolding (for
   * `migration new`) is the target's responsibility — it should emit a valid stub
   * the user can edit.
   */
  renderTypeScript(plan: TPlan, context: MigrationScaffoldContext): string;
}

export interface TargetMigrationsCapability<..., TPlan = unknown> {
  // ...existing members unchanged...
  scaffolding?: MigrationScaffoldingCapability<TPlan>;
}
```

Three properties:

- **`TPlan` generic, defaults to `unknown`.** Inside a target module, all three of planner, scaffolding, and resolver share a concrete `TPlan`. At the framework boundary the type parameter is erased to `unknown`, and the CLI pipes it without inspecting. The target is the sole author of the invariant that the three methods agree on a shape.
- **No mention of `OperationDescriptor`.** The SPI is plan-agnostic. `OperationDescriptor` remains a type for targets that *choose* to use it internally (Postgres today); the framework has no opinion.
- **Context is minimal.** `packageDir` and `contractJsonPath` are both things the target might need for emitting valid imports — nothing else crosses the boundary.

### Framework utility becomes a pipe

```typescript
// packages/1-framework/3-tooling/migration/src/migration-ts.ts

export interface ScaffoldOptions {
  readonly plan: unknown;
  readonly contractJsonPath?: string;
  readonly scaffolding: MigrationScaffoldingCapability;
}

export async function scaffoldMigrationTs(
  packageDir: string,
  options: ScaffoldOptions,
): Promise<void> {
  const context: MigrationScaffoldContext = {
    packageDir,
    ...(options.contractJsonPath !== undefined
      ? { contractJsonPath: options.contractJsonPath }
      : {}),
  };
  const content = options.scaffolding.renderTypeScript(options.plan, context);
  await writeFile(join(packageDir, 'migration.ts'), content);
}
```

No per-descriptor iteration. No import-set computation. No enclosing-form assumption. The utility exists only to wrap the capability call with file I/O so that file-writing stays environment-swappable in one place.

`evaluateMigrationTs` and `hasMigrationTs` are unchanged by this spec (and are a separate concern — see `migration-emit-unification.md`).

### Target implementations

**Postgres** keeps its descriptor-based plan shape internally:

```typescript
// packages/3-targets/3-targets/postgres/src/core/migrations/scaffolding.ts

type PostgresPlan = readonly OperationDescriptor[];

export const postgresScaffolding: MigrationScaffoldingCapability<PostgresPlan> = {
  renderTypeScript(plan, context) {
    const preamble = renderPreamble(plan, context); // private module helper
    const body = plan.map(renderDescriptor);         // private module helper
    return [
      ...preamble,
      '',
      'export default () => [',
      ...body.map((c) => `  ${c},`),
      ']',
      '',
    ].join('\n');
  },
};
```

Private helpers (`renderPreamble`, `renderDescriptor`, `serializeQueryInput`) stay in the scaffolding module — they are implementation details of this target's emission strategy.

Postgres's scaffolder currently emits imports of `@prisma-next/target-postgres/migration-builders` (with a destructured `createBuilders<Contract>()` call and a bare `TODO` identifier for `dataTransform` slots). That module does not exist in the codebase today — no source, no export, no consumer. The Postgres scaffolder is aspirational paint for a migration-authoring flow that hasn't been built. This spec does not change what Postgres emits; a scaffolded Postgres `migration.ts` would fail to resolve at evaluation time with a module-not-found error, which is the status quo. Building `migration-builders`, adopting `placeholder` (per `data-transform-placeholder.md`), and wiring Postgres into a production authoring flow are separate tasks.

**Mongo** is the only class-flow target with a live authoring surface:

```typescript
// packages/3-mongo-target/1-mongo-target/src/core/scaffolding.ts

type MongoPlan = readonly OperationDescriptor[];

export const mongoScaffolding: MigrationScaffoldingCapability<MongoPlan> = {
  renderTypeScript(plan, context) {
    const preamble = renderPreamble(plan, context); // private module helper
    const body = plan.map(renderDescriptor);         // private module helper
    return [...preamble, '', 'export default () => [', ...body.map((c) => `  ${c},`), ']', ''].join('\n');
  },
};
```

The `TPlan` generic makes the SPI plan-agnostic, so a future refactor can retype Mongo's plan as `readonly OpFactoryCall[]` (the family-internal tagged-union representation) and rewrite `renderTypeScript` to emit the class-style file Mongo actually runs (`class extends Migration { describe() {...} plan() {...} }` + `Migration.run(import.meta.url, Class)` footer) without touching the framework. That rewiring depends on Mongo exposing its own planner capability that produces `OpFactoryCall[]`, and is out of scope here. What matters for this spec is that the SPI can express either shape.

### Expected layout after the refactor

```
packages/
  1-framework/1-core/framework-components/src/
    control-migration-types.ts       # SPI: single-method MigrationScaffoldingCapability
  1-framework/3-tooling/migration/src/
    migration-ts.ts                  # ~50 lines; file I/O + delegation only
  3-targets/3-targets/postgres/src/core/migrations/
    scaffolding.ts                   # descriptor-based plan, single renderTypeScript
  3-mongo-target/1-mongo-target/src/core/
    scaffolding.ts                   # OpFactoryCall-based plan, single renderTypeScript
scripts/
  lint-framework-target-imports.mjs  # retained as regression guardrail
```

### Lint guardrail

The custom lint script `scripts/lint-framework-target-imports.mjs` (added in the earlier pass) greps `packages/1-framework/**` for any occurrence of `@prisma-next/target-`. It's retained: after this refactor no such strings should exist in framework code, so the script becomes a regression guardrail rather than catching extant violations. Its docstring is updated to reflect that role.

## Implementation plan

Each phase is independently landable; the whole set is one PR's worth of work.

### Phase 1 — SPI change

1. In `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`:
   - Replace `MigrationScaffoldingCapability` with the single-method generic version above.
   - Shrink `MigrationScaffoldContext` to `{ packageDir, contractJsonPath? }`.
   - Leave `OperationDescriptor`, `planWithDescriptors`, `resolveDescriptors` untouched — those are orthogonal.
2. Update `src/exports/control.ts` to re-export the (same-named, new-shaped) types.
3. Rebuild `framework-components`.

### Phase 2 — Framework utility

1. Rewrite `scaffoldMigrationTs` to the pipe form above.
2. Update `ScaffoldOptions`: rename `descriptors` → `plan`, type as `unknown`.

### Phase 3 — Target implementations

1. Rewrite Postgres `scaffolding.ts` as a single `renderTypeScript` that wraps the existing private helpers. No behavioural change to the emitted file — the rearrangement is internal. The aspirational `migration-builders` import and bare `TODO` identifier continue to be emitted verbatim; replacing them with real authoring infrastructure is out of scope (see Non-goals).
2. Rewrite Mongo `scaffolding.ts` as a single `renderTypeScript`. Typed as `MigrationScaffoldingCapability<readonly OperationDescriptor[]>` for now — matches the data shape the existing code already consumes. The generic `TPlan` parameter on the SPI means a future pass can retype Mongo to `readonly OpFactoryCall[]` (and swap to the class-style `Migration.run` renderer) without framework changes; that rewiring is not done here.

### Phase 4 — Call sites

1. `migration-plan.ts`: pass `plan: descriptorResult.descriptors` instead of `descriptors: ...`. No other change.
2. `migration-new.ts`: pass `plan: []` (empty plan). Targets produce a blank-but-valid stub when given an empty plan.

### Phase 5 — Tests

1. Rewrite `packages/3-targets/3-targets/postgres/test/migrations/scaffolding.test.ts` around full-file assertions. One test per interesting shape: empty plan (stub), one descriptor family, data-transform with typed-contract builders.
2. Rewrite `packages/3-mongo-target/1-mongo-target/test/scaffolding.test.ts` the same way — asserting on full class-style file content.
3. No framework-side scaffolding unit tests needed; `migration-ts.ts` is a one-liner covered by the CLI e2e and the two target unit test suites.

### Phase 6 — Lint script docstring

Update `scripts/lint-framework-target-imports.mjs` header comment to note that it now acts as a regression guardrail — no known violations remain after this refactor.

### Verification

Full-repo: `pnpm lint`, `pnpm lint:deps` (includes the custom script), `pnpm typecheck`, Mongo + Postgres test suites, full rebuild, CLI journey tests.

## Non-goals

- **Removing `OperationDescriptor` from the framework.** `planWithDescriptors` and `resolveDescriptors` stay as-is; they are target-level capabilities with descriptor-flavoured signatures. Removing them is a separate task tied to eventually consolidating SQL on a non-descriptor plan shape.
- **Wiring Mongo scaffolding into a production flow.** This spec makes Mongo's scaffolding expressible in its native plan shape; it doesn't introduce a `planMigration`-style capability for Mongo or connect it to a CLI command (see `migration-emit-unification.md` for the CLI side).
- **Retyping Mongo's plan to `OpFactoryCall[]`.** Mongo lands typed against `readonly OperationDescriptor[]` to stay close to what's implemented today. Swapping the plan shape and the renderer to produce `class extends Migration`-style files is follow-up work that depends on Mongo exposing its own planner.
- **Fixing or replacing Postgres's aspirational `migration-builders` emission.** The Postgres scaffolder emits imports of a module that doesn't exist (`@prisma-next/target-postgres/migration-builders`) and destructures a non-existent `createBuilders<Contract>()` factory with a bare `TODO` identifier for `dataTransform` slots. Those strings are left untouched. Building `migration-builders`, adopting `placeholder` (per `data-transform-placeholder.md`), and putting Postgres authoring on a reachable path are tracked separately.
- **Multi-file emission.** `renderTypeScript` returns a single string for a single file (`migration.ts`). If a future target needs to emit companion files (a `migration.sql` preview, for instance), the return type can widen without breaking existing targets. Out of scope here.
- **Environment-agnostic file I/O.** `scaffoldMigrationTs` still uses `node:fs/promises` for the write. The indirection through the capability keeps runtime-swappability possible in the future (swap the framework wrapper, not every target's renderer) but this spec doesn't introduce the swap point.
- **Runtime plan-shape validation.** The framework doesn't verify that the `unknown` plan matches what the target's `renderTypeScript` expects. The target is responsible for its own downcast. A runtime-checking layer is available to targets that want it, but not mandated.

## Open questions

1. **Should the `TPlan` generic surface in `TargetMigrationsCapability`?** Keeping it on the capability means internally-typed targets get full type safety across planner / scaffolder / resolver; at the CLI boundary it erases to `unknown`. Alternative: keep `TPlan` only on `MigrationScaffoldingCapability` and let targets discipline their own internals. Recommendation: keep it threaded through `TargetMigrationsCapability` — zero cost at the framework and free safety inside targets.
2. **Empty-plan stubs.** When `migration new` invokes scaffolding with an empty plan, what should the target emit? For descriptor-flow targets a stub with `export default () => []` plus a comment. For class-flow targets a stub Migration class. These conventions live in each target's scaffolder. Non-normative for the spec; worth pinning in a style guide if the two targets diverge too far.
3. **Do we publish the `placeholder` import alongside `scaffolding`?** See `data-transform-placeholder.md`. The placeholder utility is an implementation detail of each target's `renderTypeScript` — it embeds `placeholder(...)` string literals inside whatever text it produces. No SPI change required, and no framework-level awareness of placeholder semantics.

## Relationship to other specs

- **`data-transform-placeholder.md`** — complementary. The placeholder utility is what each target's `renderTypeScript` emits into data-transform slots when the planner couldn't produce a query. The two specs are independent in code — the scaffolding SPI changes don't affect the placeholder mechanism, and vice versa — but should land together, since the placeholder adoption is the natural payload for the rewritten scaffolders.
- **`migration-emit-unification.md`** — complementary. That spec renames `migration verify` → `migration emit`, unifies `plan` to always run emit inline, and dispatches on descriptor-capability presence. It depends on this spec only insofar as both rewrite scaffolders; otherwise independent. Recommend landing scaffolding first so the emit-flow rewrite can assume the new SPI.
- **`data-transform-check-unification.md`** — orthogonal. That spec unifies data-transform checks with DDL pre/post checks. No interaction with scaffolding.
- **`migration-subsystem-refactor.spec.md`** — foundational base for all the above.
- **ADR 151 (Control Plane Descriptors)** — the descriptor/instance pattern these hooks extend. This spec tightens the SPI surface; it does not touch the descriptor core.
- **`.cursor/rules/directory-layout.mdc`** — the layering rule this refactor reinforces. The lint guardrail (`scripts/lint-framework-target-imports.mjs`) is the automated enforcement for the string-encoded-import escape hatch.
- **`.cursor/rules/multi-plane-packages.mdc`** — targets expose scaffolding via the existing `/control` entry point; no new entry points needed.
