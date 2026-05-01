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
| Framework PRs (#404, #409) → Project 1 | Migration factories need #404's invariant routing; middleware seam co-edits with #409 | **Hard, in flight** — #404 + #409 still open |
| Framework tickets (TML-2338, TML-2339) → Project 2 | Planner needs the per-column hooks | **Hard, not started** |

# Sequencing

## Component order

The natural order is **Project 1 first, `sql-raw-factory` and Project 2 in parallel afterwards** — modulo Project 2 being further blocked on its own framework dependencies (TML-2338 / TML-2339).

```
phase A:    Project 1 [shape] ──► [execute] ──► [ship]
                                       │
                                       └─► AST node merged on main
                                                  │
phase B:                          ┌───────────────┴───────────────┐
                                  ▼                               ▼
                          sql-raw-factory                  Project 2
                          [shape ──► ship]                 (blocked on
                          (parallelizable                  TML-2338 + 2339;
                          with Project 1's                 shape once
                          execution once                   unblocked)
                          AST node lands)
```

A few things to note about this picture:

- **`sql-raw-factory` shaping can start anytime** — its design is largely independent of Project 1's execution detail. It can be shaped (spec already exists) and even partially executed in parallel with Project 1, with a hard merge-block on the AST node landing.
- **Project 2 shaping should not start yet.** It depends on framework decisions (TML-2338's input shape; TML-2339's prior-state contract) that haven't been designed; shaping Project 2 against guesses risks rework. The current Project 2 spec is a deliberate stub.
- **Project 1 is the critical path.** Both other components depend on it directly or indirectly. Project 1's own dependencies (#404 and #409) are the only things gating start of Project 1 *execution*.

## Phase A — Project 1 (Searchable-encryption MVP)

**Goal.** Ship `@prisma-next/extension-cipherstash` with `EncryptedString`, `eq` + `ilike`, hand-authored migration factories, end-to-end integration tested.

**Status.** Spec drafted (5 task specs). Project-level plan not yet written.

**External gating dependencies.**

- [PR #404](https://github.com/prisma/prisma-next/pull/404) (invariant-aware ref routing) — open. Required for [migration-factories task spec](project-1/specs/migration-factories.spec.md). Project 1 can shape its plan and start any of the four other task specs (envelope-codec, middleware-param-transform, psl-encrypted-string-constructor, raw-sql-ast-node) before #404 lands; only the migration-factories task is gated on it.
- [PR #409](https://github.com/prisma/prisma-next/pull/409) (`intercept` hook + `contentHash` on middleware) — open. Co-edits the `RuntimeMiddleware` SPI alongside the [middleware-param-transform task spec](project-1/specs/middleware-param-transform.spec.md). Whichever lands first, the other rebases. Soft order constraint, not a hard block.

**Internal sequencing inside Project 1** is the subject of `project-1/plan.md` (not written). Five task specs:

| Task spec | Other-spec dependencies inside Project 1 |
|---|---|
| [middleware-param-transform](project-1/specs/middleware-param-transform.spec.md) | None — pure framework SPI work |
| [raw-sql-ast-node](project-1/specs/raw-sql-ast-node.spec.md) | None — pure framework AST work |
| [envelope-codec-extension](project-1/specs/envelope-codec-extension.spec.md) | Consumes `middleware-param-transform` |
| [psl-encrypted-string-constructor](project-1/specs/psl-encrypted-string-constructor.spec.md) | Independent of the runtime/migration tasks; only depends on the contract IR shape that the codec emits, which is established before runtime work begins |
| [migration-factories](project-1/specs/migration-factories.spec.md) | Consumes `raw-sql-ast-node`; gated on PR #404 externally |

The two SPI-facing tasks (`middleware-param-transform` and `raw-sql-ast-node`) are maximally parallelizable and unblock the rest. A reasonable internal ordering — to be confirmed when Project 1's plan is written:

1. `middleware-param-transform` and `raw-sql-ast-node` in parallel (different parts of the framework; no overlap).
2. `psl-encrypted-string-constructor` in parallel — independent.
3. `envelope-codec-extension` consuming `middleware-param-transform`.
4. `migration-factories` once `raw-sql-ast-node` lands and PR #404 lands.
5. Umbrella-level integration test (UMB1–UMB7 in [project-1/spec.md](project-1/spec.md)).

**Done when.** Project 1's acceptance criteria (UMB1–UMB7) all green; long-lived docs migrated to `docs/`; Project 1 directory deletable per the project lifecycle.

## Phase B (parallelizable) — `sql-raw-factory`

**Goal.** Public user-facing `raw\`...\`` template-literal factory, layered on top of Project 1's `RawSqlExpr` AST node.

**Status.** Spec drafted. Project-level plan not yet written.

**Gating.** Hard merge-block on Project 1's `raw-sql-ast-node` task landing on `main`. Shaping (spec, plan) and even local prototyping can happen in parallel with Project 1's execution; merge waits for the AST node.

**Independence from Project 1's MVP.** `sql-raw-factory` does not block any Project 1 task. Cipherstash's migration factories construct `RawSqlExpr` instances directly via the package-internal API; the public `raw\`...\`` factory is purely additive value for end users wanting to write raw SQL queries.

**Done when.** `sql-raw-factory` acceptance criteria green (see [`sql-raw-factory/spec.md`](sql-raw-factory/spec.md)). Long-lived docs (whatever is appropriate) migrated to `docs/`.

## Phase B (parallelizable) — Project 2

**Goal.** Planner-driven per-column DDL via `planTypeOperations`; expanded type/operator surface (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`; `orderAndRange`, `searchableJson`).

**Status.** Stub spec only. Not yet shaped.

**Gating.**

- Hard dep on Project 1 shipping (codec + factory shape + invariant-routing pattern).
- Hard dep on TML-2338 (`(table, column)` to `planTypeOperations`) and TML-2339 (prior-state contract for destructive DDL). Neither has started; shaping either requires framework-design work that hasn't begun.

**Recommended cadence.** Wait until Project 1 ships before shaping Project 2 in detail. The shape of Project 2's planner integration is sensitive to framework decisions in TML-2338 / TML-2339; shaping against guesses produces rework. Stub remains a placeholder and a forward-reference target until then.

# Status

| Component | Spec | Plan | Execution | Notes |
|---|---|---|---|---|
| Umbrella | [drafted](spec.md) | [drafted](plan.md) (this doc) | — | — |
| Project 1 | [drafted](project-1/spec.md) (5 task specs all drafted) | not started | not started | Gated externally on #404 + #409 (#400 + #402 already merged) |
| Project 2 | [stub](project-2/spec.md) | not started | not started | Gated on Project 1 + TML-2338 + TML-2339 |
| `sql-raw-factory` | [drafted](sql-raw-factory/spec.md) | not started | not started | Mergeable after Project 1's `raw-sql-ast-node` lands |

# Open questions at the umbrella level

1. **When does Project 1's plan get written?** The user's stated preference is that per-task plans wait until task specs are stable. Task specs are now drafted; writing `project-1/plan.md` is the natural next step (after this umbrella plan).
2. **`sql-raw-factory` plan timing.** The component spec is stable. Its plan can be written at any point — does not need to wait on Project 1.
3. **Project 2 shaping trigger.** Confirm: shape Project 2 only after Project 1 ships? Or earlier (in parallel with Project 1's execution) at the cost of likely rework when TML-2338 / TML-2339 lands?
4. **Linear ticket redesign timing.** Currently deferred until the umbrella plan stabilizes. With this plan landing, the umbrella plan *is* stable; the question becomes whether to redesign Linear tickets now (before per-component plans) or after the per-component plans are written. The latter gives Linear tickets that match the actual task breakdown; the former gets Linear ticket structure landed earlier so external stakeholders can track.

# References

- [Umbrella spec](spec.md)
- [Project 1 spec](project-1/spec.md)
- [Project 2 spec (stub)](project-2/spec.md)
- [`sql-raw-factory` spec](sql-raw-factory/spec.md)
- Repo project workflow: [`projects/README.md`](../README.md)
