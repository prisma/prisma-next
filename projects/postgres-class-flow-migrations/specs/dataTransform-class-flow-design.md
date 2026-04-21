# Class-flow `dataTransform` factory — design (v3)

**Status**: proposed (awaiting confirmation before implementation)
**Scope**: unblocks code-review findings F01 / F02 / F03 of `projects/postgres-class-flow-migrations/reviews/pr-2-flip/code-review.md`

## Changes from v2

- **Collapse `check` and `run` to one closure type** — `() => SqlQueryPlan | Buildable`. No `boolean` form. `check` is optional (`undefined` means "no check"); if present it must be a closure. *Conscious divergence from Mongo*: Mongo's `check` is `{ source: () => plan, filter?, expect?, description? }` and derives both a precheck and a postcheck from the same source. Postgres's first-cut surface keeps `check` as a single closure; if we later want precheck/postcheck semantics with auto-inverted filters we can expand the type without breaking the closure form (e.g. accept `() => plan | { source, expect }`).
- **New `PN-MIG-2005` for the contract-hash mismatch** — `errorDataTransformContractMismatch` in `@prisma-next/errors/migration`. Sits next to `errorUnfilledPlaceholder` (`PN-MIG-2001`) and the other authoring-time errors. *Not* `runtimeError('PLAN.HASH_MISMATCH', ...)` — that lives in `SqlFamilyAdapter.validatePlan` and produces `PN-RUN-*`, which is the wrong namespace when the error is surfaced at migration-authoring time (user looks it up → runtime docs, not migration docs). The two checks are semantically different: `validatePlan` rejects a plan at runtime execution; `dataTransform` rejects a plan at migration authoring. Type-level enforcement via a contract-typed `SqlQueryPlan<C, _Row>` remains a desirable follow-up.
- **Contract import modelled as a normal `ImportRequirement`** on `DataTransformCall` — no scaffolder preamble special-case. Requires extending `ImportRequirement` to support default imports + import attributes.
- **Contract artifacts copied into the migration dir, Mongo-parity, via a generic copy helper** — `copyContractToMigrationDir` (`packages/1-framework/3-tooling/migration/src/io.ts`) is over-specialized: it hard-codes the `contract.json` + `contract.d.ts` pair and would have to grow more hard-coded knowledge to cover the source contract. Replace it with a generic "copy these files, optionally with rename" operation and call it once per contract (destination → `contract.*`, source → `from-contract.*`). The emitter from [PR #356](https://github.com/prisma/prisma-next/pull/356) provides the file list per contract directly, so the caller doesn't need to know which extensions live next to the `.json`.
- **Attestation stays untouched** — per ADR 199 ("Storage-only migration identity"), attestation deliberately strips `fromContract` / `toContract` from the manifest envelope and anchors the identity via the storage-hash bookends already present in the envelope. `contract.json` / `from-contract.json` are convenience copies of data that's already hashed elsewhere — they MUST NOT be folded into `migrationId`.

## Changes from v1 (still in effect)

- **One consolidated factory** — delete `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` (which exports `createDataTransform`). Replace with a single user-facing `dataTransform(contract, name, { check, run })` that internally handles adapter + lowering.
- **Contract passed explicitly** as the first argument. Mirrors Mongo's `dataTransform(name, { check, run })` ergonomics, plus an adapter (Mongo not requiring one is arguably a bug).
- **Closures are nullary** `() => SqlQueryPlan | Buildable`. No `db` parameter.
- **Query builder instantiation is the user's responsibility** at module scope — same as Mongo.
- **No ambient context module**. Nothing in `postgresEmit` changes around import/emit.

## Background (unchanged)

See v1 for context: class-flow IR has `DataTransformCall` whose rendered `migration.ts` currently emits `dataTransform("label", () => placeholder("a"), () => placeholder("b"))`. Today no such `dataTransform` symbol is exported from `@prisma-next/target-postgres/migration`; `toOp()` on the stubbed call throws `PN-MIG-2001`. There is an internal `createDataTransform({ name, source, check, run })` in `operations/data-transform.ts` that takes fully-serialized input — this is what we're replacing.

## Authoring surface

### User writes (filled migration.ts)

```ts
import { Migration } from '@prisma-next/family-sql/migration';
import { addColumn, dataTransform, setNotNull } from '@prisma-next/target-postgres/migration';
import { sql } from '@prisma-next/sql-builder/runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import contract from './contract.json' with { type: 'json' };

const db = sql({
  context: createExecutionContext({
    contract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  }),
});

class M extends Migration {
  override describe() { return { from: 'abc', to: 'def' }; }
  override get operations() {
    return [
      addColumn('public', 'users', { name: 'email', typeSql: 'text', defaultSql: null, nullable: true }),
      dataTransform(contract, 'backfill emails', {
        run: () => db.users.update({ email: /* ... */ }).where(/* ... */),
      }),
      setNotNull('public', 'users', 'email'),
    ];
  }
}
export default M;
Migration.run(import.meta.url, M);
```

### Planner-produced (unfilled) form

The scaffolder emits a minimal stub; the user fills in their own query-builder setup when they replace the placeholders.

```ts
import { Migration } from '@prisma-next/family-sql/migration';
import { dataTransform, ... } from '@prisma-next/target-postgres/migration';
import { placeholder } from '@prisma-next/errors/migration';
import contract from './contract.json' with { type: 'json' };

class M extends Migration {
  override describe() { return { from: 'abc', to: 'def' }; }
  override get operations() {
    return [
      dataTransform(contract, 'backfill emails', {
        check: () => placeholder('check'),
        run: () => placeholder('run'),
      }),
    ];
  }
}
// ...
```

`placeholder(slot)` throws `PN-MIG-2001` before the factory ever calls `.build()`, so no ambient-context machinery is needed for the placeholder path to surface the unfilled error cleanly.

### Contract available at module load

The rendered migration needs `contract` importable at module scope. We do this Mongo-parity: copy the contract's emitted artifacts into the migration dir. Both contracts (destination and source) get copied, so the migration package is fully self-contained.

- Replace `copyContractToMigrationDir` with a generic copy helper in `packages/1-framework/3-tooling/migration/src/io.ts`. Proposed shape (bikeshedded in review):

  ```ts
  export async function copyFilesWithRename(
    destDir: string,
    files: readonly { readonly sourcePath: string; readonly destName: string }[],
  ): Promise<void>;
  ```

  The existing "destination contract" callers go from one specialized function call to a three-line `copyFilesWithRename(dir, [{ sourcePath: contract.json, destName: 'contract.json' }, { sourcePath: contract.d.ts, destName: 'contract.d.ts' }])` (or similar). ENOENT on any input throws; no tolerance for missing optional siblings (that logic moves to the caller if still needed).

- The callers (`cli/src/commands/migration-new.ts`, `cli/src/commands/migration-plan.ts`) invoke the helper **twice**:
  1. once for the destination contract — rename to `contract.*`
  2. once for the source contract — rename to `from-contract.*`

  The list of files per contract comes from the emitter (post-[PR #356](https://github.com/prisma/prisma-next/pull/356) the emitter exposes a `files(): readonly string[]` or equivalent on its output). No hard-coded `.json` / `.d.ts` knowledge in the copy helper.

- Rendered `migration.ts` imports the destination contract via `import contract from './contract.json' with { type: 'json' }`. The `from-contract.*` pair is provided for future needs (diff-aware authoring, pre-migration data inspection) and for parity with Mongo's migration-package contents.

- If the source contract is semantically absent (first migration of a project, no prior state), skip the second copy — no synthesized empty files.

## Signatures

### Factory — new consolidated form

`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` — **rewritten** (replaces the deleted `createDataTransform`):

```ts
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { Contract } from '@prisma-next/contract/types';
import type { DataTransformOperation, SerializedQueryPlan } from '@prisma-next/framework-components/control';
import { errorDataTransformContractMismatch } from '@prisma-next/errors/migration';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { lowerSqlPlan } from '@prisma-next/sql-runtime';

interface Buildable<R = unknown> {
  build(): SqlQueryPlan<R>;
}

/** A single-closure producer of a SQL query plan. Shared between `check` and each `run` entry. */
export type DataTransformClosure = () => SqlQueryPlan | Buildable;

export interface DataTransformOptions {
  /** Optional pre-flight query. `undefined` = no check. */
  readonly check?: DataTransformClosure;
  /** One or more mutation queries to execute. */
  readonly run: DataTransformClosure | readonly DataTransformClosure[];
}

// Lazy singleton; avoids re-instantiation per call.
let adapterSingleton: ReturnType<typeof createPostgresAdapter> | null = null;
function getAdapter() {
  if (!adapterSingleton) adapterSingleton = createPostgresAdapter();
  return adapterSingleton;
}

export function dataTransform<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  name: string,
  options: DataTransformOptions,
): DataTransformOperation {
  const adapter = getAdapter();
  const runClosures = Array.isArray(options.run) ? options.run : [options.run];
  return {
    id: `data_migration.${name}`,
    label: `Data transform: ${name}`,
    operationClass: 'data',
    name,
    source: 'migration.ts',
    check: options.check ? invokeAndLower(options.check, contract, adapter, name) : null,
    run: runClosures.map((closure) => invokeAndLower(closure, contract, adapter, name)),
  };
}

function invokeAndLower(
  closure: DataTransformClosure,
  contract: Contract<SqlStorage>,
  adapter: ReturnType<typeof createPostgresAdapter>,
  name: string,
): SerializedQueryPlan {
  const result = closure();
  const plan = isBuildable(result) ? result.build() : result;
  assertContractMatches(plan, contract, name);
  const lowered = lowerSqlPlan(adapter, contract, plan);
  return { sql: lowered.sql, params: lowered.params };
}

function isBuildable(value: unknown): value is Buildable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'build' in value &&
    typeof (value as { build: unknown }).build === 'function'
  );
}

function assertContractMatches(
  plan: SqlQueryPlan,
  contract: Contract<SqlStorage>,
  name: string,
): void {
  if (plan.meta.storageHash !== contract.storage.storageHash) {
    throw errorDataTransformContractMismatch({
      dataTransformName: name,
      expected: contract.storage.storageHash,
      actual: plan.meta.storageHash,
    });
  }
}
```

**New structured error**: `errorDataTransformContractMismatch` — `PN-MIG-2005` in `@prisma-next/errors/migration`. Sits alongside `errorUnfilledPlaceholder` (`PN-MIG-2001`) and the other authoring-time errors:

```ts
// packages/1-framework/1-core/errors/src/migration.ts
export function errorDataTransformContractMismatch(options: {
  readonly dataTransformName: string;
  readonly expected: string; // contract.storage.storageHash
  readonly actual: string;   // plan.meta.storageHash
}): CliStructuredError {
  return new CliStructuredError('2005', 'dataTransform query plan built against wrong contract', {
    domain: 'MIG',
    why: `Data transform "${options.dataTransformName}" produced a query plan whose storage hash (${options.actual}) does not match the migration's contract (${options.expected}). The query builder was configured with a different contract than the one passed to dataTransform(contract, ...).`,
    fix: 'Ensure the `contract` imported at module scope (used for both `dataTransform(contract, …)` and `sql({ context: createExecutionContext({ contract, … }) })`) is the same reference.',
    meta: { dataTransformName: options.dataTransformName, expected: options.expected, actual: options.actual },
  });
}
```

Why not reuse `runtimeError('PLAN.HASH_MISMATCH', …)` from `SqlFamilyAdapter.validatePlan`? That produces `PN-RUN-*`, which is correct for *runtime* query execution rejecting a mis-hashed plan — but surfacing a `PN-RUN-*` code from migration authoring puts the user in the wrong docs namespace. The two checks are semantically distinct: runtime executor rejects at query time; `dataTransform` rejects at plan time, carries the data-transform's name, and gives a migration-specific fix. Two lines of comparison logic duplicated — negligible cost.

**Type-level enforcement (follow-up, not this PR)**: today `SqlQueryPlan<_Row>` is not parameterized on the contract, so `meta.storageHash` is just `string` at the type level. A follow-up can parameterize it — `SqlQueryPlan<C extends Contract<SqlStorage>, _Row>` with `meta.storageHash: C['storage']['storageHash']` — at which point `dataTransform<C>(contract: C, ..., options: { run: () => SqlQueryPlan<C, any>; ... })` makes the contract-mismatch a compile error. Out of scope for PR 2; worth a Linear follow-up.

### Exports

`packages/3-targets/3-targets/postgres/src/exports/migration.ts`:

```ts
export { dataTransform } from '../core/migrations/operations/data-transform';
```

### `DataTransformCall.renderTypeScript()`

`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:794`:

```ts
renderTypeScript(): string {
  return [
    `dataTransform(contract, ${JSON.stringify(this.label)}, {`,
    `  check: () => placeholder(${JSON.stringify(this.checkSlot)}),`,
    `  run: () => placeholder(${JSON.stringify(this.runSlot)}),`,
    `})`,
  ].join('\n');
}
```

**`importRequirements()`**: the `contract` identifier is declared as a normal `ImportRequirement` on `DataTransformCall`, not as a scaffolder-preamble special case. See "Extending `ImportRequirement`" below.

### `DataTransformCall.toOp()`

**Unchanged** — still throws `PN-MIG-2001`. `DataTransformCall` represents only the planner-stubbed IR; it never wraps user-authored code. The class-flow emit never calls `toOp()` on a filled migration; it evaluates `M.operations` which invokes the real factory.

## Descriptor-flow callers

`operation-resolver.ts::resolveDataTransform` today calls the soon-to-be-deleted `createDataTransform({ name, source, check, run })` with pre-lowered serialized inputs. After deletion it has two options:

### Option A (recommended): inline the Op construction

The resolver already lowers closures to serialized plans (via its own `resolvePlanInput`/`resolveBuildable` helpers). Drop the last delegation and just construct the `DataTransformOperation` object literal directly:

```ts
function resolveDataTransform(
  desc: DataTransformDescriptor,
  ctx: OperationResolverContext,
): DataTransformOperation {
  const { db, toContract } = ctx;
  return {
    id: `data_migration.${desc.name}`,
    label: `Data transform: ${desc.name}`,
    operationClass: 'data',
    name: desc.name,
    source: desc.source,
    check: resolveCheck(desc.check, db, toContract),
    run: desc.run.flatMap((input) => resolvePlanInput(input, db, toContract)),
  };
}
```

Descriptor-flow is slated for removal — minimal churn, no abstraction cost.

### Option B: adapt the descriptor resolver to call the new class-flow factory

Possible but awkward: the descriptor closures are `(db) => plan`, class-flow closures are `() => plan`. The resolver would wrap each descriptor closure in a nullary wrapper that closes over its `db`, then call `dataTransform(toContract, desc.name, { check: wrapped, run: wrapped })`. More rewiring than Option A for no durable gain.

**Recommendation**: A.

## Extending `ImportRequirement`

`packages/1-framework/1-core/ts-render/src/ts-expression.ts` currently defines:

```ts
export interface ImportRequirement {
  readonly moduleSpecifier: string;
  readonly symbol: string;
}
```

The renderer emits one `import { a, b } from "module"` line per module, deduplicated across all nodes. This covers every existing call's needs — but it doesn't cover *default imports* (which we need for `import contract from "./contract.json"`) or *import attributes* (which we need for `with { type: "json" }`).

**Proposed extension** (minimal, additive):

```ts
export interface ImportRequirement {
  readonly moduleSpecifier: string;
  readonly symbol: string;
  readonly kind?: 'named' | 'default'; // defaults to 'named'
  readonly attributes?: Readonly<Record<string, string>>; // e.g. { type: 'json' }
}
```

The renderer:

- Named imports aggregate per `moduleSpecifier` as today.
- Default imports emit their own line: `import <symbol> from "<moduleSpecifier>"[ with { … }];`.
- Import attributes, if any, are emitted verbatim. Two requirements targeting the same module specifier with different attributes are an error (structural conflict the user can't resolve).

`DataTransformCall.importRequirements()` then returns (example):

```ts
[
  { moduleSpecifier: '@prisma-next/target-postgres/migration', symbol: 'dataTransform' },
  { moduleSpecifier: '@prisma-next/errors/migration',         symbol: 'placeholder'   },
  { moduleSpecifier: './contract.json', symbol: 'contract',
    kind: 'default', attributes: { type: 'json' } },
]
```

No scaffolder preamble special-case. Every migration that contains at least one `DataTransformCall` automatically pulls the contract import into scope via the standard dedup pass; migrations with no `DataTransformCall` don't.

`packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts` — no changes beyond consuming the extended `ImportRequirement`.

## Writing `contract.json` alongside `migration.ts`

Mongo-parity, but via a **generic copy helper** rather than a specialized one. The existing `copyContractToMigrationDir` hard-codes knowledge of the `contract.json` + `contract.d.ts` pair; that specialization would only grow if we bolted `fromContractJsonPath` onto it. Replace it with a narrower primitive.

**Helper** (in `packages/1-framework/3-tooling/migration/src/io.ts`):

```ts
export async function copyFilesWithRename(
  destDir: string,
  files: readonly { readonly sourcePath: string; readonly destName: string }[],
): Promise<void>;
```

No knowledge of `.json` / `.d.ts` siblings; no knowledge of what "contract artifacts" are. Missing source paths throw ENOENT. The existing callers of `copyContractToMigrationDir` migrate to this shape in a pure refactor.

**Callers** (`cli/src/commands/migration-new.ts`, `cli/src/commands/migration-plan.ts`) invoke it twice:

1. **Destination contract** → rename to `contract.*`. Source file list comes from the emitter (post-[PR #356](https://github.com/prisma/prisma-next/pull/356) the emitter exposes its emitted files directly; pre-#356 the caller reconstructs the list from the known `contract.output` + sibling `.d.ts` convention — document this as a short-lived expedient if #356 hasn't landed by the time this PR is implemented).
2. **Source contract** → rename to `from-contract.*`. Skipped entirely if the source contract is semantically absent (first migration of a project).

On disk, the final migration package for a class-flow migration looks like:

```
migrations/<timestamp>_<name>/
  migration.ts        # rendered scaffold, imports `contract` from ./contract.json
  migration.json      # manifest (as today)
  ops.json            # ops (as today)
  contract.json       # NEW: copy of toContract
  contract.d.ts       # NEW: colocated types for contract.json
  from-contract.json  # NEW: copy of fromContract
  from-contract.d.ts  # NEW: colocated types for fromContract
```

**Attestation**: `contract.json` / `from-contract.json` are **not** attested. Per ADR 199 ("Storage-only migration identity"), `computeMigrationId` deliberately strips `fromContract` / `toContract` (and `hints`) from the manifest envelope before hashing; contract identity is anchored via the storage-hash bookends inside the envelope. The copied `*.json` / `*.d.ts` files are convenience artifacts for authoring and runtime imports — their contents are already covered by the hashes the manifest records. Folding them into the attestation hash would double-count and would introduce false mismatches (e.g. trivial re-serialization of a logically identical contract).

## Files touched (preview)

- **delete**: `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` (the old internal `createDataTransform`)
- **new**: `packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts` (consolidated factory — reuses the filename, different contents)
- **modify**: `packages/3-targets/3-targets/postgres/src/exports/migration.ts` (+1 export)
- **modify**: `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (`renderTypeScript` + `importRequirements` for `DataTransformCall`)
- **modify**: `packages/1-framework/1-core/ts-render/src/ts-expression.ts` (extend `ImportRequirement` with optional `kind` + `attributes`)
- **modify**: `packages/1-framework/1-core/ts-render/src/<renderer>.ts` (emit default imports + import attributes; reject conflicting attribute sets on the same module)
- **modify**: `packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts` (no special case for contract; just consume the richer `ImportRequirement`)
- **modify**: `packages/3-targets/3-targets/postgres/src/core/migrations/operation-resolver.ts` (inline the `DataTransformOperation` construction — Option A above)
- **replace**: `packages/1-framework/3-tooling/migration/src/io.ts` — remove `copyContractToMigrationDir`, add a generic `copyFilesWithRename(destDir, files)` (or similarly-shaped) helper. Callers provide the source paths and desired destination filenames; the helper has no knowledge of `contract.json` or sibling `.d.ts` files.
- **modify**: `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts` and `migration-plan.ts` — invoke the generic helper twice: once with the destination contract's file list (renamed to `contract.*`), once with the source contract's file list (renamed to `from-contract.*`, skipped if absent). Source file list comes from the emitter's post-#356 files API.
- **new structured error**: `errorDataTransformContractMismatch` (`PN-MIG-2005`) in `packages/1-framework/1-core/errors/src/migration.ts`, re-exported via `exports/migration.ts`
- **new test**: `packages/3-targets/3-targets/postgres/test/migrations/operations/data-transform.test.ts`
- **new/extended tests**: `packages/1-framework/1-core/ts-render/test/*` for default imports + import attributes + attribute-conflict error
- **new/extended tests**: `packages/1-framework/3-tooling/migration/test/io.test.ts` — `from-contract.*` copy semantics
- **modify tests**: `op-factory-call.test.ts`, `issue-planner.test.ts`, `render-typescript.test.ts` — update rendered-output expectations to the new shape
- **modify integration**: `test/integration/test/cli-journeys/data-transform.e2e.test.ts` — un-skip once live-DB infra is in place (F02); otherwise document and keep skipped
- **modify examples**: `examples/prisma-next-demo/migration-fixtures/**` Postgres fixtures exercising `dataTransform` (F03)

## Test plan

1. **Unit test** (new file, `test/migrations/operations/data-transform.test.ts`)
   - `dataTransform(contract, 'label', { check: () => db.users.select(...), run: () => db.users.update(...) })` returns a `DataTransformOperation` with lowered `check.sql` and `run[0].sql`.
   - `dataTransform(contract, 'label', { run: [() => q1, () => q2] })` → two lowered entries in `run`.
   - `check` omitted → op's `check` is `null`.
   - `check: () => placeholder('slot')` throws `PN-MIG-2001`.
   - Contract hash mismatch: pass a plan whose `meta.storageHash` ≠ `contract.storage.storageHash` — throws `errorDataTransformContractMismatch` (`PN-MIG-2005`) with `meta.dataTransformName`, `meta.expected`, `meta.actual` populated.

2. **`ImportRequirement` renderer** (new/extended tests in `ts-render`)
   - Default-import requirement emits `import x from "m"`.
   - Import attributes emit `import x from "m" with { type: "json" }`.
   - Mixing default + named on the same module emits both lines (or one combined `import x, { a, b } from "m"` — decide during impl, test locks it in).
   - Two requirements with conflicting attribute maps on the same module throw a structured render-time error.

3. **Descriptor-flow regression** (`operation-resolver.integration.test.ts`)
   - Still produces identical output for descriptor-flow dataTransforms after Option A inlining.

4. **Scaffolder** (new/extended test in `render-typescript.test.ts`)
   - Rendered stub contains `import contract from "./contract.json" with { type: "json" };` when the plan includes any `DataTransformCall`, and omits it otherwise.
   - Rendered output for `DataTransformCall` matches the new `dataTransform(contract, ..., { check, run })` shape.

5. **Migration-dir preparation** (rewritten `io.test.ts`)
   - `copyFilesWithRename(destDir, files)` copies each entry in `files` to `destDir/<destName>`, preserving contents byte-for-byte.
   - Missing source path throws (ENOENT).
   - Destination directory is created if it doesn't exist (unless the current semantics require it pre-existing — match whatever `copyContractToMigrationDir` did here, since callers rely on it).
   - Call-site integration (in `migration-new`/`migration-plan` command tests): destination contract copied under `contract.*`; source contract copied under `from-contract.*`; when source contract is absent, no `from-contract.*` files appear.

6. **Attestation** (existing `attestation.test.ts`)
   - Add a regression asserting that adding/removing `contract.json` or `from-contract.json` from the migration dir does not change the computed `migrationId`. Anchors the ADR-199 invariant explicitly against the new artifacts.

7. **Errors package** (extended `errors/test/migration.test.ts`)
   - `errorDataTransformContractMismatch` produces code `PN-MIG-2005`, correct domain, and populates `meta.dataTransformName` / `meta.expected` / `meta.actual`.

8. **CLI** (extended `migration-plan-command.test.ts`)
   - `pendingPlaceholders: true` path still triggers (`placeholder()` still throws from inside the rendered `() => placeholder(...)` closure when emit evaluates `M.operations`).
   - The emitted `contract.json` is present and matches `manifest.toContract`; `from-contract.json` is present and matches `manifest.fromContract`.

9. **E2E** (`cli-journeys/data-transform.e2e.test.ts`)
   - Un-skip (F02) — verify filled migration emits, applies against live Postgres, passes verify.

## Resolved decisions

Formerly "open questions", all resolved before implementation began:

1. **`ImportRequirement` extension shape** — go with two new optional fields `{ kind?: 'named' | 'default'; attributes?: Readonly<Record<string, string>> }`. Simpler than a discriminated union; existing call sites stay unchanged.
2. **`copyContractToMigrationDir` — replace with a generic file-copy, not a specialized extension**. The current helper is already over-specialized; bolting a `fromContractJsonPath` argument onto it doubles down on that shape. Replace it with a thin, generic copy operation and call it once per contract (destination + source). The emitter post-[PR #356](https://github.com/prisma/prisma-next/pull/356) returns a *list of files* per contract, so the caller iterates that list and copies it verbatim into the migration dir — no special knowledge of `.json` + `.d.ts` pairings baked into the helper. The rename convention (`contract.*` for destination, `from-contract.*` for source) lives in the caller, not the helper.
3. **Combined `import contract, { something } from "./contract"` lines** — no preference; pick whichever falls out naturally from the renderer implementation. Current scope uses only the default import, so this is forward-compat wiggle room. Lock the chosen shape in via a renderer test.
4. **F02 (live-DB e2e) scope** — un-skip in this PR. PR 2's merge gate in [`pr-plan.md`](../pr-plan.md) already requires "All CLI journey e2e pass — their fixtures and assertions get updated as part of this PR", so this finding is in-scope for PR 2 and not deferred.
5. **Follow-up Linear ticket for type-level contract-hash enforcement** — filed as [TML-2291](https://linear.app/prisma-company/issue/TML-2291/class-flow-datatransform-type-level-contract-hash-enforcement-via) under the "Optional cleanup & refactoring" milestone of WS4. The runtime check stays as the safety net until that lands.

The design above and below has been updated throughout to reflect these decisions.

## Non-goals

- Extension-pack integration inside migration closures. The user sets up `sql({ context: … })` themselves; if they want extension codecs, they wire them into their own `createSqlExecutionStack({ ..., extensionPacks })` call. Out of scope for PR 2.
- Replacing `DataTransformCall.toOp()`. Stays as the placeholder-throwing IR node.
- `createBuilders<Contract>()`-style typed-builder preamble for class-flow (rejected).

## Implementation notes (hand-off)

This section is for whoever picks up the implementation. Context not obvious from the design above is collected here.

### Project context

- **Branch**: `tml-2286-phase-2-flip`, based on `tml-2286-backport-class-flow-migration-authoring-to-the-postgres`.
- **This is PR 2 of the project** `projects/postgres-class-flow-migrations`. PRs 1 and 3 are separate scopes; keep this PR focused on the F01 / F02 / F03 review findings plus the secondary items below.
- **Spec-driven**: every decision in this document was negotiated with the product owner. If a detail is absent here, stop and ask before implementing.

### Code-review findings being addressed

Source: `projects/postgres-class-flow-migrations/reviews/pr-2-flip/code-review.md`.

- **F01**: missing user-facing `dataTransform` factory → this whole design.
- **F02**: `cli-journeys/data-transform.e2e.test.ts` is `it.skip`ped against a live Postgres — un-skip once the factory is in place.
- **F03**: Postgres fixtures under `examples/prisma-next-demo/migration-fixtures/**` currently can't exercise `dataTransform` — extend them.
- **F04–F10 are already addressed** on this branch; do not re-open them.

### Suggested commit sequence

Ship small, intent-driven commits (`.claude/skills/commit-as-you-go/SKILL.md` /`.cursor/rules/commit-as-you-go.mdc`). Proposed order minimizes broken-tree windows:

1. **Errors package**: add `errorDataTransformContractMismatch` (`PN-MIG-2005`) to `packages/1-framework/1-core/errors/src/migration.ts`, re-export from `exports/migration.ts`, add the unit test in `test/migration.test.ts`. Isolated; shippable alone.
2. **Extend `ImportRequirement`**: optional `kind` + `attributes` on the interface in `packages/1-framework/1-core/ts-render/src/ts-expression.ts`; teach the renderer to emit default imports and import attributes, and to reject conflicting attribute sets on the same module. Ship with new/extended `ts-render` tests.
3. **Replace `copyContractToMigrationDir` with generic `copyFilesWithRename`** in `packages/1-framework/3-tooling/migration/src/io.ts`. Rewrite `test/io.test.ts` for the new shape. Update existing callers of `copyContractToMigrationDir` to the new helper (pure refactor for those callsites — semantics unchanged).
4. **Wire CLI callers**: `cli/src/commands/migration-new.ts` and `migration-plan.ts` invoke `copyFilesWithRename` twice — once per contract, with the desired rename (`contract.*` / `from-contract.*`). Source and destination contract file lists come from the emitter's post-#356 files API. If `fromContract` is semantically absent (first migration of a project), skip the second call; don't synthesize empty files.
5. **Replace `operations/data-transform.ts`**: delete the existing file's contents, reuse the filename with the consolidated factory described above, export from `src/exports/migration.ts`.
6. **Update `DataTransformCall`**: in `op-factory-call.ts`, rewrite `renderTypeScript()` to the new four-argument shape, extend `importRequirements()` to declare the `contract` default import with `{ type: 'json' }` attributes. `toOp()` is unchanged.
7. **Inline descriptor-flow resolver**: inline the `DataTransformOperation` construction in `operation-resolver.ts::resolveDataTransform` (Option A). Delete any helper imports that are now dead.
8. **Update existing tests**: `op-factory-call.test.ts`, `issue-planner.test.ts`, `render-typescript.test.ts` — new expected render output. Use literal expected strings, not regexes — the rendered output is part of the contract.
9. **Fixtures and e2e**: update `examples/prisma-next-demo/migration-fixtures/**` Postgres fixtures (F03); un-skip `cli-journeys/data-transform.e2e.test.ts` (F02). Read the test to check whether the live-DB harness is plumbed; if not, document in the same commit and keep skipped.

Run `pnpm --filter @prisma-next/target-postgres test typecheck` and `pnpm --filter @prisma-next/cli test` after each commit that touches those packages. Full `pnpm ci` before pushing.

### Verified type shapes (do not guess these)

- `DataTransformOperation.check: SerializedQueryPlan | boolean | null` (`packages/1-framework/1-core/framework-components/src/control-migration-types.ts:77`). The authoring surface in this design emits `null` when `check` is omitted and `SerializedQueryPlan` when present. **Do not emit `true` / `false` from this factory** — those values exist in the type for other codepaths (e.g. descriptor-flow short-circuits) and are not part of the class-flow authoring surface.
- `DataTransformOperation.run: readonly SerializedQueryPlan[] | null` (same file). Authoring-surface `run` must produce at least one closure; the type we ship (`DataTransformClosure | readonly DataTransformClosure[]`) enforces this.
- `SerializedQueryPlan = { sql: string; params: readonly unknown[] }` (same file, line 39). `lowerSqlPlan` returns `ExecutionPlan<Row>` which is `{ sql, params, ast, meta }` — extract only `sql` and `params` into the serialized form; do not leak the AST or meta into ops.json.
- `SqlQueryPlan.meta.storageHash` is always a `string` (structurally `Pick<ExecutionPlan, 'params' | 'meta'>` via `packages/2-sql/4-lanes/relational-core/src/plan.ts:15`). No optional-chaining on `plan.meta` in the hash check.
- `createPostgresAdapter()` comes from `@prisma-next/adapter-postgres/adapter` (`packages/3-targets/6-adapters/postgres/src/exports/adapter.ts`). Zero-arg call returns the default adapter profile.
- `DataTransformOperation.source`: set to `'migration.ts'` (no path, just the filename — matches how Mongo's equivalent surfaces it implicitly; descriptor-flow passes `desc.source` through). Confirm by snapshot-diffing against a currently-emitted op if in doubt.

### Known hazards

- **Adapter singleton state across tests**: the lazy `adapterSingleton` in the factory will be module-level. Unit tests that swap contracts may want a reset hook; expose `__resetAdapterForTesting()` if needed, but keep it off the public export surface.
- **`sql({ context })` evaluation timing**: the user's `db = sql({ context: createExecutionContext({ contract, stack }) })` runs at *module load* of `migration.ts`, which happens when the CLI imports it during `migration plan` / `migration apply`. Any exceptions from `createExecutionContext` (family mismatch, target mismatch) surface as `PN-RUN-*` at module load, before `dataTransform` is reached. That's correct; don't try to catch and rewrap.
- **Scaffold without a `DataTransformCall`**: if a plan contains zero `DataTransformCall` instances, the rendered migration must *not* import `contract`. The `ImportRequirement`-based approach handles this automatically; don't regress by adding a scaffolder-wide preamble. Test this case explicitly in `render-typescript.test.ts`.
- **Rebase hygiene**: verify you're rebased onto the latest `tml-2286-backport-class-flow-migration-authoring-to-the-postgres` before starting — some of the F01-adjacent code landed there and not on `main`.
- **Don't touch `DataTransformCall.toOp()`**: the fact that `toOp()` still throws `PN-MIG-2001` is correct. That IR node only ever represents planner-stubbed (unfilled) calls; the filled migration path goes through `M.operations` evaluation which invokes the real `dataTransform(...)` factory, never `toOp()`.
- **`wip/` is local-only**. The earlier drafts of this doc lived at `wip/dataTransform-class-flow-design.md`; it has now been moved here. Do not grep `wip/` for authoritative guidance — this file is the source of truth.

### Cursor rules worth rereading before implementing

- `.cursor/rules/prefer-to-throw.mdc` — for the error factory style.
- `.cursor/rules/test-intent-readability.mdc` and `.cursor/rules/omit-should-in-tests.mdc` — for the new/extended tests.
- `.cursor/rules/no-barrel-files.mdc` — this design adds exports via named re-exports from `src/exports/migration.ts`, which is the sanctioned exception; do not collapse into a barrel.
- `.cursor/rules/capabilities-ownership.mdc` — relevant when touching `op-factory-call.ts` / `operation-resolver.ts`.
- `.cursor/rules/contract-normalization-responsibilities.mdc` — ensure the copied `contract.json` passes through unaltered.

### Verification before handing back

- `pnpm --filter @prisma-next/target-postgres test typecheck`
- `pnpm --filter @prisma-next/cli test typecheck`
- `pnpm --filter @prisma-next/ts-render test typecheck`
- `pnpm --filter @prisma-next/errors test typecheck`
- `pnpm --filter @prisma-next/framework-components typecheck`
- `pnpm -w biome check` (if Biome is part of the standard gate)
- A fresh `prisma-next migration plan` run against `examples/prisma-next-demo` that produces an unfilled `dataTransform(...)` stub; then a hand-filled variant that emits + applies successfully.
- All ACs and merge gates for PR 2 (see `projects/postgres-class-flow-migrations/pr-plan.md`) pass; nothing from F04–F10 regresses.
