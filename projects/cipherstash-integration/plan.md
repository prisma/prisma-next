# CipherStash integration — Umbrella plan

> The high-level plan for the [cipherstash-integration umbrella](spec.md). This document sequences the **three components** of the umbrella; per-component plans (`project-1/plan.md`, `project-2/plan.md`, `sql-raw-factory/plan.md`) sequence the work *within* each component. None of those exist yet — see "Status" below.

# Components and their relationships

```
                  Foundation                            Foundation
              TML-2397 (contract spaces, satisfied)   #400, #402, #404, #409 (merged)
                          │                                    │
                          ▼                                    ▼
                    ┌──────────┐                          ┌────────┐
                    │Project 1 │                          │Project │
                    │  (MVP)   │                          │   2    │
                    └─────┬────┘                          └────────┘
                          │                                   ▲
                          │ ships RawSqlExpr AST node         │ inherits patterns
                          │                                   │ (envelope, codec,
                          │                                   │  PSL/TS, operator
                          ▼                                   │  lowering) from P1
                    ┌──────────────┐                          │
                    │sql-raw-      │                          │
                    │  factory     │ ◄── consumes AST node ───┘
                    └──────────────┘
```

The dependency edges:

| Edge | Direction | Hard / Soft |
|---|---|---|
| Project 1 → Project 2 | Project 2 *expands* Project 1's surface (more types, more operators) | **Hard** — Project 2 instantiates Project 1's codec/PSL/TS/operator pattern per type. |
| Project 1 → `sql-raw-factory` | Project 1 ships the `RawSqlExpr` AST node `sql-raw-factory` consumes | **Soft on ordering, hard on substance** — `sql-raw-factory` could ship before Project 1 if it owns the AST node, but the agreed cleavage has Project 1 ship it |
| TML-2397 (contract spaces) → all components | Codec lifecycle hook, per-space verifier, EQL bundle install in cipherstash space's baseline migration | **Hard, satisfied** — all components rebase onto `tml-2397-cipherstash-contract-space` |
| Framework PRs (#400, #402, #404, #409) → Project 1 | Codec call context, unified `CodecDescriptor<P>`, invariant-aware ref routing, middleware `intercept` + `contentHash` | **Hard, satisfied** — already on the contract-spaces base |

# Sequencing

## Component order

The natural order is **Project 1 first, `sql-raw-factory` and Project 2 in parallel afterwards.**

```
phase A:    Project 1 [shape] ──► [execute] ──► [ship]
                                       │
                                       └─► AST node merged on main
                                                  │
phase B:                          ┌───────────────┴───────────────┐
                                  ▼                               ▼
                          sql-raw-factory                  Project 2
                          [shape ──► ship]                 [shape ──► ship]
                          (parallelizable                  (per-type sub-specs
                          with Project 1's                  in customer-demand
                          execution once                    order)
                          AST node lands)
```

A few things to note about this picture:

- **`sql-raw-factory` shaping can start anytime** — its design is largely independent of Project 1's execution detail. It can be shaped (spec already exists) and even partially executed in parallel with Project 1, with a hard merge-block on the AST node landing.
- **Project 2 shaping waits for Project 1 to ship.** Each new type rides on the patterns Project 1 establishes (envelope, codec, PSL constructor, TS factory, parity test, operator lowering); shaping Project 2 against patterns that may still shift during Project 1 execution risks rework. The current Project 2 spec is a deliberate stub.
- **Project 1 is the critical path.** Both other components depend on it directly or indirectly. With TML-2397 satisfied as foundation and the four framework PRs (#400, #402, #404, #409) all merged, no external work gates Project 1 execution.

## Phase A — Project 1 (Searchable-encryption MVP)

**Goal.** Ship `@prisma-next/extension-cipherstash` with `EncryptedString`, `eq` + `ilike`, end-to-end integration tested. Per-column DDL emitted automatically by the codec lifecycle hook (TML-2397).

**Status.** Rebased onto `tml-2397-cipherstash-contract-space`. M0 (rebase + cherry-pick of M1 framework SPIs from PR #416) and M1 (framework SPI) are SATISFIED; M2 (cipherstash runtime layer), M3 (operators + decryptAll + full e2e), M4 (close-out) are remaining. See [project-1/plan.md](project-1/plan.md) for the milestone-by-milestone breakdown.

**External gating.** None. TML-2397 satisfied; PRs #400 / #402 / #404 / #409 all merged onto the contract-spaces base.

**Internal sequencing.** Drafted in [project-1/plan.md](project-1/plan.md). Summary:

1. **M0 — Rebase onto contract spaces.** ✅ DONE. Branch off TML-2397; cherry-pick framework SPIs + skill update; rewrite spec/plan against contract-spaces foundation.
2. **M1 — Framework SPI.** ✅ DONE. `RawSqlExpr` AST + lowerer; `planFromAst`; `SqlParamRefMutator` + Mongo mirror; per-execute `signal`; boolean `AuthoringArgumentDescriptor` kind.
3. **M2 — Cipherstash runtime layer.** Envelope + SDK + codec encode/decode + bulk-encrypt middleware + PSL/TS authoring + parity + storage e2e + codec-hook flag-name alignment.
4. **M3 — Operators + decryptAll + full e2e.** `eq` + `ilike` operator lowering; `decryptAll` walker; all `AC-UMB1..9`; example app.
5. **M4 — Close-out.** Project lifecycle close-out per `projects/README.md`.

**Done when.** Project 1's acceptance criteria (`AC-UMB1..9`) all green; long-lived docs migrated to `docs/`; Project 1 directory deletable per the project lifecycle.

## Phase B (parallelizable) — `sql-raw-factory`

**Goal.** Public user-facing `raw\`...\`` template-literal factory, layered on top of Project 1's `RawSqlExpr` AST node.

**Status.** Spec drafted; [plan drafted](sql-raw-factory/plan.md) — three milestones (M1 factory + `param()` → M2 `identifier(...)` escape hatch → M3 integration + close-out).

**Gating.** Hard merge-block on Project 1's M1 (`raw-sql-ast-node`) landing on `main`. Shaping and local prototyping can happen in parallel with Project 1's execution; merge waits for the AST node. M3's `AC-COMP3` test (cipherstash bulk-encrypt composition) additionally depends on Project 1's M2 having landed.

**Independence from Project 1's MVP.** `sql-raw-factory` does not block any Project 1 task. Cipherstash's migration factories construct `RawSqlExpr` instances directly via the package-internal API; the public `raw\`...\`` factory is purely additive value for end users wanting to write raw SQL queries.

**Done when.** `sql-raw-factory` acceptance criteria green (see [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md)). Long-lived docs migrated to `docs/`.

## Phase B (parallelizable) — Project 2

**Goal.** Expanded type/operator surface (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`; `orderAndRange`, `searchableJson`).

**Status.** Spec drafted ([`project-2/spec.md`](project-2/spec.md)). Plan not yet drafted.

**Scope.** Five new codecs (`cipherstash/double@1`, `cipherstash/bigint@1`, `cipherstash/date@1`, `cipherstash/boolean@1`, `cipherstash/json@1`); ~13 new operators (predicates as column methods, sort + JSON SELECT-expressions as free-standing helpers); the existing `EncryptedString` constructor gains `orderAndRange`. Single PR, single validation gate against live Postgres + EQL.

**Gating.**

- Hard dep on Project 1 shipping (codec + PSL/TS authoring + operator-lowering pattern). Each new type/operator family in Project 2 instantiates the same pattern.

The original gating on framework prerequisites (`planTypeOperations` accepting `(table, column)`; prior-state contract for destructive DDL) is dissolved: TML-2397's codec lifecycle hook is the framework-wide planner-integration mechanism, and each new type wires its own `onFieldEvent` arm. No framework work blocks Project 2.

# Status

| Component | Linear | Spec | Plan | Execution | Notes |
|---|---|---|---|---|---|
| Umbrella | — | [drafted](spec.md) | [drafted](plan.md) (this doc) | — | Rebased onto `tml-2397-cipherstash-contract-space` |
| Project 1 | [TML-2373](https://linear.app/prisma-company/issue/TML-2373) | [drafted](project-1/spec.md) (4 active task specs; migration-factories obsoleted by TML-2397) | [drafted](project-1/plan.md) | M0 + M1 done; M2 next | All framework PRs merged; TML-2397 satisfied as foundation |
| `sql-raw-factory` | [TML-2374](https://linear.app/prisma-company/issue/TML-2374) | [drafted](sql-raw-factory/spec.md) | [drafted](sql-raw-factory/plan.md) | not started | Mergeable after Project 1's M1 lands (`raw-sql-ast-node` already cherry-picked onto Project 1's branch); three milestones (factory + param() → identifier(...) → integration + close-out) |
| Project 2 | [TML-2375](https://linear.app/prisma-company/issue/TML-2375) | [drafted](project-2/spec.md) | not started | not started | Five new codecs (`double`, `bigint`, `date`, `boolean`, `json`) + ~13 new operators. Single PR, single validation gate. Gated on Project 1 only; framework prerequisites dissolved by TML-2397 |

# Open questions at the umbrella level

None outstanding. Project 2 spec drafted; plan pending.

# References

- [Umbrella spec](spec.md)
- [Project 1 spec](project-1/spec.md)
- [Project 2 spec (stub)](project-2/spec.md)
- [`sql-raw-factory` spec](sql-raw-factory/spec.md)
- Repo project workflow: [`projects/README.md`](../README.md)
