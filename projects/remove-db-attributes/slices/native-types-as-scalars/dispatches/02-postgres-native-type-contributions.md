# D2 — Postgres native types as bare scalar types + parity proof

**Slice plan:** `projects/remove-db-attributes/slices/native-types-as-scalars/plan.md` · **Tier:** mid · **Branch:** `tml-2986-native-types-as-scalars`

## Task

Contribute the eleven former `@db.*` native types as top-level type-constructor descriptors in the postgres target's authoring contributions (beside `postgresScalarAuthoringTypes`, postgres adapter `control-mutation-defaults.ts` — the channel slice 1 built; D1 made all-optional-args constructors bare-eligible). Prove parity against the live `@db.*` path.

Spec table (`../spec.md` § Chosen design) is authoritative for names/args/outputs. `NATIVE_TYPE_SPECS` in `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts` is the **parity oracle — read it, do not modify it**. JSON (`Json` re-bind, `Jsonb`) is **out** — D3.

## Outcome (property statement)

Each native type is authorable as a bare scalar type in both named-type and field position, with and without its optional args, **such that** the emitted `{ codecId, nativeType, typeParams }` is identical to the `@db.*` equivalent's (omitted optional args omit the typeParams keys, exactly as `@db.VarChar` bare did) — the parity tests compare against contracts emitted through the live `@db.*` path in the same test run (F13: a test that would still pass if either side's storage changed is a defect), and adapter ownership is preserved (the eleven types are postgres contributions; no family-layer table grows).

## In

- Postgres adapter contributions: `VarChar(length?≥1)` → `sql/varchar@1`/`character varying`; `Char(length?≥1)` → `sql/char@1`/`character`; `Numeric(precision?≥0, scale?)` → `pg/numeric@1`/`numeric` (typeParams `{precision, scale}` only when given — match `@db.Numeric`'s exact key shapes incl. the one-arg form); `Timestamp(p?≥0)` → `pg/timestamp@1`; `Timestamptz(p?≥0)` → `pg/timestamptz@1`; `Time(p?≥0)` → `pg/time@1`; `Timetz(p?≥0)` → `pg/timetz@1`; `Uuid` → `pg/uuid@1`/`uuid`; `SmallInt` → `pg/int2@1`/`int2`; `Real` → `pg/float4@1`/`float4`; `Date` → explicit `{ codecId: 'pg/timestamptz@1', nativeType: 'date' }`.
- Verify each nativeType/typeParams template against the oracle AND the declarative arg machinery's behavior for omitted optionals (grep `mapPslHelperArgs` / `instantiatePslTypeConstructor` handling first).
- Parity tests (contract-psl or extension test package — follow where slice-1 parity tests live): for all eleven, both positions, arg-present and arg-omitted forms; deep-equal against the `@db.*`-emitted contract from the same run.

## Out

- `Json`/`Jsonb` (D3). Consumer migration, printing, `@db.*` removal (later slices). Modifying `NATIVE_TYPE_SPECS` or any legacy path.

## Edge cases

| Case | Disposition |
| --- | --- |
| `Numeric(10)` (precision only) | Must match `@db.Numeric(10)`'s typeParams exactly. |
| Arg validation quality | Out-of-range (`VarChar(0)`) rejects with the declarative machinery's diagnostic; assert it exists, don't hand-roll new validation. |
| Name availability | `Timestamp` etc. must not collide with existing contributions — assembly attribution errors if so; investigate before renaming anything (halt if a real collision exists). |
| Destructive git ops | Forbidden; `git commit -s`. |
| Fixture drift | None expected (additive contributions); drift = halt. |

## Completed when

1. Parity tests green for 11 types × both positions × arg forms; diagnostics tests for invalid args.
2. `pnpm typecheck`, per-touched-package lint + tests, `pnpm fixtures:check` zero drift, `pnpm lint:deps` clean.

## Report back

Contribution site; parity-test names + where they live; any oracle discrepancies found; gates + results; F1/F3/F13/F14 checked; commit SHA.
