# Class-Flow Scaffolding: Unifying `Migration` and `MigrationPlan`

## Status

Draft. Addresses deferred review findings **F01 / F02 / F10** from `projects/mongo-migration-authoring/specs/reviews/pr-349/code-review.md` (class-flow scaffolding SPI for Mongo).

## TL;DR

- `Migration` (the abstract base class for class-flow migrations) will `implements MigrationPlan`. A class-flow migration **is** a plan.
- A new interface `MigrationPlanWithAuthoringSurface extends MigrationPlan` adds a `renderTypeScript(): string` method. `MigrationPlannerSuccessResult.plan` is tightened to this richer type — every planner result is renderable back to a user-editable `migration.ts`.
- `MigrationPlanner` gains an `emptyMigration(context): MigrationPlanWithAuthoringSurface` method. This lets `migration new` produce an empty authoring surface without knowing the target's authoring conventions.
- Postgres's planner result gains a throwing `renderTypeScript()` stub (descriptor-flow plans are never rendered back to TS in practice, but the interface is uniform). Postgres's `emptyMigration()` delegates to the existing scaffolding logic.
- Mongo's planner produces a `PlannerProducedMongoMigration` instance that holds `OpFactoryCall[]` and implements `renderTypeScript()` for real. User-authored Mongo migrations extend a thinner `MongoMigration` that only satisfies `MigrationPlan`.
- `MigrationScaffoldingCapability` is **removed from the public SPI**. Postgres's existing descriptor-rendering logic is demoted to a plain Postgres-internal function invoked from inside `PostgresMigrationPlanner.emptyMigration()`.
- A `migrationStrategy(migrations)` utility tells CLI commands (`migration plan`, `migration emit`) which authoring strategy the target uses ('descriptor' vs 'class-based') and dispatches accordingly. `migration new` does **not** need the selector — both strategies converge at `planner.emptyMigration()`.

## Background

### The gap today

Mongo authors migrations as a class that `extends Migration` (from `@prisma-next/migration-tools/migration-base`). Postgres authors migrations as an array of operation descriptors (`export default () => [...]`). These are two distinct authoring strategies:

- **Descriptor flow (Postgres)**: target exposes `planWithDescriptors`, `resolveDescriptors`, and a `MigrationScaffoldingCapability` with `renderTypeScript(plan, ctx)`. `migration emit` reads the exported array and calls `resolveDescriptors` to materialise `ops.json`.
- **Class flow (Mongo)**: target exposes `emit(dir, ...)` which dynamically `import`s the file, instantiates the class, and writes `ops.json`. `migration.ts` is runnable directly (shebang + executable permissions) via `Migration.run(...)`.

`migration emit` already dispatches between these two strategies by switching on the presence of `resolveDescriptors` vs `emit` on the target's `TargetMigrationsCapability`. Two other CLI commands are still hardwired to the descriptor flow:

- `migration plan` — calls `migrations.planWithDescriptors` and feeds the result into `migrations.scaffolding.renderTypeScript(plan, ctx)` to produce the initial `migration.ts`.
- `migration new` — requires `migrations?.scaffolding` and calls its `renderTypeScript(emptyPlan, ctx)` to produce an empty stub.

For Mongo today this means:

- `migration plan --target mongo` throws "target does not support descriptor-based planning".
- `migration new --target mongo` throws "target does not support scaffolding".

Users have to hand-write Mongo migration files. That's the gap this spec closes.

### Why the existing scaffolding SPI does not fit

`MigrationScaffoldingCapability.renderTypeScript(plan, ctx)` was designed around the descriptor flow, where `plan` is a structurally inspectable value separate from any class. For class-flow authoring the situation is different:

- The output of planning is itself the authoring artifact (a `Migration` subclass with ops + metadata baked in).
- The planner holds the richer internal state (`OpFactoryCall[]`) needed for rendering and does not want to surface that through a generic capability interface.
- Treating rendering as a method on the plan itself avoids passing a separate `TPlan` payload around — the plan knows how to render itself.

### Why `Migration` should implement `MigrationPlan`

The `plan()` method on `Migration` today already returns an array of operations. Those operations are **runnable framework operations** (e.g. `MongoMigrationPlanOperation[]`), exactly the shape that `MigrationPlan.operations` exposes. `describe()` on `Migration` provides the `from`/`to` hashes that populate `MigrationPlan.origin` and `MigrationPlan.destination`.

So a class-flow `Migration` already *is* a `MigrationPlan` structurally; we just need to wire up the interface and name the accessors consistently.

### Why the CLI should not know how to render an empty stub

The previous draft of this spec had the CLI emit an empty Mongo class-flow stub itself (`renderEmptyClassFlowMigration({ className })`). That is the wrong layer: knowing what imports to emit, what class name conventions to follow, and what placeholder values to use is a target concern. The CLI should ask the target for an empty authoring surface and stay out of the rendering business. This motivates `planner.emptyMigration(context)`, which each target implements according to its own conventions.

## Decisions

1. **`Migration` becomes a `MigrationPlan`.** The base class `implements MigrationPlan`. `plan()` is renamed to a readonly `get operations()` getter. Origin/destination are default-implemented from `describe()`, which becomes abstract.
2. **A new `MigrationPlanWithAuthoringSurface extends MigrationPlan`** adds `renderTypeScript(): string`. Kept as a separate interface so consumers that do not need the authoring surface (`MigrationRunner`, `db update`, `db init`) still depend only on the narrower shape.
3. **`MigrationPlannerSuccessResult.plan` is tightened to `MigrationPlanWithAuthoringSurface`.** Every target's planner result is statically renderable back to TypeScript. Targets that cannot render (Postgres's descriptor-flow plan) implement a throwing stub — a contained fiction, explicitly acknowledged, that disappears whenever one strategy is consolidated on.
4. **`MigrationPlanner` gains `emptyMigration(context)`.** Returns a `MigrationPlanWithAuthoringSurface` representing an empty, user-editable stub. Both targets implement this; `migration new` calls it uniformly.
5. **`MigrationScaffoldingCapability` is removed from the public SPI.** Postgres's rendering logic becomes a plain Postgres-internal function, called from `PostgresMigrationPlanner.emptyMigration()`. `TargetMigrationsCapability.scaffolding` is deleted.

   **Deviation from this decision (shipped):** `TargetMigrationsCapability` retains a narrow optional hook, `renderDescriptorTypeScript?(descriptors, context): string`, used exclusively by the descriptor-flow branch of `migration plan` to render *populated* descriptors (the case `emptyMigration()` does not cover by construction). This is the minimal change that avoids the larger refactor of making Postgres's `plan(...)` return a plan that holds the descriptors and renders itself — which would require teaching the planner to compute descriptors and operations in a single call. See [§Out of scope](#out-of-scope) for that follow-up. The hook is single-implementer (Postgres) and disappears whenever `migration plan` is unified across strategies.
6. **A strategy selector** (`migrationStrategy(migrations)`) returns `'descriptor'` or `'class-based'`. Used by `migration plan` and `migration emit`; **not** used by `migration new`.
7. **Postgres is lightly touched.** One method on the plan result (`renderTypeScript()` throwing NYI), one method on the planner (`emptyMigration()`), and the demotion of `postgresScaffolding` from a framework capability to a Postgres-internal module. No behaviour change visible to existing Postgres users.
8. **Mongo's descriptor-style `scaffolding.ts` is deleted.** It is dead code that conflates descriptor flow with a target that chose the class flow.

## Scope

### In scope

- `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`:
  - Add `MigrationPlanWithAuthoringSurface` interface.
  - Tighten `MigrationPlannerSuccessResult.plan` from `MigrationPlan` to `MigrationPlanWithAuthoringSurface`.
  - Add `emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface` to `MigrationPlanner`.
  - Remove `MigrationScaffoldingCapability` interface and `TargetMigrationsCapability.scaffolding` field. Retain a narrow `renderDescriptorTypeScript?(descriptors, context): string` on `TargetMigrationsCapability` for descriptor-flow targets to render *populated* descriptors during `migration plan` (see Decision §5).
  - `MigrationScaffoldContext` stays — it's the `emptyMigration(...)` parameter — and gains `fromHash: string` and `toHash: string` so class-flow targets can populate the rendered stub's `describe()` correctly. Without these, the rendered stub would have `describe()` returning `{ from: '', to: '' }` and the user would have to edit both values by hand before emit.
- `packages/1-framework/3-tooling/migration/src/migration-base.ts`: refactor `Migration` to implement `MigrationPlan`.
  - Add abstract `readonly targetId: string`.
  - Replace `abstract plan()` with `abstract get operations()`.
  - Promote `describe()` from `() => MigrationMeta | undefined` to `abstract describe(): MigrationMeta`. Every class-flow migration must produce its own manifest metadata.
  - Add default-implemented `get origin()` / `get destination()` derived from `describe()`.
  - Update `Migration.run(...)` / `serializeMigration(...)` to read `instance.operations` and to unconditionally write `migration.json` (the old "skip manifest when `describe()` returns undefined" branch disappears with the type change).
- `packages/3-mongo-target/1-mongo-target/src/core/mongo-migration.ts` (new): `MongoMigration` concrete subclass users extend. Pins the operation type parameter to `MongoMigrationPlanOperation` and sets `targetId = 'mongo'`.
- `packages/3-mongo-target/1-mongo-target/src/core/planner-produced-migration.ts` (new): internal subclass `PlannerProducedMongoMigration` that holds `OpFactoryCall[]` + `MigrationMeta` and implements `MigrationPlanWithAuthoringSurface`:
  - `get operations() { return renderOps(this.calls); }`
  - `renderTypeScript() { return renderCallsToTypeScript(this.calls, this.meta); }`

  The class-to-TS rendering logic moves here out of the existing `render-typescript.ts` (which today is reached via `MigrationScaffoldingCapability`).
- `packages/3-mongo-target/1-mongo-target/src/core/mongo-planner.ts`:
  - `plan(...)` returns `{ kind: 'success', plan: new PlannerProducedMongoMigration(...) }` instead of the anonymous object literal.
  - Add `emptyMigration(_ctx)` returning an empty `PlannerProducedMongoMigration` with empty ops and empty metadata (the user edits placeholders in).
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`:
  - `plan(...)` result's `plan` gains a `renderTypeScript(): string` method that throws a structured CLI error (`errorPlanDoesNotSupportAuthoringSurface({ targetId: 'postgres', hint: 'descriptor-flow target; authoring surface is produced by emptyMigration() during migration new' })`). This is dead code in practice — no descriptor-flow CLI path invokes it — but satisfies the interface.
  - Add `emptyMigration(context)` that delegates to the existing scaffolding logic (pre-renders the empty TS source by calling the function currently in `scaffolding.ts`) and returns a `MigrationPlanWithAuthoringSurface` with `operations: []`, dummy identity fields, and `renderTypeScript: () => tsSource`.
- `packages/3-targets/3-targets/postgres/src/core/migrations/scaffolding.ts`:
  - Demote from a framework `MigrationScaffoldingCapability` to a plain Postgres-internal function (for example `renderPostgresEmptyTypeScript(descriptors, context): string`). Remove the capability boxing (`postgresScaffolding`) and any framework-level registration.
- `packages/3-targets/3-targets/postgres/src/exports/control.ts`: stop registering `scaffolding` on the Postgres `TargetMigrationsCapability`.
- `packages/1-framework/3-tooling/cli/src/lib/migration-strategy.ts` (new): export a `migrationStrategy(migrations)` utility that returns `'descriptor'` or `'class-based'` based on which capability methods are present, with a clear structured error if the target supports neither.
- `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`: remove strategy branching. Unified flow:
  ```ts
  const planner = migrations.createPlanner(family);
  const empty = planner.emptyMigration({ packageDir, contractJsonPath });
  await writeMigrationPackage(packageDir, manifest, empty.operations);
  await writeMigrationTs(packageDir, empty.renderTypeScript(), { executable: ... });
  ```
  Remove the `migrations.scaffolding` guard entirely.
- `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts`: branch on `migrationStrategy(migrations)`.
  - Descriptor branch: existing flow (`planWithDescriptors` + Postgres-internal rendering via the demoted scaffolding function, invoked through `planner.emptyMigration()` equivalents or a bespoke plan path — concrete wiring is "unchanged behaviour, updated call site").
  - Class branch: `planner.plan(...)`, then `result.plan.renderTypeScript()`.
- `packages/1-framework/3-tooling/cli/src/lib/migration-emit.ts`: refactor the inline `if (resolveDescriptors) ... else if (emit) ...` dispatch to use `migrationStrategy(migrations)`. Behaviour and error semantics unchanged.
- Delete `packages/3-mongo-target/1-mongo-target/src/core/scaffolding.ts` and any references.
- Update `examples/mongo-demo/migrations/*/migration.ts` to extend `MongoMigration` and override `get operations()` (replacing `override plan()`).
- Update internal call sites and tests that reference `.plan()` on `Migration` subclasses or rely on `MigrationScaffoldingCapability`.

### Out of scope

- Unifying `migration plan` across strategies. Making Postgres's `planner.plan(...)` return a renderable plan (and removing the strategy selector there) would require Postgres's planner to compute descriptors **and** operations in a single call, which is a larger internal change. `migration plan` keeps the strategy selector for now.
- F11 (Mongo real-database E2E for data transforms) — separate follow-up.
- `MigrationHints`, `fromContract`/`toContract` hashing — addressed in `migration-package-polish.md`.
- Any behavioural change to `migration emit` beyond routing it through the shared selector.
- Removing the strategy selector entirely. It remains necessary for `migration plan` and `migration emit`.

## Design

### `MigrationPlan`, `MigrationPlanWithAuthoringSurface`, and the planner

In `control-migration-types.ts`:

```ts
export interface MigrationPlan {
  readonly targetId: string;
  readonly origin?: { readonly storageHash: string; readonly profileHash?: string } | null;
  readonly destination: { readonly storageHash: string; readonly profileHash?: string };
  readonly operations: readonly MigrationPlanOperation[];
}

/**
 * A migration plan that can serialise itself to a user-editable TypeScript
 * file. Returned by every planner from `plan(...)` and `emptyMigration(...)`.
 * Consumers that only execute plans (e.g. MigrationRunner, `db update`,
 * `db init`) continue to depend on the narrower `MigrationPlan` and never
 * call `renderTypeScript()`.
 */
export interface MigrationPlanWithAuthoringSurface extends MigrationPlan {
  renderTypeScript(): string;
}

export interface MigrationPlannerSuccessResult {
  readonly kind: 'success';
  readonly plan: MigrationPlanWithAuthoringSurface;
}

export interface MigrationScaffoldContext {
  readonly packageDir: string;
  readonly contractJsonPath?: string;
  /** Storage hash of the "from" contract; populates the rendered class's `describe().from`. */
  readonly fromHash: string;
  /** Storage hash of the "to" contract; populates the rendered class's `describe().to`. */
  readonly toHash: string;
}

export interface MigrationPlanner<F extends string = string, T extends string = string> {
  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<F, T>>;
  }): MigrationPlannerResult;

  /**
   * Produce an empty, user-editable authoring surface for `migration new`.
   * The returned plan has empty `operations` and placeholder/empty identity
   * fields — its sole purpose is `renderTypeScript()`.
   */
  emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface;
}
```

`MigrationScaffoldingCapability` and `TargetMigrationsCapability.scaffolding` are removed from `control-migration-types.ts`.

### `Migration` base class

In `packages/1-framework/3-tooling/migration/src/migration-base.ts`:

```ts
import type {
  MigrationPlan,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';

export abstract class Migration<
  TOperation extends MigrationPlanOperation = MigrationPlanOperation,
> implements MigrationPlan
{
  abstract readonly targetId: string;

  abstract get operations(): readonly TOperation[];

  abstract describe(): MigrationMeta;

  get origin(): MigrationPlan['origin'] {
    const meta = this.describe();
    if (!meta.from) return null;
    return { storageHash: meta.from };
  }

  get destination(): MigrationPlan['destination'] {
    const meta = this.describe();
    return { storageHash: meta.to };
  }

  static run(importMetaUrl: string, MigrationClass: new () => Migration): void {
    // unchanged entrypoint guard; serializeMigration reads instance.operations and
    // unconditionally writes migration.json from instance.describe().
  }
}
```

`Migration.run(...)` / `serializeMigration(...)` reads `instance.operations` in place of `instance.plan()`, and — because `describe()` is now abstract and non-optional — unconditionally parses its result and writes `migration.json` alongside `ops.json`. The old `if (rawMeta !== undefined)` branch is removed; a migration that refuses to describe itself is no longer expressible.

`describe()` is made abstract deliberately. `Migration implements MigrationPlan`, and `MigrationPlan.destination` is non-optional — a `Migration` that cannot describe itself cannot satisfy the interface. There is also no operational scenario in which a migration should write `ops.json` without `migration.json`: the package is invalid without the manifest, and every flow (`apply`, attestation, graph reconstruction) requires it.

`Migration` deliberately does **not** declare `renderTypeScript`. User-authored subclasses (e.g. `MongoMigration`) do not need to round-trip to TS, and the compiler does not force them to. Only planner-produced subclasses (e.g. `PlannerProducedMongoMigration`) implement `MigrationPlanWithAuthoringSurface`.

### `MongoMigration` subclass (user-authored surface)

In `packages/3-mongo-target/1-mongo-target/src/core/mongo-migration.ts`:

```ts
import { Migration } from '@prisma-next/migration-tools/migration-base';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';

export abstract class MongoMigration extends Migration<MongoMigrationPlanOperation> {
  readonly targetId = 'mongo' as const;
}
```

User migrations become:

```ts
class AddPostsAuthorIndex extends MongoMigration {
  override get operations() {
    return [createIndex('posts', [{ field: 'authorId', direction: 1 }])];
  }
  override describe() {
    return { from: '...', to: '...', labels: ['add-index'] };
  }
}
```

### `PlannerProducedMongoMigration` (internal, with authoring surface)

In `packages/3-mongo-target/1-mongo-target/src/core/planner-produced-migration.ts`:

```ts
import type { MigrationPlanWithAuthoringSurface } from '@prisma-next/framework-components/control';
import type { MigrationMeta } from '@prisma-next/migration-tools/migration-base';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import { MongoMigration } from './mongo-migration';
import type { OpFactoryCall } from './op-factory-call';
import { renderCallsToTypeScript } from './render-typescript';
import { renderOps } from './render-ops';

export class PlannerProducedMongoMigration
  extends MongoMigration
  implements MigrationPlanWithAuthoringSurface
{
  constructor(
    private readonly calls: ReadonlyArray<OpFactoryCall>,
    private readonly meta: MigrationMeta,
  ) {
    super();
  }

  override get operations(): readonly MongoMigrationPlanOperation[] {
    return renderOps(this.calls);
  }

  override describe(): MigrationMeta {
    return this.meta;
  }

  renderTypeScript(): string {
    return renderCallsToTypeScript(this.calls, this.meta);
  }
}
```

`renderCallsToTypeScript(calls, meta)` is the logic currently living in `render-typescript.ts`; it is lifted out of the (now-deleted) `MigrationScaffoldingCapability` and called directly from this class.

### `MongoMigrationPlanner`

```ts
// plan(options): unchanged outer flow, but returns a PlannerProducedMongoMigration
plan(options) {
  const result = this.planCalls(options);
  if (result.kind === 'failure') return result;
  return {
    kind: 'success',
    plan: new PlannerProducedMongoMigration(result.calls, {
      from: originStorageHash,
      to: contract.storage.storageHash,
    }),
  };
}

// new: emptyMigration — uses context to populate identity fields on the stub
emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface {
  return new PlannerProducedMongoMigration([], {
    from: context.fromHash,
    to: context.toHash,
  });
}
```

`db update --dry-run` / `db init` already access `result.plan.operations` as a property; the `get operations()` getter preserves that API.

### `PostgresMigrationPlanner`

Two small additions:

```ts
// plan(...) unchanged except the returned plan object now includes renderTypeScript
plan(options): MigrationPlannerResult {
  const existingResult = /* ... */;
  if (existingResult.kind === 'failure') return existingResult;
  return {
    kind: 'success',
    plan: {
      ...existingResult.plan, // targetId, destination, operations
      renderTypeScript(): string {
        throw errorPlanDoesNotSupportAuthoringSurface({
          targetId: 'postgres',
          hint:
            'Postgres is a descriptor-flow target; its authoring surface is produced by emptyMigration() during `migration new` and by the descriptor-flow branch of `migration plan`',
        });
      },
    },
  };
}

// new
emptyMigration(context: MigrationScaffoldContext): MigrationPlanWithAuthoringSurface {
  const tsSource = renderPostgresEmptyTypeScript([], context); // the demoted scaffolding function
  return {
    targetId: 'postgres',
    destination: { storageHash: '' },
    operations: [],
    renderTypeScript: () => tsSource,
  };
}
```

`errorPlanDoesNotSupportAuthoringSurface(...)` is a structured CLI error (code `PN-CLI-*` or `PN-MIG-*`; exact code to be chosen during implementation) with actionable `hint` text so anyone who reaches it — in tests, or by future mis-wiring — sees immediately what went wrong.

### `postgresScaffolding` → internal function

The existing `postgresScaffolding: MigrationScaffoldingCapability<PostgresPlan>` object is dissolved. The inner `renderTypeScript(plan, context)` becomes a plain exported function:

```ts
// packages/3-targets/3-targets/postgres/src/core/migrations/scaffolding.ts
export function renderPostgresEmptyTypeScript(
  descriptors: readonly OperationDescriptor[],
  context: MigrationScaffoldContext,
): string {
  // body identical to today's postgresScaffolding.renderTypeScript
}
```

Called only from `PostgresMigrationPlanner.emptyMigration(...)` (and from the descriptor-flow branch of `migration plan`, which uses the existing descriptor-rendering path for the in-progress plan). No longer exported as a framework capability.

### Strategy selector

In `packages/1-framework/3-tooling/cli/src/lib/migration-strategy.ts`:

```ts
import type { TargetMigrationsCapability } from '@prisma-next/framework-components/control';
import { errorTargetHasIncompleteMigrationCapabilities } from '@prisma-next/errors/migration';

export type MigrationStrategy = 'descriptor' | 'class-based';

export function migrationStrategy(
  migrations: TargetMigrationsCapability,
  targetId: string,
): MigrationStrategy {
  if (migrations.resolveDescriptors) return 'descriptor';
  if (migrations.emit) return 'class-based';
  throw errorTargetHasIncompleteMigrationCapabilities({ targetId });
}
```

Callers handle "no migrations capability at all" *before* calling `migrationStrategy` — `migration plan` and `migration emit` already raise `errorTargetMigrationNotSupported` for that case at their command entry points, so the selector itself only sees a non-undefined capability and only has to discriminate between the two flows.

Used by `migration plan` and `migration emit`. **Not** used by `migration new` — that command's flow is unified via `planner.emptyMigration()`.

### CLI dispatch — `migration new`

Strategy-agnostic:

```ts
const planner = migrations.createPlanner(family);
const empty = planner.emptyMigration({ packageDir, contractJsonPath });
await writeMigrationPackage(packageDir, manifest, empty.operations); // empty.operations === []
await writeMigrationTs(packageDir, empty.renderTypeScript(), {
  shebang: shebangLineFor(runtime),
  executable: true,
});
```

The previous draft's `renderEmptyClassFlowMigration({ className })` CLI-local helper is deleted — the CLI no longer renders anything target-specific.

### CLI dispatch — `migration plan`

Still branches on strategy (unifying this across targets would require Postgres's `plan(...)` to produce both descriptors and operations in a single call; out of scope):

```ts
const strategy = migrationStrategy(migrations);
if (strategy === 'descriptor') {
  // existing flow: planWithDescriptors → descriptor-flow rendering via the
  // (now Postgres-internal) renderPostgresEmptyTypeScript-style helper
} else {
  const result = planner.plan({ contract, schema, policy, frameworkComponents });
  if (result.kind === 'failure') throw conflictsError(result.conflicts);
  const source = result.plan.renderTypeScript(); // typed, no guard needed
  await writeMigrationTs(migrationDir, source, {
    shebang: shebangLineFor(runtime),
    executable: true,
  });
  // attest/display as today via result.plan.operations and result.plan.destination
}
```

No `isMigrationPlanWithAuthoringSurface` guard. No runtime type check. `result.plan.renderTypeScript()` is statically typed — it just exists.

### CLI dispatch — `migration emit`

Still branches on strategy:

```ts
const strategy = migrationStrategy(ctx.migrations);
if (strategy === 'descriptor') return emitDescriptorFlow(dir, ctx.migrations, ctx);
const operations = await ctx.migrations.emit!({ dir, frameworkComponents: ctx.frameworkComponents });
const migrationId = await attestMigration(dir);
return { operations, migrationId };
```

The current inline `if (resolveDescriptors) ... else if (emit) ...` dispatch is mechanically equivalent to the selector; this refactor is purely for consistency.

### Deletion

- `packages/3-mongo-target/1-mongo-target/src/core/scaffolding.ts` is removed.
- Any target-registration code (control/data plane entry points) that attached `scaffolding` to Mongo's `TargetMigrationsCapability` stops doing so.
- Postgres's `postgresScaffolding` capability export is removed; Postgres's target-registration code stops attaching `scaffolding`.
- `MigrationScaffoldingCapability` interface and `TargetMigrationsCapability.scaffolding` field are removed from `control-migration-types.ts`. A narrow optional hook `TargetMigrationsCapability.renderDescriptorTypeScript?(descriptors, context): string` is retained, used only by Postgres for the descriptor-flow branch of `migration plan` (see Decision §5).
- `render-typescript.ts` (Mongo) stops being invoked via `MigrationScaffoldingCapability` and is instead called directly by `PlannerProducedMongoMigration.renderTypeScript()`. It can either stay in place as a plain module or be renamed — module export is `renderCallsToTypeScript`.
- CLI-local helper `renderEmptyClassFlowMigration` (and similar) is not introduced — was present in an earlier draft of this spec, explicitly avoided here.

## Acceptance criteria

1. **Framework types.**
  - `MigrationPlan` is unchanged.
  - `MigrationPlanWithAuthoringSurface` is exported from `@prisma-next/framework-components/control`.
  - `MigrationPlannerSuccessResult.plan` is typed `MigrationPlanWithAuthoringSurface`.
  - `MigrationPlanner.emptyMigration(context): MigrationPlanWithAuthoringSurface` is present on the framework interface.
  - `MigrationScaffoldingCapability` and `TargetMigrationsCapability.scaffolding` no longer exist. A narrow `TargetMigrationsCapability.renderDescriptorTypeScript?(descriptors, context): string` hook is retained for the descriptor-flow branch of `migration plan` (Postgres only).
  - `MigrationScaffoldContext` is the `emptyMigration(...)` parameter shape and carries `{ packageDir, contractJsonPath?, fromHash, toHash }` so class-flow targets can populate `describe()` on the rendered stub.
2. **`Migration` base class.**
  - `Migration implements MigrationPlan`.
  - `abstract get operations()` replaces `abstract plan()`.
  - `describe(): MigrationMeta` is abstract (no `| undefined`, no default implementation). Subclasses that previously relied on the default provide real metadata.
  - `get origin()` / `get destination()` are implemented from `describe()` without defensive throws — the type system guarantees a value.
  - `Migration.run(...)` reads `instance.operations` and unconditionally writes `migration.json` alongside `ops.json`.
  - The authoring surface migration tests (`migration-base.test.ts`) continue to pass.
3. **Mongo.**
  - `MongoMigration` is exported from the target's control entrypoint and pins `targetId = 'mongo'` and `TOperation = MongoMigrationPlanOperation`.
  - `PlannerProducedMongoMigration` is internal to `target-mongo` and implements `MigrationPlanWithAuthoringSurface`.
  - `MongoMigrationPlanner.plan(...).plan` is a `PlannerProducedMongoMigration` instance.
  - `MongoMigrationPlanner.emptyMigration({ packageDir, contractJsonPath })` returns a `PlannerProducedMongoMigration` with empty ops and empty metadata; its `renderTypeScript()` produces a valid Mongo class-flow stub the user can edit.
  - `packages/3-mongo-target/1-mongo-target/src/core/scaffolding.ts` no longer exists. No reference to `MigrationScaffoldingCapability` remains in the Mongo target.
  - Example `examples/mongo-demo/migrations/*/migration.ts` files extend `MongoMigration` and override `get operations()`.
4. **Postgres.**
  - `PostgresMigrationPlanner.plan(...).plan.renderTypeScript()` throws `errorPlanDoesNotSupportAuthoringSurface({ targetId: 'postgres', ... })`.
  - `PostgresMigrationPlanner.emptyMigration({ packageDir, contractJsonPath })` returns a `MigrationPlanWithAuthoringSurface` with `operations: []` whose `renderTypeScript()` returns the same string the old `postgresScaffolding.renderTypeScript([], ctx)` produced.
  - `postgresScaffolding` export is removed. The underlying rendering function (`renderPostgresEmptyTypeScript` or equivalent) remains as a plain Postgres-internal module function.
  - Existing Postgres migration-journey tests continue to pass unchanged — behaviour visible to users is identical.
5. **Strategy selector.**
  - `migrationStrategy(migrations, targetId)` returns `'descriptor'` for Postgres and `'class-based'` for Mongo.
  - Targets that register a migrations capability but implement neither `resolveDescriptors` nor `emit` throw the structured `errorTargetHasIncompleteMigrationCapabilities({ targetId })` (PN-MIG-2011).
  - The selector is used only by `migration plan` and `migration emit`; `migration new` does not import it.
6. **CLI commands.**
  - `migration new --target postgres ...` behaves identically to today (same file content, same exit codes). Internally the flow is `planner.emptyMigration(ctx).renderTypeScript()`.
  - `migration new --target mongo ...` succeeds and writes a runnable `migration.ts` (shebang + executable bit) whose class extends `MongoMigration`, implements `get operations()`, and has a `describe()` stub the user fills in.
  - `migration plan --target postgres ...` behaves identically to today.
  - `migration plan --target mongo ...` succeeds and writes a runnable `migration.ts` whose class extends `MongoMigration`, implements `get operations()`, and `describe()`s the correct `from`/`to` storage hashes.
  - `migration emit` dispatches via `migrationStrategy(migrations)` with behaviour unchanged.
7. **Tests.**
  - Unit tests for `migrationStrategy` cover: descriptor target, class target, incomplete target, undefined capability.
  - Unit tests for `PlannerProducedMongoMigration` cover: `operations` returns the expected runnable ops; `renderTypeScript()` produces a file that, when evaluated and imported, yields a class whose `operations` equals the original ops.
  - Unit tests for `MongoMigrationPlanner.emptyMigration(...)` and `PostgresMigrationPlanner.emptyMigration(...)` cover the empty-stub output.
  - Unit test for `PostgresMigrationPlanner.plan(...).plan.renderTypeScript()` asserting it throws the structured error.
  - CLI journey test for `migration new --target mongo` and `migration plan --target mongo` added under `test/integration/test/cli-journeys/`.
  - Existing Postgres CLI journey tests continue to pass unchanged.
8. **Docs.**
  - Any user-facing doc that describes how Mongo migrations are authored is updated to mention that `migration new` / `migration plan` now work and that the scaffolded class extends `MongoMigration`.

## Risks / open questions

1. **Structured-error code for the Postgres throwing stub.** Needs a code assignment — either re-use a generic CLI capability error or add a new one (`PN-MIG-*`). Decision deferred to implementation.
2. **`Migration.run(...)` shebang choice at scaffold time.** Already decided (per `migration-package-polish.md`): the scaffold picks a single runtime per project at scaffold time (Node / Bun / Deno) via `detectScaffoldRuntime` and emits the corresponding shebang. That decision is inherited unchanged.
3. **`MongoMigration` placement.** Lives in `packages/3-mongo-target/1-mongo-target/src/core/mongo-migration.ts` and is re-exported from the target's `/migration` entrypoint. Not moved to the Mongo family package — the base `Migration` class already sits in framework tooling and there is no other Mongo-family consumer.
4. **`TOperation` type parameter on `Migration`.** Kept generic because the base class has no way to know the target's runtime op type, but defaulted to `MigrationPlanOperation` so most consumers do not have to think about it. Mongo pins it in `MongoMigration`.
5. **Empty-plan identity fields.** `emptyMigration(context)` returns a plan with empty `operations`; its `destination` and `origin` carry the real `fromHash` / `toHash` threaded through `MigrationScaffoldContext`. The rendered stub's `describe()` is therefore correct out of the box — the user does not have to fix the manifest identity by hand before `migration emit`. (An earlier draft of this spec characterised these fields as inert dummies; that was wrong, and the implementation correctly carries real hashes.)
6. **The Postgres throwing stub as a contained fiction.** The interface statically promises that every `MigrationPlannerSuccessResult.plan` can render back to TS; Postgres's plan throws when asked. An audit of current CLI paths confirms no descriptor-flow path invokes `renderTypeScript()` on a `plan(...)`-produced plan, so the stub is dead code. The fiction will disappear when one strategy is consolidated on; we explicitly accept the two-target interim.
7. **Migration of `render-typescript.ts` (Mongo).** The module's function signature changes from `(plan, ctx) => string` (capability-shaped) to `(calls, meta) => string` (direct). Any tests that exercise it via `MigrationScaffoldingCapability` are rewritten to call the new function directly.
8. **Compatibility.** This is a breaking change to `Migration`'s authoring surface (`plan()` → `get operations()`) and to `TargetMigrationsCapability` (removal of `scaffolding`). Example migrations, internal targets, and docs are updated in the same change. External consumers outside this repo are not a concern at this stage.

## References

- Review findings: `projects/mongo-migration-authoring/specs/reviews/pr-349/code-review.md` (items **F01**, **F02**, **F10**).
- Prior specs in the same project:
  - `migration-scaffolding-redesign.md`
  - `migration-emit-unification.md`
  - `placeholder-utility.md`
  - `migration-package-polish.md`
