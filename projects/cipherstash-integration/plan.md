# CipherStash integration — Umbrella plan

> The high-level plan for the [cipherstash-integration umbrella](spec.md). This document sequences the **three components** of the umbrella; per-component plans (`project-1/plan.md`, `project-2/plan.md`, `sql-raw-factory/plan.md`) sequence the work *within* each component. None of those exist yet — see "Status" below.

# Components and their relationships

```
                                  In-flight framework PRs
                                  ──────────────────────
              ┌──────────────────── #400 (merged) ──────────────┐
              │                     #402 (merged)               │
              │                     #404 (open)                 │
              │                     #409 (open)                 │
              ▼                                                 ▼
        ┌──────────┐                                       ┌────────┐
        │Project 1 │                                       │Project │
        │  (MVP)   │                                       │   2    │
        └─────┬────┘                                       └────────┘
              │                                                 ▲
              │ ships RawSqlExpr AST node                       │
              │                                                 │ inherits patterns,
              │                                                 │ surfaces, factories
              ▼                                                 │ from Project 1
        ┌──────────────┐                                        │
        │sql-raw-      │                                        │
        │  factory     │ ◄── consumes AST node ─────────────────┘
        └──────────────┘
```

The dependency edges:

| Edge | Direction | Hard / Soft |
|---|---|---|
| Project 1 → Project 2 | Project 2 *expands* Project 1's surface (more types, more operators, planner-driven DDL) | **Hard** — Project 2 lifts Project 1's codec/factory/operator patterns into the planner |
| Project 1 → `sql-raw-factory` | Project 1 ships the `RawSqlExpr` AST node `sql-raw-factory` consumes | **Soft on ordering, hard on substance** — `sql-raw-factory` could ship before Project 1 if it owns the AST node, but the agreed cleavage has Project 1 ship it |
| Framework PRs (#400, #402) → Project 1 | Project 1's codec consumes the merged context + descriptor APIs | **Hard, satisfied** — both merged 2026-05-01 |
| Framework PRs (#404, #409) → Project 1 | Same SPI surfaces edited; no consumption | **Coordinate-only** — Project 1 ships independently of both. See [Project 1 plan](project-1/plan.md#external-prs--non-dependency) for the rebase posture |
| Framework prerequisites → Project 2 | Planner needs `(table, column)` input to `planTypeOperations` and prior-state contract for destructive DDL — both unstarted, no longer separately Linear-tracked | **Hard, not started** |

# Sequencing

## Component order

The natural order is **Project 1 first, `sql-raw-factory` and Project 2 in parallel afterwards** — modulo Project 2 being further blocked on its own framework prerequisites (per-column `planTypeOperations` input + prior-state contract).

```
phase A:    Project 1 [shape] ──► [execute] ──► [ship]
                                       │
                                       └─► AST node merged on main
                                                  │
phase B:                          ┌───────────────┴───────────────┐
                                  ▼                               ▼
                          sql-raw-factory                  Project 2
                          [shape ──► ship]                 (blocked on
                          (parallelizable                  framework prereqs;
                          with Project 1's                 shape once
                          execution once                   unblocked)
                          AST node lands)
```

A few things to note about this picture:

- **`sql-raw-factory` shaping can start anytime** — its design is largely independent of Project 1's execution detail. It can be shaped (spec already exists) and even partially executed in parallel with Project 1, with a hard merge-block on the AST node landing.
- **Project 2 shaping should not start yet.** It depends on framework decisions (per-column `planTypeOperations` input shape; prior-state contract for destructive DDL) that haven't been designed; shaping Project 2 against guesses risks rework. The current Project 2 spec is a deliberate stub.
- **Project 1 is the critical path.** Both other components depend on it directly or indirectly. Project 1's own dependencies (#404 and #409) are the only things gating start of Project 1 *execution*.

## Phase A — Project 1 (Searchable-encryption MVP)

**Goal.** Ship `@prisma-next/extension-cipherstash` with `EncryptedString`, `eq` + `ilike`, hand-authored migration factories, end-to-end integration tested.

**Status.** Spec drafted (5 task specs); [plan drafted](project-1/plan.md) with five value-slice milestones (M1 framework SPI → M2 store-only round-trip → M3 `eq` operator + manual migration → M4 `ilike` + activatePending + decryptAll → M5 close-out).

**External gating.** None. Project 1 is independent of [PR #404](https://github.com/prisma/prisma-next/pull/404) (invariant-aware ref routing) and [PR #409](https://github.com/prisma/prisma-next/pull/409) (middleware `intercept` hook). #404's `invariantId` field is populated on emitted ops regardless of #404's status; the routing benefit becomes effective when #404 lands, retroactively. #409 edits the same `RuntimeMiddleware` types Project 1's middleware-param-transform task edits but adds non-overlapping fields; whichever lands first, the other rebases mechanically. See [Project 1 plan — External PRs](project-1/plan.md#external-prs--non-dependency).

**Internal sequencing.** Drafted in [project-1/plan.md](project-1/plan.md). Summary:

1. **M1 — Framework SPI.** `middleware-param-transform` and `raw-sql-ast-node` in parallel (no file overlap).
2. **M2 — Store-only round-trip.** `psl-encrypted-string-constructor` + `envelope-codec-extension` storage path. Encrypted column type works for storage; no operators yet.
3. **M3 — `eq` operator + manual `addSearchConfig` migration.** First searchable round-trip end-to-end against live EQL.
4. **M4 — `ilike` + `activatePendingSearches` + `decryptAll`.** Completes Project 1's user-facing surface. All UMB ACs green.
5. **M5 — Close-out.** Project lifecycle close-out per `projects/README.md`.

**Done when.** Project 1's acceptance criteria (UMB1–UMB7) all green; long-lived docs migrated to `docs/`; Project 1 directory deletable per the project lifecycle.

## Phase B (parallelizable) — `sql-raw-factory`

**Goal.** Public user-facing `raw\`...\`` template-literal factory, layered on top of Project 1's `RawSqlExpr` AST node.

**Status.** Spec drafted; [plan drafted](sql-raw-factory/plan.md) — three milestones (M1 factory + `param()` → M2 `identifier(...)` escape hatch → M3 integration + close-out).

**Gating.** Hard merge-block on Project 1's M1 (`raw-sql-ast-node`) landing on `main`. Shaping and local prototyping can happen in parallel with Project 1's execution; merge waits for the AST node. M3's `AC-COMP3` test (cipherstash bulk-encrypt composition) additionally depends on Project 1's M2 having landed.

**Independence from Project 1's MVP.** `sql-raw-factory` does not block any Project 1 task. Cipherstash's migration factories construct `RawSqlExpr` instances directly via the package-internal API; the public `raw\`...\`` factory is purely additive value for end users wanting to write raw SQL queries.

**Done when.** `sql-raw-factory` acceptance criteria green (see [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md)). Long-lived docs migrated to `docs/`.

## Phase B (parallelizable) — Project 2

**Goal.** Planner-driven per-column DDL via `planTypeOperations`; expanded type/operator surface (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`; `orderAndRange`, `searchableJson`).

**Status.** Stub spec only. Not yet shaped.

**Gating.**

- Hard dep on Project 1 shipping (codec + factory shape + invariant-routing pattern).
- Hard dep on framework prerequisites: `planTypeOperations` accepting `(table, column)` and a prior-state contract for destructive DDL. Neither has started; shaping either requires framework-design work that hasn't begun. (These were previously tracked as TML-2338 / TML-2339 — both cancelled in the Linear redesign; the *work* is real and described in [`project-2/spec.md`](project-2/spec.md), it is simply no longer separately tracked at the ticket level.)

**Recommended cadence.** Wait until Project 1 ships before shaping Project 2 in detail. The shape of Project 2's planner integration is sensitive to those framework decisions; shaping against guesses produces rework. Stub remains a placeholder and a forward-reference target until then.

# Status

| Component | Linear | Spec | Plan | Execution | Notes |
|---|---|---|---|---|---|
| Umbrella | — | [drafted](spec.md) | [drafted](plan.md) (this doc) | — | — |
| Project 1 | [TML-2373](https://linear.app/prisma-company/issue/TML-2373) | [drafted](project-1/spec.md) (5 task specs all drafted) | [drafted](project-1/plan.md) | not started | Independent of #404 + #409; #400 + #402 already merged |
| `sql-raw-factory` | [TML-2374](https://linear.app/prisma-company/issue/TML-2374) | [drafted](sql-raw-factory/spec.md) | [drafted](sql-raw-factory/plan.md) | not started | Mergeable after Project 1's M1 lands (`raw-sql-ast-node`); three milestones (factory + param() → identifier(...) → integration + close-out) |
| Project 2 | [TML-2375](https://linear.app/prisma-company/issue/TML-2375) | [stub](project-2/spec.md) | not started | not started | Gated on Project 1 + framework prerequisites (`planTypeOperations` input + prior-state contract) |

# Open questions at the umbrella level

1. **Project 2 shaping trigger.** Confirm: shape Project 2 only after Project 1 ships? Or earlier (in parallel with Project 1's execution) at the cost of likely rework when the framework prerequisites land?

# References

- [Umbrella spec](spec.md)
- [Project 1 spec](project-1/spec.md)
- [Project 2 spec (stub)](project-2/spec.md)
- [`sql-raw-factory` spec](sql-raw-factory/spec.md)
- Repo project workflow: [`projects/README.md`](../README.md)
