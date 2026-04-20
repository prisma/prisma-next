# Migration Emit Unification

## Context

The CLI has three migration-authoring commands today:

- **`migration new`** — scaffolds an empty `migration.ts` and a manifest, ready for the user to hand-author operations.
- **`migration plan`** — diffs current contract against target, runs the target's descriptor-based planner, scaffolds a `migration.ts`, and — if the planner reports `needsDataMigration: false` — inline-finishes by evaluating the scaffolded file, calling `resolveDescriptors`, writing `ops.json`, and attesting. When `needsDataMigration: true`, the command stops after scaffolding and tells the user to run `migration verify`.
- **`migration verify`** — if `migration.ts` exists, evaluates it, calls `resolveDescriptors`, writes `ops.json`; then computes the `migrationId` hash and either compares (`verified`) or writes (`attested`) it in `manifest.json`.

Two issues with the current design:

1. **`migration verify` is misnamed.** The command's primary behaviour is "emit `ops.json` from `migration.ts` and attest its hash" — a write-side operation. True verification ("does the stored `migrationId` match the current content?") is a read-side check, and the command only lands on that branch when `migration.ts` doesn't exist. The name misleads both users (who expect a read-only integrity check) and maintainers (who keep having to remember which branch does which).
2. **`needsDataMigration` is a descriptor-flow-specific hack.** It exists because descriptor-flow targets can tell, at plan time, whether any of the descriptors they emitted will need user-authored query bodies (via `TODO` sentinels or similar). Class-flow targets have no equivalent signal — the class's `plan()` method is opaque to the framework. The flag doesn't translate across strategies, and it burdens the framework's CLI with branching on a target-specific concept.

With the `placeholder(...)` utility introduced by `data-transform-placeholder.md`, there's a cleaner mechanism: any scaffolded file with unfilled slots will throw a structured `CliStructuredError` (`PN-MIG-2001`) when evaluated. The framework doesn't need a pre-declared flag; it runs the same pipeline unconditionally and lets the placeholder throw if there's nothing yet to emit.

This spec renames `migration verify` → `migration emit`, unifies `migration plan` to always run emit inline, removes `needsDataMigration` from the descriptor-flow SPI, and adds a target-owned dispatch step inside emit so that class-flow targets (Mongo) can emit from their `migration.ts` via an in-process capability they implement themselves — the `Migration` class exported by the file is loaded, instantiated, and invoked inside the CLI's own process, so structured errors (including `errorUnfilledPlaceholder`) propagate as real JS exceptions.

## Problem

### `verify` conflates three concerns

The current `migration verify` command does three things in sequence (see `packages/1-framework/3-tooling/cli/src/commands/migration-verify.ts`):

1. **Emit.** Evaluate `migration.ts`, call `resolveDescriptors`, write `ops.json`.
2. **Attest.** Call `attestMigration(dir)` to compute and persist `migrationId`.
3. **Verify.** Call `verifyMigration(dir)` to compare stored vs. computed `migrationId`.

Step 3 is the only read-only one. In practice it's dominated by step 1, which *rewrites* `ops.json` on every invocation — so any stored `migrationId` mismatch is routinely resolved by silently re-attesting. The resulting semantics are: "recompute everything, overwrite everything, write a hash." That's emit + attest, not verify. The command's name has outlived its original meaning.

### `needsDataMigration` is strategy-specific

`TargetMigrationsCapability.planWithDescriptors` returns, for the descriptor-flow planner:

```ts
| { ok: true; descriptors: readonly OperationDescriptor[]; needsDataMigration: boolean }
| { ok: false; conflicts: readonly MigrationPlannerConflict[] };
```

`migration plan` consumes `needsDataMigration` to decide whether to stop after scaffolding (let the user fill in `dataTransform` bodies and then run `verify`) or to inline-finish. Two problems:

- **Class-flow targets can't produce it.** Mongo's migration pipeline, once scaffolded as a class, has no framework-level signal for "this class contains placeholders" other than *trying to run it*. The flag would be silently missing or always-false, and the CLI branch that keys on it would be incoherent.
- **The signal is redundant with the placeholder throw.** If the scaffolded file has unfilled slots, invoking its query bodies throws a structured error (`CliStructuredError` with code `3040` from `errorUnfilledPlaceholder`). The CLI already knows how to surface such errors. We don't need a separate "is this finishable" flag — just try to finish, and let errors propagate.

### Dispatch is implicit and tangled

The CLI currently invokes `resolveDescriptors` and `evaluateMigrationTs` unconditionally under the "emit" path. Both are descriptor-flow mechanisms:

- `evaluateMigrationTs` today assumes the file's default export is a function returning an array of descriptors. A Mongo-style `class extends Migration {...}` file won't satisfy that contract.
- `resolveDescriptors` is declared on the target capability with a descriptor-shaped signature. Class-flow targets won't implement it.

A class-flow target needs its own "go from `migration.ts` → `ops.json` + attested `manifest.json`" path — one that understands how to find the `Migration` subclass in the file, instantiate it, call `describe()` / `plan()` (or whatever the target's class API is), serialize the resulting operations, write them, and attest. That dispatch path doesn't exist today; the CLI hard-codes the descriptor-flow pipeline.

## Design

### Rename: `migration verify` → `migration emit`

Rename the command binary-level entry. The file moves `migration-verify.ts` → `migration-emit.ts`, and the command name in `new Command('verify')` changes to `new Command('emit')`. Help text updates to describe what the command actually does: "Emit `ops.json` from `migration.ts` and compute `migrationId`."

No backwards-compatible alias. Grep confirms no internal callers of `migration verify` beyond the CLI itself and its tests; the rename is a straight substitution across the repo.

### `migration plan` always runs emit inline

The existing `if (needsDataMigration) { ... } else { evaluate + resolve + write + attest }` branch in `migration-plan.ts` collapses to the unconditional form:

```ts
await writeMigrationPackage(packageDir, manifest, []);
await scaffoldMigrationTs(packageDir, { plan, contractJsonPath, scaffolding });
await emitMigration(packageDir, { target, config, frameworkComponents });
```

If `migration.ts` contains unfilled placeholder slots, `emitMigration` throws a structured `errorUnfilledPlaceholder` error, which `plan` propagates. The user sees the structured envelope surfacing the exact slot and a "fill in the placeholder and re-run `migration emit`" fix.

If `migration.ts` has no placeholders, emit completes: `ops.json` written, `migrationId` attested, plan reports success with the resolved operations list.

### Target-owned class-flow capability

Class-flow emit cannot live in the framework: the framework doesn't know the class's shape, which methods it has, or how to serialize whatever `plan()` returns. Instead, the target exposes an optional `emit?()` capability on `TargetMigrationsCapability`, and the target owns the whole pipeline.

```ts
// control-migration-types.ts
export interface TargetMigrationsCapability<...> {
  // ...existing members...

  /**
   * Optional: emit `ops.json` from the target's authored `migration.ts`.
   * Invoked when the target does not implement `resolveDescriptors` (i.e.
   * it uses the class-based authoring pattern).
   *
   * The target is responsible for:
   *  - loading the file (dynamic import, path resolution);
   *  - locating the authored class;
   *  - invoking its `describe()` / `plan()` (or equivalent target-specific API);
   *  - serializing the returned operations into `MigrationPlanOperation[]`;
   *  - writing `ops.json` via the framework's `writeMigrationOps` helper.
   *
   * The target MUST NOT call `attestMigration(dir)` itself. Attestation
   * (computing and persisting `migrationId` in `manifest.json`) is owned by
   * the framework's `emitMigration` helper so there is a single source of
   * truth for when the hash is taken.
   *
   * Throws `CliStructuredError` for structured failures (including
   * `errorUnfilledPlaceholder` from `placeholder(...)` calls inside the
   * authored file). The framework propagates those errors as-is — no
   * subprocess layer, no stderr parsing, no exit-code translation.
   */
  emit?(options: {
    readonly dir: string;
    readonly frameworkComponents: ReadonlyArray<
      TargetBoundComponentDescriptor<TFamilyId, TTargetId>
    >;
  }): Promise<readonly MigrationPlanOperation[]>;
}
```

The return value (`readonly MigrationPlanOperation[]`) is the framework-level display-oriented operation list — same shape `resolveDescriptors` returns. That's what the CLI needs to render the plan summary (`id`, `label`, `operationClass`). How the target goes from its own internal class output to that list is target-internal.

#### Why in-process, not subprocess

Earlier drafts of this spec proposed spawning `node <dir>/migration.ts` as a subprocess. That was heavier and less precise:

- Structured errors (`CliStructuredError`, `errorUnfilledPlaceholder`) would have to cross the process boundary — either lost, serialized into stderr bytes, or re-parsed from a JSON envelope.
- Exit-code translation would lose the `code` discriminator; the CLI would see "exit 1" and have to guess what happened.
- Extra process fork cost per emit.
- Mocking and testing would need subprocess plumbing.

In-process dispatch avoids all of this. The target's `emit?` implementation uses `await import(fileUrl)` (pointing at `<dir>/migration.ts`), finds the authored class on the module's default export, and drives it directly. `errorUnfilledPlaceholder` propagates via normal JS exception handling; the CLI catches by `CliStructuredError.is(error)` and `error.code === '2001'` (envelope `PN-MIG-2001`) with full fidelity.

The file's existing `Migration.run(import.meta.url, Class)` side-effect at the bottom of `migration.ts` becomes conditional: it fires only when the file is invoked directly (`node migration.ts`), not when it's imported by the CLI. The target implements this guard inside `Migration.run` (compare `import.meta.url` against `process.argv[1]` or equivalent).

### Shared `emitMigration` helper

Extract the emit body into a shared helper used by both `migration plan` (inline) and `migration emit` (standalone):

```typescript
// packages/1-framework/3-tooling/cli/src/lib/migration-emit.ts

export interface EmitMigrationResult {
  readonly operations: readonly MigrationPlanOperation[];
  readonly migrationId: string;
}

export async function emitMigration(
  dir: string,
  ctx: EmitContext,
): Promise<EmitMigrationResult> {
  const migrations = getTargetMigrations(ctx.config.target);
  if (!migrations) {
    throw errorTargetMigrationNotSupported({ why: `Target "${ctx.config.target.targetId}" does not support migrations` });
  }

  if (migrations.resolveDescriptors) {
    return emitDescriptorFlow(dir, migrations, ctx);
  }
  if (migrations.emit) {
    const operations = await migrations.emit({ dir, frameworkComponents: ctx.frameworkComponents });
    const migrationId = await attestMigration(dir);
    return { operations, migrationId };
  }
  throw errorTargetMigrationNotSupported({
    why: `Target "${ctx.config.target.targetId}" does not implement either resolveDescriptors or emit`,
  });
}
```

The helper returns both the display-oriented operations list and the content-addressed `migrationId` that `attestMigration` computed. Callers (`migration emit` and `migration plan`) need `migrationId` to render the success envelope without a follow-up manifest read, so exposing it directly keeps the data flow explicit and avoids a round-trip through `manifest.json`.

Dispatch order:

- **`resolveDescriptors` present** (Postgres today) — use the in-process framework pipeline: `evaluateMigrationTs` → `resolveDescriptors` → `writeMigrationOps` → `attestMigration`. On existing `ops.json`: KISS, just overwrite.
- **`emit` present** (Mongo's path) — the target does file loading, class evaluation, ops serialization, and `writeMigrationOps`, then returns the display-oriented operation list. The framework helper then calls `attestMigration(dir)` once and returns `{ operations, migrationId }`. Attestation is owned by the helper, not the target — `attestMigration` is content-addressed and idempotent, but running it in both the target and the helper is wasted work and split ownership.

The two capabilities are mutually exclusive in practice (a target picks one authoring strategy), but nothing in the SPI enforces that — if both are present, descriptor flow wins. The conflict is unlikely enough not to warrant extra ceremony.

The CLI command `migration emit` is then a thin wrapper:

```typescript
async function executeMigrationEmitCommand(options, flags, ui) {
  const config = await loadConfig(options.config);
  const frameworkComponents = assertFrameworkComponentsCompatible(...);
  const { operations, migrationId } = await emitMigration(options.dir, { config, frameworkComponents });
  return ok({ ok: true, dir: options.dir, operations, migrationId, ... });
}
```

### Remove `needsDataMigration` from the SPI

In `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`, drop `needsDataMigration` from `planWithDescriptors`'s success return:

```ts
planWithDescriptors?(context: {...}):
  | { ok: true; descriptors: readonly OperationDescriptor[] }
  | { ok: false; conflicts: readonly MigrationPlannerConflict[] };
```

Postgres's descriptor planner (`packages/3-targets/3-targets/postgres/src/core/migrations/descriptor-planner.ts`) stops computing and returning the flag. Test scenarios (`descriptor-planner.scenarios.test.ts` and `.scenarios.md`) drop their assertions on it. The flag is the sole consumer.

### Postgres-side behaviour in the unified flow

Postgres stays on the descriptor flow: `resolveDescriptors` present, `emit` absent, dispatch picks `emitDescriptorFlow`. For non-data-transform migrations the behaviour is identical to today (`ops.json` written, `migrationId` attested).

For Postgres migrations that *do* include a `dataTransform` descriptor, `emit` would fail at `evaluateMigrationTs` time with a module-not-found error — the Postgres scaffolder emits an import of `@prisma-next/target-postgres/migration-builders`, which does not exist in the codebase. That's the status quo: no production Postgres migration-authoring flow exists today. The CLI surfaces the module-not-found error as a generic runtime failure, and Postgres continues to be unexercised on this path until its authoring infrastructure lands. Deferred to `data-transform-placeholder.md`'s "target-postgres adoption" follow-up.

### Runner-side integrity check (deferred)

The original `verifyMigration` library function (compare stored vs. computed `migrationId`) is not called anywhere under the new design. It's the right mechanism for a runner-side integrity gate — "before applying, confirm the `ops.json` hasn't been tampered with or corrupted since attestation" — but `migration apply` doesn't currently call it.

This spec keeps `verifyMigration` in place but unused. Wiring it into `migration apply` is tracked as a follow-up; the concern is safety-critical but orthogonal to the rename and unification here.

## Implementation plan

### Phase 1 — Rename `verify` → `emit`

1. Rename `migration-verify.ts` → `migration-emit.ts` (in `packages/1-framework/3-tooling/cli/src/commands/`).
2. Replace `new Command('verify')` with `new Command('emit')`. Update descriptions, examples, and the formatter helper (`formatMigrationVerifyCommandOutput` → `formatMigrationEmitCommandOutput`).
3. Rename the exported factory: `createMigrationVerifyCommand` → `createMigrationEmitCommand`. Update the CLI root registration.
4. Rename result types: `MigrationVerifyOptions` / `MigrationVerifyResult` → `MigrationEmitOptions` / `MigrationEmitResult`. Drop the `status: 'verified' | 'attested'` discriminator — under the new design, emit's success semantics collapse to "emitted and attested." A single `status: 'emitted'` (or omit the field) is fine.
5. Update tests: `migration-verify.test.ts` → `migration-emit.test.ts`, plus any journey tests that invoke the command.

No backwards-compat alias. `pnpm lint` + `pnpm typecheck` should catch any stragglers.

### Phase 2 — Add `emit?` capability + extract `emitMigration` helper

1. Add `emit?` to `TargetMigrationsCapability` in `control-migration-types.ts`. Options: `{ dir, frameworkComponents }`. Return: `Promise<readonly MigrationPlanOperation[]>`.
2. Create `packages/1-framework/3-tooling/cli/src/lib/migration-emit.ts`.
3. Extract the descriptor-flow body currently in `executeMigrationVerifyCommand` and in the `else` branch of `migration-plan.ts` into a private `emitDescriptorFlow(dir, migrations, ctx)` function. Return value: `EmitMigrationResult` (i.e. `{ operations, migrationId }`).
4. Top-level `emitMigration` dispatches: descriptor flow if `resolveDescriptors` present; target's `emit?` if present (followed by a single `attestMigration` call owned by the helper); otherwise `errorTargetMigrationNotSupported`. Return type is `Promise<EmitMigrationResult>`.
5. `executeMigrationEmitCommand` becomes a thin wrapper around `emitMigration`, destructuring `{ operations, migrationId }` for its output envelope.

### Phase 3 — Mongo `emit` implementation

1. Add `emit` to Mongo's `TargetMigrationsCapability` implementation. Inside, `await import(pathToFileURL(join(dir, 'migration.ts')).href)` to load the authored file, locate the `Migration`-subclass default export, instantiate, invoke `describe()` + `plan()` (or Mongo's existing equivalent — reuse whatever `Migration.run` currently does internally for emit).
2. Guard `Migration.run(import.meta.url, Class)` to be a no-op when the file is being imported rather than executed as the main module (check `fileURLToPath(import.meta.url) === process.argv[1]` or similar). This prevents the side-effect from firing when the CLI imports the file.
3. Call `writeMigrationOps(dir, operations)` from Mongo's `emit`. **Do not** call `attestMigration` here — attestation is owned by the framework's `emitMigration` helper, and running it in both places is wasted work.
4. Return `readonly MigrationPlanOperation[]` shaped for CLI display.

### Phase 4 — Unify `migration plan`

1. Remove the `if (descriptorResult.needsDataMigration) { ... } else { ... }` branch in `migration-plan.ts`.
2. After `scaffoldMigrationTs`, unconditionally call `emitMigration(packageDir, ctx)`.
3. Map `emitMigration`'s result into `MigrationPlanResult`. If emit throws a structured error (e.g. `errorUnfilledPlaceholder`), propagate it — `plan` surfaces the same error.
4. Remove the now-stale summary message `"data migration required. Edit migration.ts and run \`migration verify\`…"`. The on-placeholder-error path will carry its own message from `errorUnfilledPlaceholder`.

### Phase 5 — Drop `needsDataMigration`

1. In `control-migration-types.ts`, remove `needsDataMigration` from the success variant of `planWithDescriptors`'s return type.
2. In `packages/3-targets/3-targets/postgres/src/core/migrations/descriptor-planner.ts`, stop computing and returning it.
3. Update `descriptor-planner.scenarios.test.ts` and `.scenarios.md` to drop assertions on the field.
4. `pnpm --filter @prisma-next/framework-components build` + `pnpm --filter @prisma-next/target-postgres build`.

### Phase 6 — Verification

- Full-repo `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`.
- Postgres CLI journey tests (descriptor flow, inline emit).
- Mongo: add an e2e test that exercises the full `migration plan` → inline emit → `ops.json` + attested `manifest.json` round trip for a class-flow migration. Include one test with an unfilled placeholder that asserts `PN-MIG-2001` propagates structurally.
- Verify that `migration plan` on a Postgres contract change without data transforms still completes end-to-end (ops.json written, migrationId stored) — same outcome as today, different code path.

## Non-goals

- **Runner-side integrity verification.** `migration apply` does not yet call `verifyMigration`. Adding that call is a distinct follow-up; this spec leaves `verifyMigration` in place (unreferenced by the CLI) for that future use.
- **Subprocess-based class-flow emit.** Ruled out (see "Why in-process, not subprocess"). If some future target genuinely needs a different runtime (Deno-only, sandboxed, etc.), it can implement its own `emit?` that spawns internally — the SPI is the boundary, and the framework has no opinion on what's inside it.
- **`migration new` changes.** `migration new` stays pure-scaffold: write an empty `migration.ts` stub, nothing else. The user edits, then runs emit themselves. No automatic emit from `new`.
- **Postgres migration-authoring flow.** This spec unifies plan/emit at the CLI level and adds the class-flow capability. Postgres's `resolveDescriptors` path continues to work; its `dataTransform` scaffolding continues to be aspirational paint (no production authoring flow exists). Building out Postgres's `migration-builders` module and its `createBuilders` factory is separate work.
- **Per-operation `ops.json` merging.** Emit unconditionally overwrites `ops.json`. No three-way merge, no preservation of hand-edits to the JSON. KISS: the source of truth is `migration.ts`; hand-editing `ops.json` is unsupported.
- **Retaining `verify` as an alias.** A breaking rename. No command alias, no deprecation period. The command is internal to the CLI and has no external consumers.

## Open questions

1. **Message on `plan`-inline emit failure.** When emit fails inside `plan` due to a placeholder, should `plan` say "planned, but needs data fill-in" (softening the framing) or just surface the raw `errorUnfilledPlaceholder`? The latter is simpler and honest. Leaning: raw propagation.
2. **Does `migration emit` need to know it's being called from `plan`?** If `plan` has already written a fresh manifest and an empty `ops.json`, calling `emit` over the top is a no-op on the manifest side but a full rewrite on the ops side. Worth confirming nothing in the emit path assumes a pre-attested baseline. Initial read says no.
3. **`hasMigrationTs` check.** `emit` currently guards its descriptor-flow body on `hasMigrationTs(dir)`. Under the unified model, the presence of `migration.ts` is a precondition for both flows — without it, there's nothing to emit. Decide whether to error "no migration.ts" explicitly or let the downstream evaluate / import fail naturally. Leaning: explicit error from the shared helper.
4. **Return shape of `emit?`.** Spec proposes `Promise<readonly MigrationPlanOperation[]>` so `plan` can render the operations summary after inline emit. Alternative: `Promise<void>` and let the CLI re-read `ops.json` after emit to produce the summary. Former saves a read and keeps the data flow explicit; latter keeps the capability signature simpler. Leaning: return the list.
5. **Where the target's `emit?` reads from.** The class-flow file path is always `<dir>/migration.ts`. Should the capability accept it as a separate argument, or always infer `dir + 'migration.ts'`? Leaning: pass `dir` only, infer the filename — consistent with how `hasMigrationTs`/`evaluateMigrationTs` already work.

## Relationship to other specs

- **`target-owned-migration-scaffolding.md`** — complementary. That spec changes the `MigrationScaffoldingCapability` SPI so targets own full file rendering (including the class-style template that Mongo needs). This spec adds the `emit?` capability so targets can also own class-flow evaluation + serialization. Together they give class-flow targets (Mongo) full ownership of their authoring surface — scaffold, evaluate, serialize, attest — without any framework knowledge of class shape. Recommend landing scaffolding first.
- **`data-transform-placeholder.md`** — complementary. The `placeholder(slot)` utility is what makes "emit throws naturally on unfilled slots" work end-to-end. Without it, we'd still need a separate signal (like `needsDataMigration`) because evaluating a file with `TODO` sentinels silently emits invalid ops rather than failing. Because emit runs in-process, the CLI catches `errorUnfilledPlaceholder` directly by `CliStructuredError.is(error)` / envelope `code === 'PN-MIG-2001'` with full structured fidelity — no stderr parsing, no exit-code translation. Both specs should land together.
- **`data-transform-check-unification.md`** — orthogonal. That spec unifies check semantics inside data-transform runtime; no interaction with CLI commands.
- **`migration-subsystem-refactor.spec.md`** — foundational base.
- **ADR 151 (Control Plane Descriptors)** — the capability pattern `resolveDescriptors` and `planWithDescriptors` sit on. This spec tightens the shape of the former's return type and adds a new `emit?` capability alongside them; it does not alter the capability pattern itself.
- **`.cursor/rules/multi-plane-packages.mdc`** — no new entrypoints required.
