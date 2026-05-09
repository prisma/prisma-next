# Project 1 — code review items (post-rebase)

Code review items raised after project-1 was nominally closed out. As of 2026-05-09 the project's branch (`tml-2373-project-1-on-2397`) has been rebased on top of the TML-2397 close-out tip (`tml-2397-remove-database-dependencies-and-closeout`, M3.5 alignment + M5 polish + T5.9 deletion all merged). CR-2 / CR-3 / CR-4 / CR-5 are resolved by the rebase. The remaining work is **CR-1** + **TML-2435**.

This file is the durable record. It lives under `projects/cipherstash-integration/` (sibling of project-2 + sql-raw-factory) — it'll be deleted alongside the umbrella project's eventual close-out, after CR-1 + TML-2435 land and the project-1 PR is reopened.

## CR-1 — Cipherstash migration-op factories must be public, user-callable, and renderable via the codec hook (NEW; in-scope, not deferred)

**Status:** Not implemented.

**What's there now (project-1 worktree):**

[`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts:98-132`](../../packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts:98-132) constructs migration ops as plain `SqlMigrationPlanOperation` records via file-private `buildAddOp` / `buildRemoveOp` helpers, and `onFieldEvent` returns `readonly Op[]` (a list of *runtime* op shapes, not renderable factory-call IR nodes):

```typescript
// Current shape — NON-renderable
type Op = SqlMigrationPlanOperation<unknown>;

function onFieldEvent(
  event: 'added' | 'dropped' | 'altered',
  ctx: FieldEventContext,
): readonly Op[] { /* ... returns plain SqlMigrationPlanOperation literals ... */ }
```

Consequence: `prisma-next migration plan` against an app with `Encrypted<string>` columns produces a `migration.ts` like [`examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts`](../../examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts) where codec-emitted ops render as verbose `rawSql({ id, label, operationClass, invariantId, target, precheck, execute: [{ description, sql }], postcheck })` blocks. The TS scaffolder's `RawSqlCall` ([`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:687-708`](../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:687-708)) is the catch-all that fires whenever an op didn't come in as a structured `*Call` IR node.

### What "done" looks like — sharpened scope (per user direction 2026-05-09)

User direction (verbatim):

> I expect cipherstash operation functions to be part of the public, user-facing API, so users can utilize them in their own migration.ts files.
>
> I also expect them to be rendered by the planner as needed, so the codec interface that lets cipherstash codecs respond to field additions/deletions etc must be able to return a *renderable* operation (whatever that's called), and must do so

Two coupled requirements: a public surface authors can call directly, AND the codec hook returning renderable IR (not just runtime ops). Both are satisfied by reusing the framework's existing `OpFactoryCall` pattern.

#### 1. Public, user-callable factories — `@prisma-next/extension-cipherstash/migration`

New entry-point exporting:

```typescript
// packages/3-extensions/cipherstash/src/exports/migration.ts (new)
export { cipherstashAddSearchConfig, cipherstashRemoveSearchConfig } from '../core/migration-ops';
// ...optional re-export of the index-name type for ergonomics
export type { CipherstashSearchIndex } from '../core/migration-ops';
```

Factory signatures (using the index name directly so the codec-hook flag-to-index walk continues to live inside cipherstash, not the API surface):

```typescript
type CipherstashSearchIndex = 'unique' | 'match';

interface CipherstashSearchConfigArgs {
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
  readonly castAs?: string; // defaults to 'text', matching today's DEFAULT_CAST_AS
}

function cipherstashAddSearchConfig(args: CipherstashSearchConfigArgs): CipherstashAddSearchConfigCall;
function cipherstashRemoveSearchConfig(args: CipherstashSearchConfigArgs): CipherstashRemoveSearchConfigCall;
```

A user authoring a hand-written migration can import and call them directly:

```typescript
// app's migrations/<dir>/migration.ts (hand-authored, post-CR-1)
import { Migration, MigrationCLI, createTable } from '@prisma-next/target-postgres/migration';
import {
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from '@prisma-next/extension-cipherstash/migration';

export default class M extends Migration {
  override get operations() {
    return [
      createTable('public', 'user', /* ... */),
      cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'unique' }),
      cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'match' }),
    ];
  }
}
```

Identical ergonomics to `createTable` / `setNotNull` etc. from `@prisma-next/target-postgres/migration`. No special-casing.

#### 2. Renderable IR — `CipherstashAddSearchConfigCall` / `CipherstashRemoveSearchConfigCall`

Cipherstash gets its own `*Call` classes following the framework's existing `PostgresOpFactoryCall` pattern (the abstract base + `FrameworkOpFactoryCall` interface — [`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:51-64`](../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:51-64)):

```typescript
// packages/3-extensions/cipherstash/src/core/migration-call-classes.ts (new)
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@prisma-next/ts-render';
import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@prisma-next/framework-components/control';

const CIPHERSTASH_MIGRATION_MODULE = '@prisma-next/extension-cipherstash/migration';

abstract class CipherstashOpFactoryCallNode
  extends TsExpression
  implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): SqlMigrationPlanOperation<unknown>;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: CIPHERSTASH_MIGRATION_MODULE, symbol: this.factoryName }];
  }
}

export class CipherstashAddSearchConfigCall extends CipherstashOpFactoryCallNode {
  readonly factoryName = 'cipherstashAddSearchConfig' as const;
  readonly operationClass = 'additive' as const;
  // ... constructor stamping (table, column, index, castAs); label; freeze ...

  toOp(): Op {
    // Returns the same SqlMigrationPlanOperation buildAddOp produces today.
  }

  renderTypeScript(): string {
    return `cipherstashAddSearchConfig(${jsonToTsSource({
      table: this.table,
      column: this.column,
      index: this.index,
      ...(this.castAs !== 'text' ? { castAs: this.castAs } : {}),
    })})`;
  }
}

// CipherstashRemoveSearchConfigCall — mirror image, operationClass: 'destructive'.
```

The factory functions exported in (1) construct these classes directly:

```typescript
export function cipherstashAddSearchConfig(args: CipherstashSearchConfigArgs): CipherstashAddSearchConfigCall {
  return new CipherstashAddSearchConfigCall(args.table, args.column, args.index, args.castAs ?? 'text');
}
```

#### 3. Codec hook returns the renderable IR, not the runtime op

`CodecControlHooks.onFieldEvent` return type widens to allow either (today's `SqlMigrationPlanOperation`) or the new framework-level `OpFactoryCall` interface (which both `PostgresOpFactoryCall` subclasses and `Cipherstash*Call` subclasses implement):

```typescript
// packages/2-sql/9-family/src/control/codec-hooks.ts (the framework's hook contract)
export interface CodecControlHooks {
  onFieldEvent?(
    event: 'added' | 'dropped' | 'altered',
    ctx: FieldEventContext,
  ): readonly OpFactoryCall[];
  // ...expandNativeType etc.
}
```

(Open question for the rebase: whether to widen to `OpFactoryCall | SqlMigrationPlanOperation` for back-compat, or hard-cut to `OpFactoryCall`. Recommendation: hard-cut — it's the same M3.5-style migration we did with `MigrationPackage` unification, and the only existing implementation is cipherstash itself.)

Cipherstash's hook then returns Calls directly:

```typescript
// packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts (after CR-1)
function onFieldEvent(
  event: 'added' | 'dropped' | 'altered',
  ctx: FieldEventContext,
): readonly OpFactoryCall[] {
  // ...same flag-to-index walk as today, but builds Calls instead of Ops:
  ops.push(cipherstashAddSearchConfig({ table: tableName, column: fieldName, index: FLAG_TO_INDEX[flag] }));
}
```

#### 4. Planner integration

The SQL family's `planFieldEventOperations` already gathers codec-hook output and hands it to the planner's call-list. Because Cipherstash's Calls implement the same `OpFactoryCall` interface as Postgres's `*Call` classes, no special-case needed in the planner — they flow through `renderCallsToTypeScript` ([`packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts)) and produce the right `import` + factory call in the rendered `migration.ts`. The `RawSqlCall` fallback only fires for ops that were never wrapped in a structured Call in the first place — which post-CR-1 is the user's own raw escape-hatch and nothing else.

#### 5. Round-trip property (acceptance test)

Given a contract diff that adds `Encrypted<string>` with `equality: true, freeTextSearch: true` on `user.email`:

- `prisma-next migration plan` produces a `migration.ts` whose codec-emitted ops are exactly two `cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'unique' })` / `index: 'match'` calls — **zero** `rawSql({ id: 'cipherstash-codec.*', ... })` blocks.
- The rendered `migration.ts` carries `import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';` automatically.
- Re-running `pnpm tsx migrations/.../migration.ts` re-emits `ops.json` byte-for-byte (the runtime op shape is unchanged; only the IR / TS rendering changes).
- The hash on `migration.json` is preserved (canonical content unchanged).

#### 6. Back-compat for the example app's existing migration

The currently-committed `examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts` (the `rawSql({...})` shape) is regenerated as part of the rebase — its `migrationHash` should be preserved (op identity / SQL is unchanged), only the TS rendering and import statement change. If the hash *would* shift, that's a CR-1 implementation bug to fix — the canonical content is invariant.

**Estimate:** ~1 day. Bulk is the new Call classes + the migration export entry-point + widening the hook interface. The codec-hook walk barely changes (one-line: builds a Call instead of an Op). No planner changes (already polymorphic over `OpFactoryCall`).

**Land where:** This is in-scope for the project-1 rebase PR. Not a follow-up ticket; not deferred.

## CR-2 — On-disk extension contract + migrations [RESOLVED by rebase]

**Status:** Resolved by the rebase on the TML-2397 close-out tip (2026-05-09).

**What's now visible in this worktree:**

```
packages/3-extensions/cipherstash/
├── prisma-next.config.ts
├── contract.json
├── contract.d.ts
├── refs/head.json
├── migrations/cipherstash/<dirName>/
│   ├── migration.json
│   ├── ops.json
│   ├── end-contract.{json,d.ts}
│   └── migration.ts             ← Migration subclass
└── src/
```

cipherstash, pgvector, test-contract-space, and the audit / feature-flags monorepo packages all author on-disk-in-package via the same pipeline application authors use.

Relevant commits brought in via the rebase base:

- `a4e392bce refactor(framework): collapse extension migration package types onto MigrationPackage (M3.5 R1)`
- `55ff9ba50 refactor(extension-test-contract-space): rebuild as on-disk-in-package reference model (M3.5 R1)`
- `43772d4c7 docs(adr-211): record unified MigrationPackage shape + on-disk-in-package authoring convention (M3.5 R1)`
- `0815d688a feat(extension-cipherstash): add prisma-next.config.ts and contract source for in-package emit (M3.5 R2)`
- `655d6ef35 feat(extension-cipherstash): emit contract.json + contract.d.ts (M3.5 R2)`
- `2eaa1a3e9 feat(extension-cipherstash): author baseline migration on-disk + Migration subclass (M3.5 R2)`
- `529db7be4 refactor(extension-cipherstash): rewrite descriptor as JSON-import wiring + adapt tests (M3.5 R2)`
- `e9455c648 docs(extension-cipherstash): document on-disk-in-package authoring workflow (M3.5 R2)`
- (pgvector + audit + feature-flags equivalents: M3.5 R3)
- `8df3ea6d8 docs(adr-211, extensions): document Path B authoring + tsx migration runner + adapter-postgres fixture follow-up (M5 polish)`
- `24fde8d6d chore(biome, extensions): exclude CLI-emitted migration JSONs from biome + canonicalize on-disk shape (M5 polish)`
- `3a56df66d chore(closeout): delete projects/extension-contract-spaces + redirect path-based references to ADR 211 (M5 T5.9)`

## CR-3 — Per-extension `prisma-next.config.ts` ("Option A" CLI strategy) [RESOLVED by rebase]

**Status:** Resolved by the rebase on the TML-2397 close-out tip (2026-05-09).

The "Option A" decision (each extension package gets its own `prisma-next.config.ts`, runs `prisma-next contract emit` as `pnpm build:contract-space` chained into `pnpm build`; `prisma-next migration plan` is *not* chained because it's non-idempotent) is now implemented in this worktree:

- `packages/3-extensions/cipherstash/prisma-next.config.ts`, ditto pgvector + test-contract-space.
- `packages/3-extensions/cipherstash/package.json` `build:contract-space` script.
- `examples/multi-extension-monorepo/packages/{audit,feature-flags}/prisma-next.config.ts` (these are subdirectories without their own `package.json` — see those READMEs for the absolute-path tsx incantation that's necessary because of pnpm's cwd reset).

## CR-4 — Framework consumer rewiring [RESOLVED by rebase]

**Status:** Resolved by the rebase on the TML-2397 close-out tip (2026-05-09).

The `MigrationPackage` unification (CR-2) was the seam. The CLI's `runContractSpaceExtensionMigrationsPass` now consumes a single `MigrationPackage` shape from the descriptor, which the descriptor synthesises by JSON-importing the extension's emitted artefacts (`contract.json`, `migrations/<space-id>/<dirName>/{migration.json, ops.json}`) and computing `dirPath` from `import.meta.url`.

## CR-5 — Verify cipherstash query operators are extension-owned (sanity check)

**Status:** Done. Recording for completeness.

This worktree's HEAD already carries:

- `8e1e741f6 refactor(extension-cipherstash): register operators under unique names (cipherstashEq, cipherstashIlike)`
- `414744fc9 feat(extension-cipherstash): drop equality trait; lock loud-failure on email.eq for cipherstash columns`
- `cf5e7fe73 docs(project-1): cipherstash search operators are namespaced; codec declares no traits`

The query-operator surface is extension-owned and namespaced — no framework operator is overridden. ADR 211 (in `docs/architecture docs/adrs/`) records the principle. The remaining type-visibility gap for `cipherstashEq` / `cipherstashIlike` on model accessors is tracked under TML-2435 and is *not* covered by this CR (the user previously moved it back into project-1 AC scope; it's open work but was deferred to this rebase).

## Sequencing

1. ~~Rebase `tml-2373-project-1-on-2397` on `tml-2397-remove-database-dependencies-and-closeout`~~ — **DONE 2026-05-09.** Replayed 50 project-1-unique commits onto closeout-tip; skipped 57 TML-2397 duplicates. Three conflict resolutions (cipherstash `package.json` deps union; two README/test docstrings taken from closeout to preserve M3.5 wording). One follow-up commit (`fix(extension-cipherstash): forward-port e2e tests to on-disk contractSpace (post-rebase)`) rewires three e2e tests off the deleted in-memory `core/{contract,migrations}` modules onto `descriptor.contractSpace`.
2. **TODO** — Implement **CR-1** on the rebased branch (public, user-callable migration-op factories + renderable IR via the codec hook).
3. **TODO** — Address **TML-2435** (CR-5's residual: `QueryOperationTypes` type-visibility for `cipherstashEq` / `cipherstashIlike` on model accessors).
4. Re-open project-1's PR.

Delete this file as part of the umbrella project's eventual close-out.

## Post-rebase sanity (2026-05-09)

- `pnpm --filter @prisma-next/extension-cipherstash test` — 21 files / 167 tests passing (incl. e2e: storage-roundtrip, scenario-a, umbrella, umbrella-nullable).
- `pnpm --filter cipherstash-integration-example typecheck` — clean.
- `pnpm lint:deps` — 790 modules / 1557 dependencies, no violations.
- `pnpm test:packages` — 113/113 packages green (full sweep after `--force` re-runs invalidated stale pre-rebase cache entries).
