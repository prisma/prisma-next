# Data Transform Placeholder Utility

## Context

When `migration plan` / `migration new` detects that a migration requires a data transform, the scaffolder writes a `migration.ts` file with a `dataTransform(...)` call whose `check.source` and `run` slots cannot be automatically derived — only the author knows what query to run. The scaffolder must emit *something* in those slots that both:

1. Compiles cleanly (so the user's editor is happy and `tsc` passes), and
2. Fails loudly at emit time if the user forgot to fill it in.

The current branch solves this with an exported sentinel:

```ts
// packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts:29–30
export const TODO = Symbol.for('prisma-next.migration.todo');
export type TodoMarker = typeof TODO;
```

Detected by an ad-hoc `typeof result === 'symbol'` check inside `resolveQueryResult` in the same file (lines 45–56), which throws a plain `new Error(...)`.

This mechanism has several problems:

- **Terrible public-API name.** `import { TODO } from '@prisma-next/target-mongo/migration'` collides with the universal `// TODO:` comment convention and reads like debug code that shipped.
- **Leaks into public type signatures.** `dataTransform`'s `source` parameter has type `() => MongoQueryPlan | Buildable | TodoMarker`, forcing hand-authored migrations to reason about an unreachable case.
- **Detected inside an AST resolver.** The diagnostic is buried in a runtime coercion helper and throws a generic `Error` rather than the structured runtime-error shape used everywhere else in the system.
- **No tests, no documentation.** The sentinel contract is undocumented; the only import sites are scaffolded files that don't exist at rest, so a reviewer landing on the export sees what looks like dead code.

This document specifies a replacement: a `placeholder(slot)` utility function that throws a structured runtime error when called.

### Scope: Mongo only

This spec applies only to the Mongo target. Postgres currently has a parallel-looking sentinel — a bare identifier `TODO` that the Postgres scaffolder emits as a destructured name from `createBuilders<Contract>()` — but the machinery it assumes is not implemented in the codebase:

- There is no `@prisma-next/target-postgres/migration-builders` module. No source, no export, no consumer.
- `createBuilders` does not exist anywhere in the repository.
- There are no Postgres example migrations. All `examples/**/migration.ts` files are Mongo.

The Postgres scaffolder is emitting import strings today that would fail to resolve at evaluation time with a module-not-found error. Nothing exercises that path because no production Postgres migration-authoring flow exists yet. Adopting `placeholder` in Postgres is deferred until that flow is built, and will be sequenced with the eventual `migration-builders` implementation. The Mongo sentinel, by contrast, is reachable today (Mongo migration authoring exists, is wired through the CLI, and is exercised by example migrations), so the replacement is Mongo-scoped and complete within this branch.

## Why a placeholder is needed at all

The only producer of placeholders is the **scaffolder**, not the planner. The planner produces a target-internal plan (descriptors, `OpFactoryCall`s, or whatever the target chose); it does not render TypeScript. The scaffolder — each target's `renderTypeScript` implementation, invoked by the framework's `scaffoldMigrationTs` utility — converts that plan into file content, and the only operation kind with user-authored holes is `dataTransform`.

Every other operation kind (createCollection, createIndex, createTable, addColumn, setNotNull, etc.) is fully specified by the differ — the scaffolded call has no holes and needs no placeholder.

So the scope of this utility is narrow: it exists to paper over two specific slots (`check.source` and `run`) in one kind of operation (`dataTransform`).

## Design

### The utility

Add a structured migration-error factory to `@prisma-next/errors/migration`:

```ts
// packages/1-framework/1-core/errors/src/migration.ts
export function errorUnfilledPlaceholder(slot: string): CliStructuredError {
  return new CliStructuredError('2001', 'Unfilled migration placeholder', {
    domain: 'MIG',
    why: `The migration contains a placeholder that has not been filled in: ${slot}`,
    fix: 'Open migration.ts and replace the `placeholder(...)` call with your actual query.',
    meta: { slot },
  });
}
```

And a `placeholder` utility that throws it (colocated in the same file):

```ts
// packages/1-framework/1-core/errors/src/migration.ts
import { errorUnfilledPlaceholder } from './migration';

/**
 * Thrown by scaffolded `migration.ts` files wherever the scaffolder couldn't
 * emit a real query and the author is expected to fill one in. Calling this
 * function always throws a structured runtime error.
 *
 * The return type `never` makes it assignable to any expected return type,
 * so a scaffolded `() => placeholder('foo')` satisfies signatures like
 * `() => MongoQueryPlan` without polluting them with a sentinel union arm.
 */
export function placeholder(slot: string): never {
  throw errorUnfilledPlaceholder(slot);
}
```

Key properties:

- **Return type `never`.** Because `never` is assignable to every type, `() => placeholder('...')` satisfies any `() => T` signature without forcing callers to widen their parameter types. No sentinel union arm anywhere in the public API.
- **Throws `CliStructuredError` with `domain: 'MIG'`.** Uses the migration-subsystem error domain (PN-MIG-2xxx) defined in `docs/CLI Style Guide.md`; this introduces PN-MIG-2001 as the first migration-domain code. The CLI's existing error envelope formatting handles it identically to any other structured error (`errorRuntime`, `errorRunnerFailed`, `errorMarkerMissing`, etc.).
- **Takes a slot identifier.** The scaffolder emits e.g. `placeholder('backfill-product-status:check.source')`, so the error message names the exact location the author still needs to edit. `meta.slot` makes it structured for agents/tools consuming the envelope.
- **Lives in a neutral package.** `@prisma-next/errors` (Domain 1) already owns structured error construction for both control and execution planes. Adding `placeholder` here keeps it target-agnostic — both Postgres and Mongo scaffolders import the same utility and emit the same error format.

### Scaffolded output

Mongo's `renderTypeScript` emits `placeholder('...')` calls inline wherever a `dataTransform` operation needs user-authored query bodies:

```ts
dataTransform('backfill-product-status', {
  check: {
    source: () => placeholder('backfill-product-status:check.source'),
    expect: 'notExists',
  },
  run: () => placeholder('backfill-product-status:run'),
})
```

The emitted preamble (part of the same `renderTypeScript` return string) includes a `placeholder` import, re-exported from the Mongo target's migration entrypoint so scaffolded files have one import line:

```ts
import { dataTransform, placeholder } from '@prisma-next/target-mongo/migration'
```

The `placeholder` re-export points at the same function in `@prisma-next/errors`. When Postgres migration authoring lands, it adopts the same utility from the same source — shared implementation, shared error shape, shared message format. This spec does not touch Postgres.

### What this deletes

- `export const TODO = Symbol.for('prisma-next.migration.todo')` and `type TodoMarker` from `packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts` (lines 29–30).
- The `| TodoMarker` union arms from `dataTransform`'s parameter types (lines 64, 69).
- The `if (typeof result === 'symbol')` branch inside `resolveQueryResult` (lines 46–51). `resolveQueryResult` collapses to "if `Buildable`, call `.build()`; else return as-is" — and may inline away entirely.

The Postgres scaffolder's emitted `TODO` string and its `serializeQueryInput` symbol-branch are left in place as aspirational paint until Postgres migration authoring gets built — see "Scope: Mongo only" above.

### What this does not need

- **No SPI hook on `MigrationScaffoldingCapability`.** The collapsed SPI proposed in `target-owned-migration-scaffolding.md` is a single `renderTypeScript(plan, context): string` method — targets embed `placeholder(...)` string literals directly inside whatever they emit, and add `placeholder` to their preamble imports. The framework never has to know the word "placeholder."
- **No detection in the AST resolver.** `resolveQueryResult` no longer has any diagnostic responsibility. The throw happens naturally when `check.source()` or `run()` is invoked during emit.
- **Minimal new error surface.** Introduces a single migration-domain code (`PN-MIG-2001` — the first code in the reserved `PN-MIG-2xxx` range defined in `docs/CLI Style Guide.md`). No other codes are added.

## Behaviour change vs. today

| Aspect                 | Today (`TODO` symbol)                                                                              | Proposed (`placeholder()` fn)                                        |
| ---                    | ---                                                                                                | ---                                                                  |
| When the error surfaces| Eagerly, during `dataTransform(...)` construction in `migration.ts`'s default function body        | When `check.source()` / `run()` is invoked during emit               |
| Error class            | `new Error(...)`                                                                                   | `CliStructuredError` with `domain: 'MIG'`, code `PN-MIG-2001`        |
| Message precision      | Generic ("fill in the check/run queries")                                                          | Names the exact migration name + slot                                |
| Exported types         | `TODO: symbol`, `TodoMarker = typeof TODO`                                                         | `placeholder(slot: string): never`                                   |
| Public type union      | `() => MongoQueryPlan \| Buildable \| TodoMarker`                                                  | `() => MongoQueryPlan \| Buildable`                                  |

The timing shift (eager → lazy) is a strict improvement: the error points at the exact slot being invoked rather than the whole migration's construction, flows through the CLI's existing structured-error envelope, and integrates with any agent-readable error output.

## Non-goals

- **Enumerating all unfilled placeholders in one verify pass.** This design fails fast on the first unfilled slot. If a "list everything I still owe" UX is wanted later, it's additive — a separate scaffold-walk check that greps for `placeholder(` calls in migration.ts, or a pre-flight `verify` pass that catches multiple. Not in scope.
- **Forbidding hand-authored use of `placeholder`.** Nothing stops a user from calling `placeholder('...')` in a hand-written migration. That's fine — it behaves identically and just means "this call site is intentionally unimplemented and should throw."
- **Restructuring other error codes.** Only `PN-MIG-2001` is introduced. The existing `PN-RUN-30xx` runtime and `PN-CTRL-*` control codes are untouched.

## Implementation plan

Small, sequenceable. All phases can land in one PR.

### Phase 0: add the utility (independent)

1. Add `errorUnfilledPlaceholder(slot: string): CliStructuredError` to `packages/1-framework/1-core/errors/src/migration.ts` using code `2001` with `domain: 'MIG'` (envelope `PN-MIG-2001`).
2. Add `placeholder(slot: string): never` to `@prisma-next/errors` (colocated with `errorUnfilledPlaceholder` in the new migration subpath, exported from `@prisma-next/errors/migration`).
3. Unit test: calling `placeholder('foo')` throws a `CliStructuredError` with `code === '2001'`, `domain === 'MIG'`, `toEnvelope().code === 'PN-MIG-2001'`, `meta.slot === 'foo'`.

### Phase 1: adopt in target-mongo

4. Re-export `placeholder` from `@prisma-next/target-mongo/migration`.
5. Remove `TODO` and `TodoMarker` from `migration-factories.ts`.
6. Simplify `resolveQueryResult` to drop the symbol branch. Inline if it becomes trivial.
7. Update `dataTransform`'s parameter types to drop the `| TodoMarker` arms.
8. Update Mongo's `renderTypeScript` so that whenever it emits a `dataTransform(...)` call, the `check.source` and `run` slots default to `() => placeholder('{migrationName}:{slot}')`, and the preamble imports include `placeholder`.

### Phase 2: update examples

9. Hand-update `examples/retail-store/migrations/20260416_backfill-product-status/migration.ts` and any other Mongo demo migrations to match the new scaffolded shape. Authored examples replace the `placeholder()` calls with real queries, so there's no runtime effect — this is cosmetic alignment for readers.

### Phase 3 (optional): lint / guardrail

10. If desirable, a biome rule or custom lint that forbids importing `placeholder` from `@prisma-next/errors` (or its re-exports) anywhere except scaffolded `migration.ts` files — guards against leakage of the utility into framework or production code. Low priority; the runtime-throw behaviour is already self-enforcing.

### Deferred: target-postgres adoption

Out of scope for this spec. When Postgres migration authoring gets built (its own `@prisma-next/target-postgres/migration-builders` module, a real `createBuilders` export, example migrations exercising the flow), adopting `placeholder` happens as part of that work. The Postgres scaffolder continues to emit its aspirational `TODO` string until then.

## Open questions

- **Import specifier for users.** Should `placeholder` be re-exported from each target (`@prisma-next/target-mongo/migration`, `@prisma-next/target-postgres/migration-builders`) so scaffolded files have a single import line, or imported directly from `@prisma-next/errors`? Recommendation: re-export from the target. Keeps the scaffolded preamble compact and matches how users think about "things imported from my migration builders." Source of truth is still one function.
- **Subcode number.** `PN-MIG-2001` proposed above; this is the first reserved code in the migration-domain `2xxx` range.
- **Structured slot argument.** Free-form string is simplest: `placeholder('backfill-product-status:check.source')`. A structured `{ migrationName: string, slot: 'check.source' | 'run' }` would enable richer diagnostics and better agent parsing but adds ceremony in the scaffolded code. Recommendation: ship the string form (with a documented `{migration}:{slot}` convention) and reconsider if UX demand arises.

## Relationship to other specs

- **Supersedes**: the `TODO` symbol introduced on the current branch (`packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts:29–30`). The parallel Postgres sentinel is out of scope here and remains aspirational paint until Postgres migration authoring is built.
- **Complements `target-owned-migration-scaffolding.md`**: that spec collapses `MigrationScaffoldingCapability` to a single `renderTypeScript(plan, context): string` method. The `placeholder(...)` calls in scaffolded files are a string-level detail of Mongo's `renderTypeScript` implementation; no SPI accommodation is required.
- **Complements `migration-emit-unification.md`**: that spec renames `migration verify` → `migration emit` and makes `migration plan` run emit inline and unconditionally. This placeholder mechanism is what makes that unification safe: without a structured throw on unfilled slots, `plan` would have to keep a `needsDataMigration` flag (or equivalent) to decide whether to attempt emit. With `placeholder(...)`, evaluating a scaffolded file with unfilled slots fails cleanly through the CLI's existing structured-error envelope, and `plan` just surfaces the error. Because emit runs in-process (not as a subprocess), the CLI catches `errorUnfilledPlaceholder` directly by `code === 'PN-MIG-2001'`.
- **Independent of `data-transform-check-unification.md`**: the placeholder mechanism works identically regardless of whether data transform checks are unified with DDL pre/post checks.
- **Independent of the query-builder unification work**: whatever the scaffolded query shape is, the placeholder is just a drop-in for `() => <query>`.
