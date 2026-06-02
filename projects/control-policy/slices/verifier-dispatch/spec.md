# Slice: verifier-dispatch

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the verifier reads each node's effective control and applies the matching comparison strategy, with the compatible-shape relation supplied by the target._

## At a glance

The schema verifier currently treats every declared object as `managed` — it must exist and match exactly, any drift is an error. This slice makes the verifier dispatch on effective control: `managed` keeps today's exact-match behaviour, `tolerated` allows extra columns, `external` compares declared columns in a target-supplied compatible shape and ignores extras, `observed` downgrades all mismatches to warnings. Tolerated/external divergence surfaces as its own issue kind rather than an error.

## Chosen design

- **Family base owns the dispatch.** The four-way branch lives once on the SQL family verifier base (`packages/2-sql/9-family/src/core/ir/sql-schema-verifier-base.ts`, threaded through `core/schema-verify/verify-sql-schema.ts` + `verify-helpers.ts`). Each declared node's policy comes from the shared resolver `effectiveControl(node.control, contract.defaultControl)` — the verifier never re-derives it.
- **Per-policy comparison strategy:**
  - `managed` — unchanged from today: declared object must exist; every declared column must match; missing/extra/mismatched ⇒ error.
  - `tolerated` — declared columns must exist and match; **extra** (undeclared) columns on the live object are allowed (no issue); missing/mismatched declared columns ⇒ error.
  - `external` — declared columns must exist and match in **compatible shape** (target-supplied relation, below); extra columns **and** extra constraints are ignored; the object must exist.
  - `observed` — the object may exist or not, may mismatch; every divergence is a **warning**, never an error.
- **Target supplies the compatible-shape relation.** The family base exposes an abstract hook — `columnsCompatible(declared, live): boolean` (exact name at the implementer's discretion) — that targets implement. Postgres (`packages/3-targets/3-targets/postgres/src/core/postgres-schema-verifier.ts`) supplies a **conservative** relation: identical type, or an explicitly-listed compatible pair. It starts strict (no `int4 ↔ int8`) per the spec's open question on compatible-shape precision.
- **Issue taxonomy.** Tolerated/external divergence that is *allowed* (extra columns, ignored constraints) produces no issue. Where a distinct signal is useful (e.g. an `observed` mismatch, or an `external` shape that is close-but-incompatible), it surfaces as its own non-error issue kind in the verification issue taxonomy, distinct from a `managed` drift error.
- **Mongo family mirrors.** `packages/2-mongo-family/9-family/src/core/ir/mongo-schema-verifier-base.ts` gets the same four-way dispatch over collections, with Mongo's looser shape semantics (a collection has no fixed column set; `tolerated`/`external`/`observed` largely relax existence/index checks).

> **Naming caution.** The repo already has a *control-plane* runtime surface (`control-adapter.ts`, `control-instance.ts`, `exports/control.ts`) — the machinery that *runs* verify/migrate. That is **not** the `control` policy field. Do not wire policy logic into the control-plane adapter; the policy lives on the IR node and is read via `effectiveControl`.

## Coherence rationale

One idea — "the verifier branches on effective control" — applied once at the family level and mirrored to Mongo, with the only target-specific seam (compatible shape) isolated behind a hook. A reviewer holds the four-row strategy table across the whole diff. The compatible-shape hook and the issue-kind addition are the only new surface; everything else is a branch on a value that already exists in the IR after slice 1.

## Scope

**In:** the four-way comparison dispatch on the SQL family verifier base; the target-supplied compatible-shape hook + Postgres's conservative concrete relation; the non-error issue kind(s) for tolerated/observed/external divergence; the mirrored dispatch on the Mongo family verifier base; unit tests per policy for both families.

**Out:** planner DDL gating + the external-namespace safety guard (slice 3); TS/PSL authoring (slices 4–5); widening the compatible-shape relation beyond the conservative start (tracked as the spec's open question); SQLite verifier behaviour beyond what the SQL family base already gives it (round-trip was proved in slice 1).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `external` object whose live type is *close* but not identical (e.g. `varchar(255)` vs `text`) | Conservative: incompatible ⇒ surfaces as the non-error external-divergence issue, not silent acceptance | The compatible-shape relation starts strict; widening is the spec open question. |
| `tolerated` object missing entirely | Error | "Create if missing" is a *planner* behaviour; the verifier still reports a declared-but-absent `tolerated` object as a drift error (it cannot satisfy "declared columns match" if nothing exists). Confirm against existing `managed` "missing object" handling. |
| `observed` object present but wildly different | Warning only | No error path for `observed`, by definition. |

## Slice-specific done conditions

- [ ] Each of the four policies has a unit test pinning its comparison strategy on the SQL family (Postgres-backed): `managed` errors on drift, `tolerated` accepts extra columns, `external` accepts extras + ignored constraints and compares declared columns by the compatible relation, `observed` downgrades to warnings.
- [ ] The compatible-shape relation is target-supplied (Postgres concrete) and conservative (a non-identical pair that is not explicitly listed is treated as incompatible).
- [ ] The Mongo family verifier base applies the same four-way dispatch, with a test per policy.
- [ ] Tolerated/observed/external divergence surfaces as a non-error issue kind, distinct from a `managed` drift error.

## Open Questions

1. **Compatible-shape precision (inherited from the project spec).** Working position: Postgres relation starts as identical-or-explicitly-listed-compatible; widening (`int4 ↔ int8` etc.) is deferred to a follow-up gated on a concrete demand.
2. **Does `external` require the object to exist?** Working position: yes — `external` means "the framework knows about and verifies the shape of an object someone else owns"; a wholly-absent `external` object is a misconfiguration worth a non-error issue. `observed` is the policy for "may or may not exist."

## References

- Parent project: [`projects/control-policy/spec.md`](../../spec.md)
- Linear issue: TML-2776
- [three-layer polymorphic IR pattern](../../../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md)
