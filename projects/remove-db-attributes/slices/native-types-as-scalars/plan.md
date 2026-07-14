# Slice plan: native-types-as-scalars

**Slice spec:** `projects/remove-db-attributes/slices/native-types-as-scalars/spec.md`
**Linear:** [TML-2986](https://linear.app/prisma-company/issue/TML-2986) · **Parent branch:** `remove-db-attributes-from-psl`
**Slice branch:** `tml-2986-native-types-as-scalars`

## Dispatch sequence

1. **D1 — Bare-name sugar + symbol-table gate**
   - **Outcome:** a top-level constructor whose arguments are all optional resolves in bare position exactly as its zero-arg call (`T` ≡ `T()`), via the broadened scalar projection / plain-name resolution, **such that** resolution has one authoritative path per name and no dual mechanism survives. Carries the **⛔ operator gate**: evaluate retiring `scalarTypes` from `buildSymbolTable`; deciding against it is a HALT-and-escalate, never a silent keep.
   - **Builds on:** slice-1 substrate (merged).
   - **Hands to:** the resolution semantics D2's optional-arg contributions rely on.
2. **D2 — Postgres native-type contributions + parity proof**
   - **Outcome:** the eleven native types are contributed per the spec's table and authorable in both positions, **such that** each emits byte-identical `{ codecId, nativeType, typeParams }` to its `@db.*` equivalent (parity tests discriminate per F13: they compare against the live `@db.*` path, not hardcoded copies of it).
   - **Builds on:** D1's bare-name sugar (bare `VarChar` legality).
   - **Hands to:** the full bare-type surface D3's JSON work and slice 3's migration consume.
3. **D3 — JSON re-bind (`Json` → pg/json, `Jsonb` new) + in-repo green**
   - **Outcome:** postgres's `Json` contribution carries `pg/json@1`/`json` and `Jsonb` carries `pg/jsonb@1`/`jsonb`, **such that** every in-repo test/fixture that meant jsonb says `Jsonb` (or expects `json` where the re-bind is the point), TS↔PSL parity pairs `field.json()` with `Jsonb`, and `@db.Json`'s legacy behavior is byte-stable. Unexplained non-JSON drift = halt.
   - **Builds on:** D2 (`Jsonb` exists).
   - **Hands to:** slice DoD walk → PR.

## Calibration threading (slice-DoR plan-side items)

- **Failure modes:** F1 (no dual resolution path after D1), F3 (grep discovery), F5 (no destructive git), F13 (parity tests must fail if either side's storage changes), F14 (gates mirror CI: typecheck incl. test tsconfigs, per-package lint, upgrade-coverage), F17 (briefs carry property statements — done above).
- **Grep gates:** grep-library § Test-literal hygiene; slice gate: no test asserts `Json` ⇒ jsonb after D3 (`rg -l "jsonb" packages/2-sql/2-authoring/contract-psl/test` reviewed against intent).
- **Validation gates:** per dispatch `pnpm typecheck`, `pnpm --filter <pkg> lint` + test; end-of-slice `pnpm test:packages`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm check:upgrade-coverage` (this slice changes consumer-facing meaning of `Json` → an upgrade-instructions entry is REQUIRED when substrate diffs appear; author it in the D3 dispatch, per `.agents/skills/record-upgrade-instructions/SKILL.md`).

## Model-tier routing

D1: orchestrator-tier (resolution semantics + the gated evaluation). D2: mid (mechanical contributions against a declarative kit + parity tests). D3: mid (re-bind + test/fixture sweep).
