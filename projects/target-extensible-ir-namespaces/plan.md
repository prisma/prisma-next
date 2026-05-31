# Project Plan: target-extensible-ir-namespaces

**Spec:** [`projects/target-extensible-ir-namespaces/spec.md`](./spec.md)
**Linear Project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/project/target-extensible-ir-namespaces-fd69eff8aec6)
**Purpose** _(from spec)_: Make first-class namespaces and target-extensible IR usable for the downstream Supabase integration. The contract IR reaches its canonical symmetric two-plane shape; runtime SQL and the DSL/ORM surfaces qualify identifiers and dispatch through a default-namespace fallback so existing single-namespace consumers experience zero breakage; the explicit namespace-aware surface (`db.sql.auth.user`) lands later as purely additive work.

## At a glance

Single sequential stack. S1 closed and proved the IR substrate ([ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)). **Storage on `main` already matches the amended ADR** (`{ storageHash, types?, namespaces }`). The **domain** plane was never wired — `models` / `valueObjects` remain flat at the contract root. A closed PR (#649) attempted to flatten storage; that direction was wrong (heterogeneous-map cost). ADR 221 is amended to prescribe symmetric `{ …metadata?, namespaces }` envelopes per plane.

```text
S2 — wire symmetric domain plane   →   S3 — Postgres public-by-default   →   S4 — runtime qualification   →   S5 — explicit-namespace DSL (deferrable)
```

One worktree + branch per slice; slice tickets at pickup.

## Composition

### Stack (deliver in order)

#### S1 — contract IR planes + pack-contributed entity-kind mechanism + Postgres enum migration

**Unit type:** Sub-project (multi-slice; **closed** — [ADR 221](../../docs/architecture%20docs/adrs/ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)).

**Outcome.** Two-plane model, entity coordinate, pack-contributed entity kinds (Postgres enum exemplar), storage plane with `namespaces` wrapper. Domain plane not yet wired.

**Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584) (Done).

#### S2 — wire the symmetric domain plane

**Unit type:** Slice (one PR; likely two dispatches).

**Purpose.** Move flat `contract.models` / `contract.valueObjects` under `contract.domain.namespaces.<ns>.{ models, valueObjects }`, matching storage's envelope. Amend consumers (emitter, validators, migration walks, fixtures). **Do not change storage** — it is already correct on `main`. Framework domain has no `types` member; doc-scoped codec aliases stay on SQL `storage.types`.

**Linear:** ticket at pickup (replaces cancelled [TML-2747](https://linear.app/prisma-company/issue/TML-2747) flatten attempt).

**Depends on.** S1 (closed).

**Validation gate.**

- `pnpm typecheck` · `pnpm test:packages` · `pnpm test:integration` · `pnpm test:e2e` · `pnpm lint:deps`
- `pnpm fixtures:check` clean after regeneration.
- **Project-specific check:** emitted IR has `domain.namespaces.<ns>.models` (and valueObjects where present); no flat `contract.models` at root in new emissions; grep gate confirms storage still uses `storage.namespaces`.

**Priority.** Must-ship core.

#### S3 — Postgres public-by-default at the PSL interpreter

**Unit type:** Slice (single PR).

**Purpose.** Un-namespaced Postgres models default to `public`; `__unbound__` is explicit PSL opt-in. Removes hardcoded `"public".` prefix logic; regenerates Postgres contract artifacts.

**Depends on.** S2.

**Validation gate.** Standard package gates + `pnpm fixtures:check`; un-namespaced Postgres model emits under `public`; `__unbound__` opt-in round-trips.

**Linear:** ticket at pickup.

#### S4 — runtime SQL qualification + default-namespace DSL/ORM fallback

**Unit type:** Slice (single PR).

**Purpose.** Runtime SQL qualifies identifiers; DSL/ORM flat surface resolves through per-family default namespace (`public` / `__unbound__`).

**Linear:** [TML-2605](https://linear.app/prisma-company/issue/TML-2605).

**Depends on.** S2 + S3.

#### S5 — explicit namespace-aware DSL/ORM surface

**Unit type:** Slice. **Deferrable.**

**Purpose.** `db.sql.<ns>.<table>`, `db.<ns>.<Model>` — additive on S4.

**Linear:** [TML-2550](https://linear.app/prisma-company/issue/TML-2550).

### Parallel groups

None.

## Dependencies (external)

- [x] **S1 closed.** ADR 221 + storage `namespaces` wrapper on `main`.
- [x] **ADR 221 amended** — symmetric plane envelopes; framework domain has no `types`.
- [ ] **Supabase initiative awareness** — coordinated at initiative level.

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** All units delivered or deferred | S2 + S3 + S4; S5 optional |
| **PDoD2.** Emitted IR matches ADR 221 (symmetric `domain` + `storage` envelopes) | S2 |
| **PDoD3.** Postgres public-by-default; `__unbound__` opt-in | S3 |
| **PDoD4.** Runtime SQL qualification | S3 + S4 |
| **PDoD5.** Zero query-API breakage for default-namespace consumers | S3 + S4 |
| **PDoD6.** Multi-namespace E2E authorable + queryable | S2 + S4 |
| **PDoD7.** Pack-contributed entity kinds (enum exemplar) | S1 |
| **PDoD8–PDoD10.** ADRs, Linear complete, folder cleanup | Close-out |

## Risks + open questions

1. **Fixture churn (S2 + S3).** Mitigation: `pnpm fixtures:emit` / `pnpm fixtures:check` in slice DoD.
2. **Domain-plane blast radius.** Every consumer of `contract.models` must migrate to `contract.domain.namespaces` walks; refusal trigger if scope expands into storage reshape.
3. **S3 default-namespace policy.** Regenerates all Postgres contracts; upgrade instructions if downstream *source* changes.

## Sequencing visualisation

```text
S1 — contract-ir-planes   ✓ CLOSED  (ADR 221; storage.namespaces on main)
   │
   ▼
S2 — symmetric domain plane ([TML-2751](https://linear.app/prisma-company/issue/TML-2751))
   │
   ▼
S3 — Postgres public-by-default
   │
   ▼
S4 — runtime qualification (TML-2605)
   │
   ▼
S5 — explicit-namespace DSL (deferrable, TML-2550)
```

## Close-out (required)

- [ ] Verify all PDoDs in [`spec.md`](./spec.md)
- [ ] Mandatory final retro; lessons in canonical surfaces
- [ ] Archive predecessor project folders; delete `projects/target-extensible-ir-namespaces/`
- [ ] Linear project Completed
