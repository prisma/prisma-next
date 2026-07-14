# D3 — Mongo family derives scalar types from the unified namespace

**Slice plan:** `projects/remove-db-attributes/slices/unify-type-channel/plan.md` · **Tier:** mid · **Branch:** `tml-2985-unify-type-channel`

## Task

D1 (`7ec6d817`) contributed mongo's six scalars (incl. `ObjectId`) as top-level zero-arg constructors; D2 (`7e5857cf`) moved the SQL family + LSP onto the namespace and introduced the shared walk `collectScalarTypeConstructors` (framework-components, exported via `exports/authoring.ts`) plus `ControlStack.scalarTypes`. This dispatch does the same re-pointing for the **mongo family**: its provider/interpreter derive the `name → codecId` view from the namespace instead of `context.scalarTypeDescriptors`. The map channel stays alive until D4.

## Outcome (property statement)

The mongo provider derives its scalar-type knowledge from top-level zero-arg constructors via the shared walk, **such that** mongo contract emission is byte-identical (parity test) and the mongo interpreter's internal resolution logic is unchanged — the derivation swap is invisible below the provider boundary (family layer keeps owning its resolution; no framework knowledge of mongo specifics is added: F18).

## In

- `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts` (map construction at ~L64–80) — derive from `context.authoringContributions.type` using `collectScalarTypeConstructors`; the interpreter's `ReadonlyMap<string, string>` input shape may stay as-is (derive `name → codecId` from the walk) or align with SQL's naming — pick the smaller diff.
- Parity test: one representative mongo schema emits a byte-identical contract before/after (mirror the shape of `packages/3-extensions/postgres/test/scalar-type-parity.test.ts` from D2); pin `{ codecId }` (+nativeType where carried) for all six scalars.
- Grep gate: `rg 'scalarTypeDescriptors' packages/2-mongo-family --type ts -g '!*test*'` → zero hits after this dispatch.

## Out

- Deleting the map channel / `assembleScalarTypeDescriptors` / `ContractSourceContext.scalarTypeDescriptors` / adapter maps / `validateScalarTypeCodecIds` (D4).
- Any SQL-family or LSP file (D2 finished those). Any mongo authoring-syntax or semantic change.

## Edge cases

| Case | Disposition |
| --- | --- |
| `MONGO_OBJECT_ID_PSL_TYPE` special lookup (interpreter ~L1102) | Must keep working — it reads the same derived map; add/keep a test exercising an ObjectId field. |
| mongodb-memory-server cannot bootstrap on this host (`UnknownLinuxDistro: nixos`) | Known environmental failure — pre-existing, fails before code-under-test runs. Scope your test runs to non-memory-server suites where possible; note which suites were skipped for this reason. Do NOT try to fix the environment. |
| Emission drift | Halt condition — report, don't fix forward. |
| Destructive git operations | **Forbidden**; commit with `git commit -s`. |

## Completed when

1. Grep gate above → 0; mongo provider compiles against the namespace walk only.
2. Parity test green; `pnpm typecheck`, `pnpm --filter <touched-pkg> lint` + tests (excluding environmentally-broken memory-server suites, named explicitly), `pnpm fixtures:check` zero drift, `pnpm lint:deps` clean.

## Report back

Files touched; derivation location; parity-test name; gates run + results (memory-server exclusions named); F1/F3/F14/F18 checked; commit SHA.
