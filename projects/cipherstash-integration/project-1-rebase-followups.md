# Project 1 — code review items (post-rebase)

Code review items raised after project-1 was nominally closed out. As of 2026-05-09 the project's branch (`tml-2373-project-1-on-2397`) has been rebased on top of the TML-2397 close-out tip (`tml-2397-remove-database-dependencies-and-closeout`, M3.5 alignment + M5 polish + T5.9 deletion all merged). CR-2 / CR-3 / CR-4 are resolved by the rebase. The remaining work — **all in-scope on this branch, all part of project-1's acceptance criteria** — is **CR-1** + **CR-5** (operator type-visibility, supersedes the now-deleted TML-2435 ticket).

This file is the durable record. It lives under `projects/cipherstash-integration/` (sibling of project-2 + sql-raw-factory) — it'll be deleted alongside the umbrella project's eventual close-out, after CR-1 + CR-5 land and the project-1 PR is reopened.

## CR-1 — Cipherstash migration-op factories: public, user-callable, and renderable via the codec hook

**Status:** Designed (2026-05-09 design discussion); not yet implemented.

### Symptom

[`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts`](../../packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts) constructs migration ops as plain `SqlMigrationPlanOperation` records via file-private `buildAddOp` / `buildRemoveOp` helpers. `onFieldEvent` returns `readonly SqlMigrationPlanOperation<unknown>[]` (runtime op shapes, not renderable IR).

The postgres planner's merge point ([`packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:161-175`](../../packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:161-175)) wraps each codec-emitted op in a `RawSqlCall` (the unstructured-op fallback). Consequence: `prisma-next migration plan` against an app with `Encrypted<string>` columns renders cipherstash's contributions as verbose `rawSql({ id, label, operationClass, invariantId, target, precheck, execute: [{ description, sql }], postcheck })` blocks — see [`examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts`](../../examples/cipherstash-integration/migrations/20260508T1721_migration/migration.ts).

### Locked-in design (post-discussion)

The fix is a small, focused set of changes — *not* a renderer lift. The renderer stays in target-postgres (postgres owns its migration scaffolding). What changes is the type contract between the codec hook and the planner, plus cipherstash adding its own renderable Call classes that implement the framework `OpFactoryCall` interface directly.

#### 1. Promote framework `OpFactoryCall` to require the render+toOp surface

[`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:92-99`](../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:92-99) currently defines `OpFactoryCall` as a metadata-only interface (`factoryName`, `operationClass`, `label`). Both postgres's `PostgresOpFactoryCallNode` and mongo's `OpFactoryCallNode` already provide the render+toOp methods via `TsExpression` + abstract `toOp`, so promotion is a no-op for current implementers and aligns the type with its stated purpose ("framework-level contract for a single factory call in a target's planner IR").

```typescript
export interface OpFactoryCall {
  readonly factoryName: string;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;
  renderTypeScript(): string;
  importRequirements(): readonly ImportRequirement[];
  toOp(): MigrationPlanOperation;
}
```

`ImportRequirement` flows in from `@prisma-next/ts-render` (peer package within `1-framework/1-core`). `toOp()` returns the framework-level base `MigrationPlanOperation`; postgres / mongo / cipherstash subclasses narrow via covariant return.

This is a structural breaking change to a framework-public interface. Audited blast radius: zero — the only direct consumers are the postgres + mongo packages (which already satisfy the promoted shape) and `field-event-planner` test stubs (updated in the same change).

#### 2. Widen the codec hook contract — `OpFactoryCall[]`, hard-cut

[`packages/2-sql/9-family/src/core/migrations/types.ts`](../../packages/2-sql/9-family/src/core/migrations/types.ts) `CodecControlHooks.onFieldEvent` return type:

```typescript
// before
readonly onFieldEvent?: (
  event: FieldEvent,
  ctx: FieldEventContext,
) => readonly SqlMigrationPlanOperation<TTargetDetails>[];

// after
readonly onFieldEvent?: (
  event: FieldEvent,
  ctx: FieldEventContext,
) => readonly OpFactoryCall[];
```

No `OpFactoryCall | SqlMigrationPlanOperation` widening for back-compat. Cipherstash is the only production implementer; tests update in the same change.

[`packages/2-sql/9-family/src/core/migrations/field-event-planner.ts:65-67`](../../packages/2-sql/9-family/src/core/migrations/field-event-planner.ts:65-67) `planFieldEventOperations` return type changes from `readonly SqlMigrationPlanOperation<unknown>[]` to `readonly OpFactoryCall[]`. The `appendOps` accumulator changes accordingly.

#### 3. Drop the postgres planner's `RawSqlCall` wrap

[`packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:170-175`](../../packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:170-175) becomes simply:

```typescript
const calls = [...result.value.calls, ...fieldEventOps];
```

The cast through `RawSqlCall` is gone. Cipherstash's calls flow into the postgres call list as first-class `OpFactoryCall` instances and self-render.

#### 4. Widen postgres's renderer input type

[`packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts:46`](../../packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts:46) `renderCallsToTypeScript` parameter widens from `ReadonlyArray<PostgresOpFactoryCall>` to `ReadonlyArray<OpFactoryCall>`. Body is unchanged — already polymorphic via `call.renderTypeScript()` + `call.importRequirements()`. `BASE_IMPORTS` stays target-side (postgres still owns its scaffold's `Migration` + `MigrationCLI` re-exports).

`TypeScriptRenderablePostgresMigration`'s constructor signature widens to match.

#### 5. Cipherstash `*Call` classes — package-internal

```typescript
// packages/3-extensions/cipherstash/src/core/migration-call-classes.ts (new)
import type { OpFactoryCall, MigrationPlanOperation, MigrationOperationClass }
  from '@prisma-next/framework-components/control';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@prisma-next/ts-render';

const CIPHERSTASH_MIGRATION_MODULE = '@prisma-next/extension-cipherstash/migration';

abstract class CipherstashOpFactoryCallNode extends TsExpression implements OpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): SqlMigrationPlanOperation<unknown>;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: CIPHERSTASH_MIGRATION_MODULE, symbol: this.factoryName }];
  }

  protected freeze(): void { Object.freeze(this); }
}

export class CipherstashAddSearchConfigCall extends CipherstashOpFactoryCallNode {
  readonly factoryName = 'cipherstashAddSearchConfig' as const;
  readonly operationClass = 'additive' as const;
  readonly label: string;

  constructor(
    readonly table: string,
    readonly column: string,
    readonly index: 'unique' | 'match',
    readonly castAs: string = 'text',
  ) {
    super();
    this.label = `Register cipherstash search config (${index}) for ${table}.${column}`;
    this.freeze();
  }

  toOp(): SqlMigrationPlanOperation<unknown> {
    // Same shape as today's buildAddOp.
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

No shared framework-level `OpFactoryCallNode` abstract base — cipherstash extends `TsExpression` directly. If a fourth caller wants the boilerplate later, refactor then.

#### 6. Cipherstash public factories — `@prisma-next/extension-cipherstash/migration`

```typescript
// packages/3-extensions/cipherstash/src/exports/migration.ts (new)
export {
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from '../core/migration-call-classes';
export type { CipherstashSearchIndex } from '../core/migration-call-classes';
```

```typescript
// packages/3-extensions/cipherstash/src/core/migration-call-classes.ts (continued)
export type CipherstashSearchIndex = 'unique' | 'match';

export interface CipherstashSearchConfigArgs {
  readonly table: string;
  readonly column: string;
  readonly index: CipherstashSearchIndex;
  readonly castAs?: string;
}

export function cipherstashAddSearchConfig(
  args: CipherstashSearchConfigArgs,
): CipherstashAddSearchConfigCall {
  return new CipherstashAddSearchConfigCall(
    args.table, args.column, args.index, args.castAs ?? 'text',
  );
}
// ...cipherstashRemoveSearchConfig identical shape
```

User authoring a hand-written migration:

```typescript
import { Migration, MigrationCLI, createTable } from '@prisma-next/target-postgres/migration';
import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';

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

#### 7. Cipherstash's codec hook returns Calls

[`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts`](../../packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts) `onFieldEvent` builds Calls instead of Ops:

```typescript
function onFieldEvent(event, ctx): readonly OpFactoryCall[] {
  // same flag-to-index walk; calls factories instead of constructing ops
  ops.push(cipherstashAddSearchConfig({
    table: tableName,
    column: fieldName,
    index: FLAG_TO_INDEX[flag],
  }));
}
```

The flag-to-index walk stays inside cipherstash, not on the public API. The factory args expose the index name directly because users authoring migrations naturally express "I want a unique-index search config on this column," not "I want this column's `equality` flag to be true."

### Acceptance criteria

Round-trip property given a contract diff that adds `Encrypted<string>` with `equality: true, freeTextSearch: true` on `user.email`:

- `prisma-next migration plan` produces a `migration.ts` whose codec-emitted ops are exactly two `cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'unique' })` / `index: 'match'` calls. **Zero** `rawSql({ id: 'cipherstash-codec.*', ... })` blocks.
- The rendered `migration.ts` carries `import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';` automatically (deduped alongside postgres imports).
- Re-running `pnpm tsx migrations/.../migration.ts` re-emits `ops.json` byte-for-byte. Runtime op shape is unchanged; only IR / TS rendering changes.
- `migration.json` hash is preserved. The canonical content is invariant.
- Hand-written migrations using the public factory functions produce `ops.json` byte-identical to a planner-generated equivalent.

### Documentation

The implementation PR updates:

- **ADR 195 — Planner IR with two renderers**: amend to record (a) the framework `OpFactoryCall` interface promotion, (b) the inheritance-with-abstract-methods pattern as the actual chosen shape (the ADR's visitor-pattern section is stale relative to the postgres+mongo implementations), and (c) extensions can implement `OpFactoryCall` directly without depending on a target's package-private base.
- **ADR 212 — Codec lifecycle hooks**: amend the hook return type from `SqlMigrationPlanOperation[]` to `OpFactoryCall[]`. Update the mermaid flow diagram to reflect that codec-emitted output flows through the planner's call list (rendered to `migration.ts`) AND through `toOp()` derivation (rendered to `ops.json`).

### Estimate

~1 day. Bulk is the new Call classes + the migration export entry-point + the hook contract widening. Postgres planner change is two lines (drop the `.map(op => new RawSqlCall(...))` and the cast). The codec-hook walk barely changes (one line per branch: builds a Call instead of an Op).

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

## CR-5 — Cipherstash query operators: extension-owned + type-visible

**Status:** Runtime ownership done. Type-visibility designed (2026-05-09); not yet implemented. (Supersedes the now-cancelled TML-2435 follow-up — type-visibility is in-scope project-1 acceptance criteria and lands on this branch.)

### Runtime ownership — done

This worktree's HEAD already carries:

- `8e1e741f6 refactor(extension-cipherstash): register operators under unique names (cipherstashEq, cipherstashIlike)`
- `414744fc9 feat(extension-cipherstash): drop equality trait; lock loud-failure on email.eq for cipherstash columns`
- `cf5e7fe73 docs(project-1): cipherstash search operators are namespaced; codec declares no traits`

The query-operator surface is extension-owned and namespaced — no framework operator is overridden. [ADR 211 — Extension operator surface](../../docs/architecture%20docs/adrs/ADR%20211%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md) records the principle. [`packages/3-extensions/cipherstash/src/core/operators.ts`](../../packages/3-extensions/cipherstash/src/core/operators.ts) registers `cipherstashEq` / `cipherstashIlike` via `cipherstashQueryOperations()` returning `SqlOperationDescriptor[]`; the runtime descriptor wires them through the cipherstash extension's runtime contribution.

### Type-visibility — locked-in design

The cipherstash extension currently has *runtime* operators registered, but the TypeScript type surface doesn't make them discoverable on `cipherstash/string@1` codec accessors or via the SQL query builder's operation-typed APIs. Users calling `db.user.findMany({ where: { email: { cipherstashEq: '...' } } })` get no autocomplete / no type-checking from the codec accessor side, and `sql().where(t => t.email.cipherstashEq('...'))` is not type-visible either.

The fix mirrors `pgvector`'s pattern ([`packages/3-extensions/pgvector/src/types/operation-types.ts`](../../packages/3-extensions/pgvector/src/types/operation-types.ts)):

#### 1. Declare `OperationTypes` + `QueryOperationTypes` on cipherstash

```typescript
// packages/3-extensions/cipherstash/src/types/operation-types.ts (new)
import type { CodecExpression, CodecTypesBase, Expression } from '@prisma-next/family-sql/types';
import type { SqlQueryOperationTypes } from '@prisma-next/family-sql/types';

/** Flat operation signatures for the SQL query builder. */
export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly cipherstashEq: {
      readonly self: { readonly codecId: 'cipherstash/string@1' };
      readonly impl: (
        self: CodecExpression<'cipherstash/string@1', boolean, CT>,
        other: CodecExpression<'cipherstash/string@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly cipherstashIlike: {
      readonly self: { readonly codecId: 'cipherstash/string@1' };
      readonly impl: (
        self: CodecExpression<'cipherstash/string@1', boolean, CT>,
        pattern: CodecExpression<'pg/text@1', boolean, CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
  }
>;
```

(Final return-type codec ID `pg/bool@1` is subject to verification against pgvector's existing reference; if cipherstash's runtime lowers to a non-postgres-namespaced bool, this matches that.)

#### 2. Re-export from a stable subpath

```typescript
// packages/3-extensions/cipherstash/src/exports/operation-types.ts (new)
export type { QueryOperationTypes } from '../types/operation-types';
```

`package.json` `exports` adds the `./operation-types` subpath. App-side usage:

```typescript
import type { QueryOperationTypes as CipherstashOps }
  from '@prisma-next/extension-cipherstash/operation-types';
```

The application's contract emit pipeline already composes extension operation types through the `extensionPacks` array; verifying this end-to-end (model accessor + query builder) is part of the AC.

### Acceptance criteria (type-visibility)

- `db.user.findMany({ where: { email: { cipherstashEq: '...' } } })` type-checks; `cipherstashEq` autocompletes on `email` (a `cipherstash/string@1` column) but does NOT autocomplete on a plain `pg/text@1` column.
- `sql(t).where(t => t.email.cipherstashEq('...'))` type-checks; `t.email.cipherstashEq` is callable, returns the right boolean expression type.
- `db.user.findMany({ where: { email: { eq: '...' } } })` continues to NOT type-check (the equality-trait removal already enforces this at runtime + the codec emits no `eq` at the type level).
- A negative type-test (intentional `@ts-expect-error`) covers `cipherstashEq` on a non-cipherstash column.

### Documentation

The implementation PR updates:

- **ADR 211 — Extension operator surface (namespaced replacement operators)**: amend to note that namespaced replacement operators must also project type-visibility through `QueryOperationTypes`. The runtime ownership half of the ADR already covers the registration pattern; the type-visibility half is the missing companion mechanism.

### Estimate

~½ day. Two new files + a `package.json` exports entry + the negative type-test. Mostly mirroring the pgvector reference.

## Sequencing

1. ~~Rebase `tml-2373-project-1-on-2397` on `tml-2397-remove-database-dependencies-and-closeout`~~ — **DONE 2026-05-09.** Replayed 50 project-1-unique commits onto closeout-tip; skipped 57 TML-2397 duplicates. Three conflict resolutions (cipherstash `package.json` deps union; two README/test docstrings taken from closeout to preserve M3.5 wording). One follow-up commit (`fix(extension-cipherstash): forward-port e2e tests to on-disk contractSpace (post-rebase)`) rewires three e2e tests off the deleted in-memory `core/{contract,migrations}` modules onto `descriptor.contractSpace`.
2. **NEXT** — Implement **CR-1** on the rebased branch (public, user-callable migration-op factories + renderable IR via the codec hook). Includes ADR 195 + ADR 212 amendments.
3. **AFTER CR-1** — Implement the type-visibility half of **CR-5** (`QueryOperationTypes` for `cipherstashEq` / `cipherstashIlike`). Includes the ADR 211 amendment. Cancel the TML-2435 Linear ticket once shipped.
4. Re-open project-1's PR.

Delete this file as part of the umbrella project's eventual close-out.

## Post-rebase sanity (2026-05-09)

- `pnpm --filter @prisma-next/extension-cipherstash test` — 21 files / 167 tests passing (incl. e2e: storage-roundtrip, scenario-a, umbrella, umbrella-nullable).
- `pnpm --filter cipherstash-integration-example typecheck` — clean.
- `pnpm lint:deps` — 790 modules / 1557 dependencies, no violations.
- `pnpm test:packages` — 113/113 packages green (full sweep after `--force` re-runs invalidated stale pre-rebase cache entries).
