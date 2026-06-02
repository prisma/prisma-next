# Slice: verifier-dispatch

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the verifier reads each node's effective control and applies the matching comparison strategy, with the compatible-shape relation supplied by the target._

## At a glance

The schema verifier currently treats every declared object as `managed` — it must exist and match exactly, any drift is a `fail`. This slice makes the verifier dispatch on effective control: `managed` keeps today's exact-match behaviour, `tolerated` allows extra columns, `external` compares declared columns in a target-supplied compatible shape and ignores extras/extra-constraints, `observed` downgrades every divergence to a `warn`.

## Settled design decisions

These were decided with the operator before planning (recorded here so the implementer doesn't re-litigate):

- **Severity is strict by default (decision A).** Non-`managed` policies do **not** soften the *declared* subset: a declared object/column that is missing or shape-incompatible is a `fail` under `managed`, `tolerated`, **and** `external`. Only `observed` downgrades everything to `warn`. Rationale: tightening later (warn→fail) is a breaking change for users; loosening later (fail→warn) is non-breaking, and a too-strict `fail` surfaces loudly in dev rather than silently in production. This also matches the project spec's "`external` declared columns **must match**" wording.
- **Compatible-shape relation is conservative (decision B).** Postgres's relation is identical-type-or-explicitly-listed-compatible. No broad semantic equivalences (`int4↔int8`, `varchar↔text`) in v0.1; widening is additive and deferred to a concrete demand.
- **`external` requires existence (decision D).** A wholly-absent `external` object is a `fail` (you declared a dependency that isn't there). `observed` is the policy for "may or may not exist."
- **All four policies ship in v0.1 (decision D)**, including `observed`.

## Severity & suppression mapping

The dispatch maps **existing** `SchemaIssue` kinds (`missing_table`, `missing_column`, `type_mismatch`, `extra_column`, …) to a `pass`/`warn`/`fail` node status or suppresses them — no new issue *kind* is introduced.

| Live-vs-declared situation | `managed` | `tolerated` | `external` | `observed` |
|---|---|---|---|---|
| Declared object/column **missing** | fail | fail | fail | warn |
| Declared column **type-incompatible** | fail (exact) | fail (exact) | fail (compatible-shape) | warn |
| **Extra** (undeclared) column | fail | **suppress** | **suppress** | warn |
| **Extra** constraint / index | fail | fail | **suppress** | warn |
| Object **absent entirely** | fail | fail | fail | warn |

(`tolerated` differs from `managed` only by suppressing extra *columns*; `external` additionally suppresses extra *constraints* and compares declared types via the compatible-shape relation rather than exact equality. `observed` never fails.)

## Chosen design

- **Family base owns the dispatch.** The four-way branch lives once on the SQL family verifier base (`packages/2-sql/9-family/src/core/ir/sql-schema-verifier-base.ts`, threaded through `core/schema-verify/verify-sql-schema.ts` + `verify-helpers.ts`). Each declared node's policy comes from the shared resolver `effectiveControl(node.control, contract.defaultControl)` — the verifier never re-derives it.
- **The branch is a status/suppression mapping**, per the table above: each candidate `SchemaIssue` is, given the node's policy, either emitted at `fail`, emitted at `warn`, or suppressed. The existing `managed` path is the `managed` column and stays byte-for-byte.
- **Target supplies the compatible-shape relation.** The family base exposes an abstract hook — `columnsCompatible(declared, live): boolean` (exact name at the implementer's discretion) — that targets implement. Postgres (`packages/3-targets/3-targets/postgres/src/core/postgres-schema-verifier.ts`) supplies the conservative relation (identical or explicitly-listed pair).
- **Mongo family mirrors.** `packages/2-mongo-family/9-family/src/core/ir/mongo-schema-verifier-base.ts` gets the same four-way mapping over collections, with Mongo's looser shape semantics (no fixed column set; `tolerated`/`external`/`observed` relax existence/index checks per the same severity logic).

> **Naming caution.** The repo already has a *control-plane* runtime surface (`control-adapter.ts`, `control-instance.ts`, `exports/control.ts`) — the machinery that *runs* verify/migrate. That is **not** the `control` policy field. Do not wire policy logic into the control-plane adapter; the policy lives on the IR node and is read via `effectiveControl`.

## Coherence rationale

One idea — "the verifier branches on effective control" — applied once at the family level and mirrored to Mongo, with the only target-specific seam (compatible shape) isolated behind a hook. A reviewer holds the four-row severity table across the whole diff. No new issue kinds, no new result types: the only new surface is the policy branch + the compatible-shape hook.

## Scope

**In:** the four-way status/suppression mapping on the SQL family verifier base; the target-supplied compatible-shape hook + Postgres's conservative concrete relation; the mirrored mapping on the Mongo family verifier base; unit tests per policy for both families.

**Out:** planner DDL gating + the external-namespace safety guard (slice 3); TS/PSL authoring (slices 4–5); widening the compatible-shape relation; new `SchemaIssue` kinds or result-shape changes (the existing kinds + `pass`/`warn`/`fail` status suffice).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `external` object whose live type is *close* but not identical (`varchar(255)` vs `text`) | `fail` | The conservative relation treats a non-identical, non-listed pair as incompatible ⇒ `fail` (decision A: strict; loosen later if noisy). |
| `tolerated` object missing entirely | `fail` | Create-if-missing is a *planner* behaviour (slice 3); the verifier still reports a declared-but-absent `tolerated` object as a `fail`. |
| `observed` object present but wildly different | `warn` only | No `fail` path for `observed`, by definition. |
| `managed` baseline regression | none | The `managed` column of the table is today's behaviour; existing verifier suites must stay green unchanged. |

## Slice-specific done conditions

- [ ] Each policy has a unit test pinning its row of the severity table on the SQL family (Postgres-backed): `managed` fails on any drift; `tolerated` suppresses extra columns but fails on missing/mismatched declared columns; `external` suppresses extra columns + constraints, compares declared types via the compatible relation, and fails on declared divergence; `observed` downgrades everything to `warn`.
- [ ] The compatible-shape relation is target-supplied (Postgres concrete) and conservative (a non-identical, non-listed pair ⇒ incompatible ⇒ `fail`).
- [ ] The Mongo family verifier base applies the same four-way mapping, with a test per policy.
- [ ] Existing verifier suites stay green (the `managed` path is unchanged).

## References

- Parent project: [`projects/control-policy/spec.md`](../../spec.md)
- Linear issue: TML-2776
- [three-layer polymorphic IR pattern](../../../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md)
