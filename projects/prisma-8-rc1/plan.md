# Prisma 8 RC1 — Project Plan

## Summary

Thirteen working days (Jul 15 → Jul 31 2026), three people plus agent capacity, four checkpoint milestones. Slices are grouped by owner lane; sequencing constraints are noted where they exist — everything else runs in parallel. Tickets are created just-in-time when a slice starts, never up-front.

**Spec:** [spec.md](spec.md) · **Design notes:** [design-notes.md](design-notes.md) · **Tracking:** [Linear — Prisma 8 RC1](https://linear.app/prisma-company/project/prisma-8-rc1-7592265f700c)

## Checkpoints (Linear milestones)

| Date | Milestone | What must be true |
| --- | --- | --- |
| Fri Jul 18 | Error-code scheme ratified | Will decides dotted vs PN-numeric; sweep unblocked |
| Tue Jul 22 | Postgres floor decided | Keep 17 or lower it; supported-surface matrix unblocked |
| Thu Jul 24 | Go/no-go | Polymorphism in/out called; matrix frozen; side-by-side fixture green (or the coexistence claim is softened) |
| Thu Jul 31 | RC1 published & announced | Release-week mechanicals complete; announcement live |

## Lane: Will — merge, ops, decisions

### Slice W1: v8 branch + CI in prisma/prisma — **critical path, start immediately**

Merge prisma-next content onto a `v8` branch in `prisma/prisma`; get the full CI suite green there and keep it green for the rest of the project. Includes deciding the history graft (v7 history under main vs parallel histories) via a dry run in a fork first. Merge to `main` happens in release week (W4), not before.

### Slice W2: npm ops on the `prisma` package — **critical path, external dependency, chase first**

Obtain publish rights and OIDC trusted-publisher configuration on the `prisma` npm package; confirm v7's release automation tolerates a second publisher under a different dist-tag. Also: collision audit of the visible rename set (`@prisma/postgres`, `@prisma/sqlite`, `@prisma/mongo`) against classic-owned `@prisma/*` names.

### Slice W3: decisions

Error-code scheme (Jul 18), Postgres floor (Jul 22), polymorphism go/no-go (Jul 24). Each unblocks a slice below.

### Slice W4: release week mechanicals (Jul 28–31)

Lockstep version to `8.0.0-rc.1` (`set-version`); visible-set rename (shim → `prisma`, facades → `@prisma/*`); `v7` maintenance branch cut with CI; merge v8 branch → main; issue-close sweep with pinned explanation issue and saved reply; publish under non-`latest` dist-tag; announcement live.

### Slice W5: announcement + upgrade guide

Leads with Node ≥24 + ESM-only as headline breaking changes; parallel-install recipe (mirroring the fixture); 12-months-from-final v7 statement; supported-surface matrix; explicit not-in-8.0 list; links to Bencher.

## Lane: Will (agent-executed) — mechanical engineering, lands as bot PRs

### Slice A1: TS performance benchmark harness — **first dispatch, before the type freeze**

Bench package generating synthetic schemas at 10/100/500 models; runs `tsc --extendedDiagnostics` across v8 under TS 5.9 and TS 7; emits Bencher BMF JSON per CI run to a **public Bencher project**. PR regression check fails on type-instantiation counts (deterministic); wall time and memory tracked as informational trend. One internal v7 comparison run sanity-checks the announcement wording — never published.

### Slice A2: migration contract-snapshot centralization — **pre-freeze (migrations/ layout freezes at RC)**

Centralize per-migration contract copies into content-addressed `migrations/snapshots/<storageHash>.json`. Migration dirs reference contracts via the from/to hashes already in `migration.json`; the contract-reference resolver learns the snapshot store; emitter updated; example migrations regenerated. Safe because ADR 199 excludes snapshots from migration identity. Writer emits plain JSON; reader accepts `.json.gz` from day one (compression stays a future non-breaking option).

### Slice A3: error-code consistency sweep — **blocked on W3 scheme decision (Jul 18)**

Fold the four error models into the ratified scheme: fold in the ~16 codeless classes (SQL driver errors, bespoke tail, the duplicated `ContractValidationError`), normalize the losing format, build the central factory/registry ADR 027 assumes, publish the crosswalk. Codes freeze at RC; conformance/golden tests may trail.

### Slice A4: `extensionPacks` → `extensions` rename (TML-2462) — **pre-freeze**

Breaking config-key rename; must precede the API freeze. Record upgrade instructions per the breaking-change workflow.

### Slice A5: Pool error-listener fix (TML-2655)

Idle-reconnect errors crash the host process; production-readiness fix, not cleanup.

### Slice A6: supported-surface matrix as structured data — **start now; only the freeze waits on decisions**

Feature area × database target × status (`stable` / `experimental` / `not-in-8.0`), as checked-in structured data. Every `stable` cell names the test suite that proves it; every `not-in-8.0` cell is a deliberate statement, not an omission.

**Where the rows come from — two sources, crossed:**

1. *What v8 ships*, enumerated from the codebase: facade subpath exports (`@prisma-next/{postgres,sqlite,mongo}`), the CLI command tree, the PSL feature set (attributes, types, namespaces), the ORM/query-builder operation surface, the migration operation catalog, and the extensions. If it isn't reachable through the blessed surface, it isn't a row.
2. *What v7 users expect*: Prisma 7's capability taxonomy (docs navigation + the functional test suite's directory structure, which is a de-facto feature census). This is the completeness checklist that makes "missing capabilities are named" true — absence can only be named against an enumeration of what users look for.

**Phase 1 (now, no dependencies):** enumerate rows, draft cell statuses, and list every stable-claimed cell with no proving suite — that list is S2's mining work-list.

**Phase 2 (freeze at Jul 24):** stamp final statuses once the Postgres floor (Jul 22) and the polymorphism call (Jul 24) land.

Feeds the S2 filter, the announcement's supported-surface section, and the post-RC public dashboard.

## Lane: Serhii — coexistence proof + correctness

### Slice S1: side-by-side fixture — **top risk, start immediately, zero dependencies**

One repo, both versions installed (npm alias for v7), one Postgres database, v7 owning DDL. Exercises: initial adoption (`contract infer` → `db sign`), the standing loop after a v7 migration (re-infer → re-sign → `db verify --schema-only`), and dual-client queries against the same data. The Dub.co side-by-side evaluation (WS1 M4) never ran, so this fixture is the first-ever test of the RC's central claim. Must be green by Jul 24.

### Slice S2: P7 test mining — **after S1, filtered by A6**

Mine (don't convert) the P7 functional suite: extract the database and relational-algebra edge cases it encodes, scoped to what the matrix claims is stable, into `test/integration/` + `test/e2e/` following the existing per-target patterns. The fixture from S1 doubles as the differential harness where v7-as-oracle comparison is cheaper than porting assertions.

## Lane: Alexey — polymorphism

### Slice X1: MTI/variant-relation stabilization

The ~10 active correctness bugs in SQL ORM polymorphism (variant relations, includes, update/delete predicates, namespace-flat variant resolution). The bug-discovery curve — not a completion promise — decides the Jul 24 call: flattened → in scope at RC; still producing → ships marked experimental and the stream continues post-RC.

## Sequencing constraints (everything else is parallel)

- W2 (npm rights) blocks nothing until release week, but its *external* nature means it starts first.
- W3 decisions block A3 (scheme) and A6 *phase 2 only* (floor + polymorphism call); A6 phase 1 blocks nothing and starts now.
- A6 phase 1's no-proving-suite list is S2's work-list; S1 must be green by Jul 24 or the coexistence claim in W5 is softened.
- A1, A2, A4, A5, A6 phase 1, S1, X1 have no upstream dependencies — all start immediately.
- W4 is strictly last and consumes everything.

## Close-out (required)

- [ ] Verify all acceptance criteria in [spec.md](spec.md)
- [ ] Migrate long-lived docs into `docs/` (upgrade guide, coexistence workflow, error-code scheme ADR + crosswalk, snapshot-layout ADR, supported-surface matrix home)
- [ ] Strip repo-wide references to `projects/prisma-8-rc1/**`
- [ ] Final retro; delete `projects/prisma-8-rc1/`
