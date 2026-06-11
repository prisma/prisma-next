# Brief: D1 — Define `DriverStatement` + add `lowerToDriverStatement` on both adapters (purely additive)

## Mental model — read this before you touch any file

This dispatch is **purely additive**. The new method `lowerToDriverStatement` is a SECOND, INDEPENDENT path through the adapter. It does NOT share output with the existing `lower()` method. It does NOT depend on changes to the existing renderer. The existing `lower()`, the existing renderer's `defaultVisitor.literal`, `LoweredStatement`, `LoweredParam`, and all their consumers stay **bit-for-bit unchanged** after this dispatch.

The bug we eventually want to fix (Date / bigint / jsonb defaults producing wrong SQL via the renderer's hand-rolled type-branching) **stays unfixed in D1**. D1 only adds the substrate. D2 and D3 migrate `*Call.toOp()` consumers onto the new method, which is when the bug fix manifests.

### Anti-pattern — DO NOT do this

A prior attempt at this dispatch ended up modifying `lower()` to call a new sync helper that materialized DDL literal defaults inline, so that existing `*Call.toOp()` callers consuming `lower()`'s output kept getting executable SQL. **That was wrong.** It muddled the two methods into one shared path.

The agreed design is two **independent** methods on the adapter:

```ts
interface SqlControlAdapter<TTarget extends string = string> extends Lowerer {
  // existing — bit-for-bit unchanged
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;

  // new — independent, async, does its own work
  lowerToDriverStatement(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): Promise<DriverStatement>;
}
```

If you find yourself modifying `lower()`, the renderer's `defaultVisitor.literal`, `LoweredStatement`'s shape, or `LoweredParam`'s shape — **halt and surface**. None of those change in D1.

## Concrete changes

### 1. Define `DriverStatement` type

Where: co-locate with `LoweredStatement` at `packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1984`.

```ts
/**
 * Fully lowered SQL payload ready for direct driver execution.
 *
 * Produced by `SqlControlAdapter.lowerToDriverStatement`. All literal values that
 * required inline substitution (e.g. DDL `DEFAULT` clauses where the dialect
 * grammar forbids parameters) have been encoded by their column's codec and
 * substituted back into `sql`; `params` holds only the codec-encoded wire values
 * for parameterizable positions, in placeholder order.
 */
export interface DriverStatement {
  /** Fully lowered SQL — all inline literals materialized. */
  readonly sql: string;
  /** Codec-encoded wire values for parameterizable `$N` positions; driver-ready. */
  readonly params: readonly unknown[];
}
```

Export from the package's `exports` surface (whatever `LoweredStatement` exports through). No changes to `LoweredParam` or `LoweredStatement`.

### 2. Add `lowerToDriverStatement` to `SqlControlAdapter`

Where: `packages/2-sql/9-family/src/core/control-adapter.ts` around line 232 (where the existing `lower` is declared on `SqlControlAdapter`).

```ts
export interface SqlControlAdapter<TTarget extends string = string> extends ... {
  // existing, unchanged
  lower(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): LoweredStatement;

  // new
  /**
   * Lower an AST all the way to a driver-ready statement. Encodes every literal
   * value through its column's codec and substitutes inline those that grammar
   * forbids parameterizing (e.g. DDL `DEFAULT` clauses on PG/SQLite).
   *
   * Independent of `lower()` — does its own AST walk and produces `DriverStatement`
   * directly. The runtime query path continues to use `lower()` + the runtime
   * middleware lifecycle; this method exists for the control plane path that
   * persists migration ops directly to ops.json with no middleware sandwich.
   */
  lowerToDriverStatement(
    ast: AnyQueryAst | DdlNode,
    context: LowererContext<unknown>,
  ): Promise<DriverStatement>;
}
```

Do NOT extend the structural `Lowerer` interface (the one used by the runtime query path) — only `SqlControlAdapter` gets the new method. Runtime consumers of `Lowerer` see no change.

### 3. Implement `lowerToDriverStatement` on PG

Where: `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` (the class with the existing sync `lower` at line 157).

Add the method as a new `async` method on the class. **Do not modify the existing `lower` method.** Implementation walks the AST and produces `DriverStatement` directly. How it shares code with the existing renderer is your call — could be a separate parameterized visitor in the same file or a sibling file, could be a fresh AST walk that inlines everything itself. The constraint is that the existing renderer's exported surfaces (`renderLoweredDdl`, `defaultVisitor`) stay byte-for-byte unchanged and continue to behave exactly as they do today.

Pseudocode:

```ts
async lowerToDriverStatement(
  ast: AnyQueryAst | PostgresDdlNode,
  context: LowererContext<unknown>,
): Promise<DriverStatement> {
  // walk the AST and produce { sql, params } directly.
  // For each LiteralColumnDefault encountered (DDL paths):
  //   - resolve the codec from this.codecLookup using the column's native type
  //   - await codec.encode(literal.value, {})
  //   - render the wire value as an inline SQL literal using a PG-specific helper
  //   - inline the result into the sql string with proper quoting + cast suffix
  // For literal/bind parameters in parameterizable positions (most query positions):
  //   - codec-encode and append wire value to the output params array
  //   - emit `$N` in the sql string
  // For query ASTs (non-DDL): same general approach, but every position is
  //   parameterizable so nothing inlines.
  // ...
  return { sql, params: wireParams };
}
```

PG-specific inline-literal helper (new, lives alongside `lowerToDriverStatement` or in a helper file in the adapter package):

- `string` wire → `'${escapeLiteral(s)}'` + `::${nativeType}` if not text-like (reimplements the TML-2861 `isTextLikeNativeType` decision; don't move the helper from the renderer — leave the renderer's copy intact).
- `Uint8Array` wire → `'\\x${bytesToHex(b)}'::bytea`.
- `number` / `bigint` wire → bare numeric string (`String(value)`).
- `boolean` wire → bare `true` / `false`.
- Objects (JSON-serializable) → `'${escapeLiteral(JSON.stringify(value))}'::${nativeType}`.
- `Date` wire → `'${escapeLiteral(value.toISOString())}'::${nativeType}`.
- Anything else → throw with a named error envelope.

Codec resolution: the adapter has `this.codecLookup` (the existing field). For a `LiteralColumnDefault` on a column with native type `text` (or `jsonb`, etc.), resolve the codec via `this.codecLookup` keyed by native type. If your AST walk doesn't have the column's native type in scope at the literal-default node, thread it down through the visitor context.

### 4. Implement `lowerToDriverStatement` on SQLite

Where: `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts` (the class with the existing sync `lower` at line 128).

Same shape as PG, modulo dialect differences:
- No `::nativeType` cast suffix anywhere — SQLite has no cast syntax in DDL.
- `Uint8Array` wire → `X'${bytesToHex(b)}'` (SQLite blob literal syntax).
- `boolean` wire → `0` / `1` (SQLite has no boolean type).
- `string` / `number` / `bigint` wire same as PG (minus the cast suffix).

### 5. Adapter-level tests

Where: `packages/3-targets/6-adapters/postgres/test/` + `packages/3-targets/6-adapters/sqlite/test/` — new test files for `lowerToDriverStatement`.

Each test file covers, at minimum:
- A `CREATE TABLE` with a `string` literal default → SQL has the value inlined with single-quoting + (PG) cast suffix.
- A `CREATE TABLE` with a `Date` literal default → SQL has ISO-formatted single-quoted + (PG) cast.
- A `CREATE TABLE` with a `bigint` literal default → SQL has the numeric value inlined unquoted.
- A `CREATE TABLE` with a `boolean` literal default → SQL has `true`/`false` (PG) or `0`/`1` (SQLite).
- A `CREATE TABLE` with a JSON-object literal default → SQL has JSON-stringified + single-quoted + (PG) `::jsonb` cast.
- A `CREATE TABLE` with a `null` literal default → SQL has `DEFAULT NULL`.
- A `CREATE TABLE` with no literal default and one `function` default → SQL has the function expression intact.

Tests assert that the EXISTING `lower()` method's output is unchanged — call `adapter.lower(sameNode, sameCtx)` and assert it produces the same SQL it did before D1 (bit-for-bit byte-parity with main).

### 6. What stays unchanged (verified by grep / read-back)

- `Lowerer.lower()` interface signature.
- `SqlControlAdapter.lower()` interface signature.
- `LoweredStatement` shape.
- `LoweredParam` shape (no `inlineRequired`, no `nativeType`, no `codecRef`; the union stays as `{kind:'literal', value:unknown} | {kind:'bind', name:string}`).
- `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts` (the entire file is unchanged — `defaultVisitor`, `renderColumn`, `renderLoweredDdl`, `isTextLikeNativeType`, all of it).
- `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` (entire file unchanged).
- `PostgresControlAdapter.lower()` body.
- `SqliteControlAdapter.lower()` body.
- `*Call.toOp()` bodies (every one of them).
- `MigrationPlan` and `MigrationPlanWithAuthoringSurface` framework interfaces.
- All runners, planner-strategies, synth.ts, CLI consumers.
- The 5-runtime layer (`packages/2-sql/5-runtime/src/codecs/encoding.ts` and friends).

If grep shows a diff in any of these after your work, surface — the dispatch leaked.

## Completed when

- [ ] `DriverStatement` type defined and exported.
- [ ] `SqlControlAdapter.lowerToDriverStatement(ast, ctx): Promise<DriverStatement>` exists on the interface.
- [ ] `lowerToDriverStatement` implemented on `PostgresControlAdapter` and `SqliteControlAdapter`. Each implementation walks the AST and produces `DriverStatement` directly — does NOT call `this.lower()` and does NOT share output with `lower()`.
- [ ] PG inline-literal substitution helper handles `string` / `Date` / `Uint8Array` / `number` / `bigint` / `boolean` / `null` / JSON-object wire types with proper quoting + cast suffix; throws on unexpected wire types with a named error.
- [ ] SQLite inline-literal substitution helper handles the same wire shapes minus cast suffix, with SQLite-specific blob literal + boolean-as-0/1.
- [ ] Adapter-level tests for `lowerToDriverStatement` covering each literal-default kind across both targets.
- [ ] Tests that pin `lower()`'s output unchanged after D1 (byte-parity against main).
- [ ] `Lowerer.lower()` / `LoweredStatement` / `LoweredParam` / the entire renderer file on both targets / `*Call.toOp` bodies / framework interfaces / runners / consumers — ALL bit-for-bit unchanged. `git diff main packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts` returns empty. Same for SQLite.
- [ ] No goldens regenerated (D1 doesn't migrate consumers; nothing should regenerate). `pnpm fixtures:check` green with no fixture diffs.
- [ ] `pnpm typecheck` green workspace-wide.
- [ ] `pnpm test:packages` green.
- [ ] `pnpm lint:deps` + `pnpm lint:casts` green.

## Halt conditions

- You're about to modify `lower()`, `LoweredStatement`, `LoweredParam`, or anything in `ddl-renderer.ts`. **Halt.** D1 is purely additive; the agreed design rejects any change to those surfaces.
- The AST walk inside `lowerToDriverStatement` shares non-trivial logic with the existing renderer in a way that requires extracting the existing renderer's code into a shared helper. **Halt** — duplicating is fine for D1; refactoring the renderer is out of scope. A follow-up can deduplicate after the slice lands.
- A codec implementation returns a wire type outside the documented set and the helper can't format it. Surface with the codec name + wire type.
- A migration golden regenerates. **Halt** — something leaked. D1 doesn't migrate consumers; nothing should change shape.
- The runtime query path tests fail. **Halt.** The slice should NOT touch that path.
- More than 25 source files modified. **Halt.**
- 200+ tool calls without committing. **Halt.**

## Standing instruction

Stay focused. Purely additive. Do NOT improve adjacent code. Do NOT delete the existing renderer's type-branching (even though it's broken for Date/bigint/jsonb). The bug fix is for D2/D3 to manifest by migrating consumers, not for D1 to fix in the renderer.

If two slices of logic look duplicate-y (the renderer's inline substitution and your new helper), accept the duplication — refactoring is a follow-up. The architecture for D1 is "add a parallel path"; cleanups come after.

## References

- **Spec:** [`../spec.md`](../spec.md) — full design.
- **Plan:** [`../plan.md`](../plan.md) § Dispatch 1.
- **Codec interface:** `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:75` (`encode`).
- **Existing `Lowerer.lower`:** `packages/2-sql/9-family/src/core/control-adapter.ts:31`.
- **Existing PG `lower` impl:** `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:157`.
- **Existing SQLite `lower` impl:** `packages/3-targets/6-adapters/sqlite/src/core/control-adapter.ts:128`.
- **PG renderer (untouched):** `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts`.
- **SQLite renderer (untouched):** `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts`.
- **`LoweredStatement` / `LoweredParam`:** `packages/2-sql/4-lanes/relational-core/src/ast/types.ts:1980`.

## Operational metadata

- **Model tier:** sonnet — substrate work + adapter implementation.
- **Time-box:** 90 minutes wall-clock. Surface at 90 minutes.
- **Tool-call budget:** 200 max before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- Branch: `tml-2867-codec-routed-ddl-defaults`.
- `pnpm`, never `npm` / `npx`.
- No bare `as` casts in production code; tests exempt.
- No TS import file extensions.
- No transient project refs in code or comments.

## Commit + sign-off

Commit on `tml-2867-codec-routed-ddl-defaults`. Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Commit message describes the structural change concisely (e.g. `add lowerToDriverStatement + DriverStatement — additive substrate, no consumer changes`).
