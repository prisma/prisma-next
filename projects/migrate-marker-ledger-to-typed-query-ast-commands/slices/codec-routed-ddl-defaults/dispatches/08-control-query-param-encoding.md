# Brief: D8 — Codec-encode control-path query params (`lowerToExecuteRequest` query branch + Postgres `dataTransform`)

## The defect

`lowerToExecuteRequest(ast, ctx): Promise<SqlExecuteRequest>` promises **driver-ready, codec-encoded** params. Its DDL branch honours that (inline-encodes defaults). Its **query branch does not** — it forwards literal values raw:

```ts
// sqlite control-adapter.ts:187 / postgres control-adapter.ts:199
const params = lowered.params.map((p) => (p.kind === 'literal' ? p.value : p.name));
return { sql: lowered.sql, params };
```

The downstream control driver binds params raw (`SqlControlDriverInstance.query` applies no codec — confirmed). So a non-wire-ready literal (`Date`, `bigint`, JSON object, a transforming codec's input) is mis-bound. A `LoweredParam` literal carries no `codecId`, so the per-param codec must be derived from the AST.

**Reachability:** the query branch itself is latent today (every production caller of `lowerToExecuteRequest` passes a DDL node). But the **Postgres `dataTransform`** step has the identical raw-passthrough (`data-transform.ts:159-166`, `invokeAndLower`) and **is** fed real user query ASTs whose literals can be `Date`/`bigint`/JSON — that path is reachable. Both are the same root defect: the control path is the last chance to encode, and it doesn't.

## The fix — one encoded path, reused

There is already a correct, tested encoder for exactly this: `marker-ledger.ts` `execute()` (both targets):

```ts
const values = lowered.params.map((slot) => {
  if (slot.kind === 'literal') return slot.value;
  throw new Error('control DML lowered to a bind parameter, which is unsupported');
});
const encoded = await encodeParamsWithMetadata(values, deriveParamMetadata(query), {}, CONTROL_CODECS);
```

`CONTROL_CODECS = createAstCodecRegistry(<target>CodecRegistry)` and the three helpers come from `@prisma-next/sql-runtime`. `deriveParamMetadata(ast)` resolves each param's codec from the AST — that's the missing piece the `LoweredParam` literal lacks.

### 1. Extract a shared control-query encoder (per target, same package)

`CONTROL_CODECS` is currently module-private in `marker-ledger.ts`. Don't create a second copy. Extract into a small sibling module in the **same package** (`packages/3-targets/6-adapters/<target>/src/core/`), e.g. `control-codecs.ts`:

```ts
export const CONTROL_CODECS = createAstCodecRegistry(<target>CodecRegistry);

// lowered: the LoweredStatement from renderLoweredSql; ast: the source query AST
export async function encodeControlQueryParams(
  lowered: LoweredStatement,
  ast: AnyQueryAst,
): Promise<readonly unknown[]> {
  const values = lowered.params.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    throw new Error(`control query lowered to a bind slot '${slot.name}', which is unsupported`);
  });
  return encodeParamsWithMetadata(values, deriveParamMetadata(ast), {}, CONTROL_CODECS);
}
```

Re-point `marker-ledger.ts` `execute()` at this shared helper (it must keep behaving identically — its tests must stay green unchanged).

### 2. Encode in the `lowerToExecuteRequest` query branch (both targets)

```ts
// query branch, replacing the raw .map
const lowered = renderLoweredSql(ast, <contract cast>);
const params = await encodeControlQueryParams(lowered, ast);
return { sql: lowered.sql, params };
```

The bind-slot case now throws (was: emitted `p.name` as a value — nonsensical, and no caller depended on it; the investigation found zero query-AST callers of this branch). DDL branch unchanged.

### 3. Route Postgres `dataTransform` through the encoded path

`packages/3-targets/3-targets/postgres/src/core/migrations/operations/data-transform.ts`, `invokeAndLower` (~150-167): replace the `adapter.lower(plan.ast, {contract})` + manual raw `slot.value` extraction with the adapter's now-encoding method:

```ts
async function invokeAndLower(...): Promise<SqlExecuteRequest> {
  const result = closure();
  const plan = isBuildable(result) ? result.build() : result;
  assertContractMatches(plan, contract, name);
  return adapter.lowerToExecuteRequest(plan.ast, { contract });
}
```

`invokeAndLower` becomes **async**. Thread the `await` through its caller(s) in `data-transform.ts`. The op-build path already tolerates async — `*Call.toOp()` returns `Op | Promise<Op>` from prior dispatches — but **verify** the specific `dataTransform` build site awaits correctly and the produced `Op` shape is unchanged. The bind-slot throw is now the adapter's (its message changed — update any test asserting the old `data-transform: bind-site slot …` text).

**SQLite `dataTransform`** takes a raw SQL string with no params (`sqlite/.../operations/data-transform.ts`) — **not affected**. Leave it; note it in your report.

## Tests — write these FIRST (repo rule: tests before implementation)

Reuse the synthetic **transforming** codec pattern from the D5 codec-wiring tests (a codec whose `encode` maps `'plaintext'` → `'ENC:PLAINTEXT'`, so the raw value is provably absent from the output). Per target:

1. **Control adapter query-branch encode** — `lowerToExecuteRequest` on a query AST binding a literal whose column codec transforms: assert the returned `params` contains the **encoded** wire value and **not** the raw input. (This is the regression-proof for the latent gap — without the fix, raw value leaks through.)
2. **Bind slot rejected** — a query AST that lowers to a bind slot throws from `lowerToExecuteRequest`.
3. **Postgres `dataTransform` encode** — a `dataTransform` whose filled run-plan binds a codec-transforming literal: assert the op's execute-step `params` carry the encoded wire value, not the raw JS value. (Reachable-bug regression proof.)
4. Keep the existing `marker-ledger` `execute()` tests green unchanged (proves the extraction is behaviour-preserving).

A failing-before/passing-after assertion on the raw value's absence is the point — make it impossible to pass without the encode.

## Gates (all must pass)

`pnpm build` · `pnpm typecheck` · `pnpm test:packages` · `pnpm fixtures:check` (**must stay clean** — encoding builtin codecs is byte-identical; any golden drift means something real changed, stop and report) · `pnpm lint:deps` (run **standalone** — hook OOMs) · `pnpm lint:casts` (**delta 0** — use `blindCast`/`castAs` if a cast is unavoidable, never bare `as`) · `pnpm test:integration` · `pnpm test:e2e`. Known ignorable flake: PG `portal "C_n" does not exist` that passes in isolation. Also note (do not try to fix, not ours): `init-journey.e2e.test.ts` "Failed to load config" — pre-existing, environmental.

## Layering note

Encode helpers import from `@prisma-next/sql-runtime` — already a dep of the adapter packages (marker-ledger uses it). The `control-codecs.ts` module lives in the same package as `marker-ledger.ts` and `control-adapter.ts` (6-adapters/<target>) — no new cross-package edge. `data-transform.ts` (3-targets) only calls `adapter.lowerToExecuteRequest`, a method it already holds — no new import. Confirm `pnpm lint:deps` stays green regardless.

## Commit

One commit, explicit staging (no `git add -A`), DCO `-s`, `--no-verify` (lint:deps OOMs in hook — run it standalone first), do NOT set `GIT_AUTHOR_*`. Do **not** push (orchestrator pushes via bot remote). Message:

```
TML-2867: codec-encode control-path query params

lowerToExecuteRequest's query branch forwarded literal params raw, contradicting
its driver-ready contract; the downstream control driver binds raw, so a
non-wire-ready literal (Date/bigint/JSON/transforming codec) was mis-bound. Encode
literal params via the shared control-query encoder (deriveParamMetadata +
encodeParamsWithMetadata + CONTROL_CODECS), extracted from marker-ledger so both
share one path. Route Postgres dataTransform — the one reachable caller that lowers
real user query ASTs — through the encoded path instead of extracting raw slots.
Bind slots in control queries now throw.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## Report back

Per-gate pass/fail with exact failing output for any failure; the commit SHA; confirmation that `fixtures:check` stayed clean; and any async-threading or layering issue you had to resolve in `dataTransform`.
