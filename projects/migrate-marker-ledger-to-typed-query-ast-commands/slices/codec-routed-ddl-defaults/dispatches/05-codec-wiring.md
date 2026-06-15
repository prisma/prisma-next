# Brief: D5 — Codec wiring: `codecRef` on the DDL IR, encode in the walker, memoize, fixtures

## What this dispatch does

This is the load-bearing dispatch — the one that makes the slice's name true. Today `lowerToExecutableStatement`'s DDL walkers (`pgInlineLiteral` / `sqliteInlineLiteral`) type-branch on the raw JS default value; the codec is never consulted. For builtin codecs that happens to produce identical output, so the visible Date/bigint bug fix works — but an extension codec (encrypted column, custom domain) would inline the raw value instead of its encoded wire form. Wrong SQL, same class of bug the slice set out to kill.

D4 (commit `ad2df254e`) landed the renames + quick wins. D5 wires the codec. D6 deletes the old DDL renderer. Read the spec's "Spec amendment — 2026-06-09 (review round)" section before starting.

## Concrete changes

### 1. `DdlColumn` carries a `codecRef`

`packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts` — the `DdlColumn` class (line ~68). Add an optional `codecRef`:

```ts
import type { CodecRef } from './codec-types'; // re-exported there from framework-components/codec

export class DdlColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull?: boolean | undefined;
  readonly primaryKey?: boolean | undefined;
  readonly default?: AnyDdlColumnDefault | undefined;
  readonly codecRef?: CodecRef | undefined;   // NEW

  constructor(options: {
    readonly name: string;
    readonly type: string;
    readonly notNull?: boolean;
    readonly primaryKey?: boolean;
    readonly default?: AnyDdlColumnDefault;
    readonly codecRef?: CodecRef;              // NEW
  }) {
    // ... assign codecRef; keep Object.freeze(this)
  }
}
```

`CodecRef` is `{ codecId: string; typeParams?: JsonValue }`. It survives JSON serialization (relevant because DDL nodes embed in migration ops). relational-core may import it from framework-components (framework is below the SQL family).

### 2. Planner populates `codecRef`

Both targets build `DdlColumn`s in `issue-planner.ts` (`toDdlColumn` in PG, `tableToDdlParts` in SQLite — grep for `new DdlColumn(`). At those sites the planner has the source `StorageColumn` (or the resolved `(codecId, nativeType, typeParams)` triplet — see `contract-to-schema-ir.ts:126` / `verify-sql-schema.ts:1270` for the `Pick<StorageColumn, 'codecId'|'nativeType'|'typeParams'>` shape already in use).

Populate `codecRef` from `column.codecId` + `column.typeParams`:

```ts
new DdlColumn({
  name,
  type: typeSql,
  ...(notNull ? { notNull: true } : {}),
  ...ifDefined('default', colDefault),
  ...ifDefined('codecRef', column.codecId
    ? { codecId: column.codecId, ...ifDefined('typeParams', column.typeParams) }
    : undefined),
});
```

- The SQLite **inline-autoincrement** path (`new DdlColumn({ type: \`${typeSql} PRIMARY KEY AUTOINCREMENT\` })`) has no default — leave `codecRef` unset there.
- If a construction site genuinely lacks `codecId` (some synthetic columns might), leave `codecRef` undefined — the fallback rule (step 4) covers it.

### 3. The walker resolves + encodes (async)

The DDL walkers live in both adapters' `control-adapter.ts` (`pgRenderDdlExecutableStatement` / `PgDdlExecutableStatementVisitor`, and the SQLite mirror). Today the flow is sync: `ast.accept(new Visitor())` → `DriverStatement`, and `pgInlineLiteral(default.value, nativeType)` type-branches the raw value.

After D5, when a `LiteralColumnDefault` is on a column **with** a `codecRef`:

1. Resolve the codec: `const codec = this.codecLookup.get(column.codecRef.codecId)`. This is the established resolution path — `CodecLookup.get(id)` is already documented as the surface `family.deserializeContract` uses to `decodeJson` literal column defaults; encode is its mirror.
2. `const wire = await codec.encode(default.value, {})` — the `{}` is an empty `SqlCodecCallContext` (no signal, no column; encode-at-plan-time has no per-query context). This mirrors `5-runtime/src/codecs/encoding.ts:112` (`await codec.encode(value, ctx)`).
3. Feed `wire` into the existing `pgInlineLiteral(wire, nativeType)` / `sqliteInlineLiteral(wire, nativeType)`. The inline helpers already format whatever wire shape they receive (string/number/bigint/boolean/Uint8Array/Date/object) — minimal change.

When a column has **no** `codecRef` (contract-free user-authored `col()` calls): keep today's behavior — `pgInlineLiteral(default.value, nativeType)` on the raw value. This is the documented fallback: codec-less literal defaults follow `RawSqlLiteral` wire-scalar semantics. Add a short comment at the branch naming the rule.

**The async wrinkle (negotiable mechanism, but name your choice):** `ast.accept(visitor)` is synchronous, but `codec.encode` is async. Options: (a) the visitor collects `(column, default)` encode-needs into a list, returns a template with placeholder slots, then an async pass fills them — the `lowerToExecutableStatement` method awaits that pass before returning; (b) restructure the DDL walk as a plain async function over `node.columns` rather than the visitor `accept` (the DDL node set is small and closed — `createTable` / `createSchema` — so a visitor isn't load-bearing here). Pick the one that reads cleanest; both are fine. If you find the visitor `accept` signature can't accommodate either without churn that spreads beyond the adapter, halt and surface.

**Resolution-granularity halt:** `CodecLookup.get(codecId)` keys on codec id alone, not `typeParams`. For the literal-default encode this is almost certainly the right granularity (a default value's encoding is column-type-level, not per-row-instance). But if you hit a parameterized codec whose `encode` needs the `typeParams`-materialized instance (which `get(id)` doesn't provide — that's `forCodecRef`'s job on `ContractCodecRegistry`, which the adapter does NOT hold), **halt and surface** — that's a real design question, not something to paper over with a cast.

### 4. Remove `{ contract: {} }`

The DDL path resolves codecs from `column.codecRef` + the adapter's `codecLookup`, not from `context.contract`. So the `{ contract: {} }` placeholders the `*Call.toOp` sites pass into `lowerToExecutableStatement` for DDL nodes are dead. Make the lowering-context `contract` optional for the DDL path (or the whole `context` param optional) and drop the `{ contract: {} }` literals at the `toOp` call sites in both targets' `op-factory-call.ts`. The query-AST branch of `lowerToExecutableStatement` still needs the real contract — keep that path's context.

### 5. Memoize the `operations` getter (review F1)

`PlannerProducedPostgresMigration` and `TypeScriptRenderableSqliteMigration` (the SQLite planner-produced class) have an `operations` getter that calls `renderOps(this.#calls, this.#lowerer)` fresh on every access — synth, stripOperations, and the runner each trigger an independent lowering. With codecs wired, a nondeterministic codec (column encryption) would make `displayOps` and the executed SQL differ. Memoize: compute the `(Op | Promise<Op>)[]` once (lazy, on first access), cache it, return the cached array on subsequent reads. A private `#operationsCache?: readonly (Op | Promise<Op>)[]` field guarded in the getter is enough.

### 6. Fixtures (resolve AC10 vacuous-green)

Add end-to-end migration fixture coverage for literal defaults that exercise the codec path:

- A `Date` default, a `bigint` default, a JSON-object default (these prove the visible bug fix).
- **One extension-codec default** — the case that distinguishes codec routing from type-branching. Requirements: pick a codec whose `encode(value)` produces output that **differs** from the type-branching inline of the raw value (otherwise the test can't tell routing from branching). Candidates: a bytea/blob column (Uint8Array wire vs raw), an enum codec, a pgvector column if its encode is non-identity. **If no shipping codec produces a divergent encode**, surface that — it's informative: it would mean codec routing has no observable effect on any current codec, which bears on the slice's value. Don't fabricate a divergence; report the finding.

Find the existing migration fixture harness (the `fixtures:emit` / `fixtures:check` path; likely `test/integration` migration fixtures or an examples migration). Add columns with these defaults to a fixture contract and let the golden regenerate. The regen IS the proof.

## Out of scope (D6)

- Migrating the marker/ledger bootstrap off `lower()`-for-DDL.
- Making `lower()` reject DDL nodes.
- Deleting the old DDL renderer (`renderLoweredDdl`, `defaultVisitor`) from either adapter.

Those stay until D6. In D5, `lower()` and the old renderer keep working unchanged.

## Completed when

- [ ] `DdlColumn` has `codecRef?: CodecRef`; constructor accepts it; still frozen.
- [ ] Both targets' planner construction sites populate `codecRef` from `StorageColumn.codecId` (+ typeParams); the SQLite inline-autoincrement path leaves it unset.
- [ ] Both walkers, for a codec-bearing literal default, resolve via `codecLookup.get(codecRef.codecId)` and `await codec.encode(value, {})`, then inline the wire result. The codec-less fallback is preserved with a comment naming the rule.
- [ ] No `{ contract: {} }` literals remain at DDL `toOp` call sites; the DDL lowering path doesn't depend on `context.contract`.
- [ ] `PlannerProduced*Migration.operations` memoized (one lowering per instance).
- [ ] Fixtures cover Date / bigint / JSON + one divergent extension-codec default end-to-end (or a surfaced finding that no divergent codec ships).
- [ ] `pnpm typecheck` green workspace-wide; `pnpm test:packages` green; `pnpm test:integration` green (this is where the migration fixtures run); `pnpm fixtures:check` green (with the new fixtures' goldens committed); `pnpm lint:deps` green; `pnpm lint:casts` delta ≤ 0.

## Halt conditions

- The async-encode wrinkle (step 3) can't be resolved inside the adapter without churn spreading to the shared DDL visitor interface or beyond — surface the boundary.
- A parameterized codec needs `forCodecRef`-style `typeParams` materialization that `codecLookup.get(id)` can't provide — surface; do not cast around it.
- No shipping codec produces an encode divergent from type-branching — surface as a finding (don't fabricate).
- A planner construction site has no access to `codecId` and the column genuinely needs codec routing — surface.
- Touching `lower()`, the old `renderLoweredDdl`/`defaultVisitor`, the bootstrap, or the runtime query path — wrong dispatch (D6 / never). Halt.
- More than 25 files — halt.
- 200+ tool calls without committing — halt.

## References

- **Spec (2026-06-09 amendment):** `../spec.md`
- **Plan (amendment, § Dispatch 5):** `../plan.md`
- `DdlColumn`: `packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts:68`
- `CodecRef`: `packages/1-framework/1-core/framework-components/src/shared/codec-types.ts:16` (re-exported via `relational-core/src/ast/codec-types.ts`)
- `CodecLookup.get`: `packages/1-framework/1-core/framework-components/src/shared/codec-types.ts:44` (doc names the decodeJson-of-literal-defaults precedent)
- Runtime encode precedent: `packages/2-sql/5-runtime/src/codecs/encoding.ts:45,112` (`forCodecRef` → `await codec.encode(value, ctx)`)
- Planner column-build sites: both `issue-planner.ts` (`toDdlColumn` / `tableToDdlParts`); the `(codecId, nativeType, typeParams)` triplet shape at `contract-to-schema-ir.ts:126`
- Walkers: `pgRenderDdlExecutableStatement` / `sqliteRenderDdlExecutableStatement` in the two adapters' `control-adapter.ts`

## Operational metadata

- **Model tier:** sonnet.
- **Time-box:** 90 minutes. **Tool-call budget:** 200 before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`. Branch: `tml-2867-codec-routed-ddl-defaults`. HEAD: `ad2df254e`.
- `pnpm`, never `npm`/`npx`. No bare `as` casts in production (`blindCast<T,'reason'>`). No TS import file extensions. No transient project refs in code or comments.
- Note: the pre-commit `lint-deps-focused` hook OOMs on large staged file sets; if it SIGKILLs, run `pnpm lint:deps` standalone (it passes), then commit with `--no-verify` and say so in the message.

## Commit + sign-off

Commit on the branch (split codecRef-plumbing / walker-encode / memoize+fixtures if natural). Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
