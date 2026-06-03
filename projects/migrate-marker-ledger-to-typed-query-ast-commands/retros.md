# Project retros — migrate-marker-ledger-to-typed-query-ast-commands

Trigger-based per `.claude/skills/drive-run-retro/SKILL.md`. Entries land lessons in durable surfaces (canonical skill bodies, project-context READMEs, ADRs); without a landed output the retro is not done.

## 2026-06-03 — Slice 2 shipped 3 architectural mistakes; operator caught all 3 at PR review

**Trigger:** operator-flagged surprise (`CHANGES_REQUESTED` on PR #712 after Slice 2 closed SATISFIED through the build loop). Three distinct findings; all three escaped the implementer + subagent reviewer + orchestrator triple-check.

### What happened (the observable events)

| # | Finding | Where | Caught by |
|---|---|---|---|
| 1 | `TableSource.schema?` added as a field on the **generic** SQL core `TableSource` class (a Postgres-only concept on the shared base). Implementer added a code comment explaining the layering violation and shipped it. | [`packages/2-sql/4-lanes/relational-core/src/ast/types.ts:336`](packages/2-sql/4-lanes/relational-core/src/ast/types.ts) + sibling in contract-free DML builder | Operator at PR review |
| 2 | Read path uses a **template-method orchestrator** in `family-sql/verify.ts` (`readMarkerResult`) that takes dialect-specific SQL fragments + a row decoder from each adapter via a `MarkerReadShape` interface. The adapter exists to hide those implementation details; we punched them back out through a shared interface to satisfy ~15 lines of orchestration. Asymmetric with the write SPI we got right (where each adapter owns `initMarker` / `updateMarker` / `writeLedgerEntry` end-to-end). | [`packages/2-sql/9-family/src/core/verify.ts:7-153`](packages/2-sql/9-family/src/core/verify.ts) | Operator at PR review |
| 3 | `sign()` race: D4 collapsed marker write to `INSERT … ON CONFLICT DO UPDATE` (correct for migration-runner re-apply) but `sign()` calls the same `initMarker` and *must* fail loudly on existing rows. Two concurrent signers could observe "no marker" and the second silently overwrites the first. | [`packages/2-sql/9-family/src/core/control-instance.ts:604-608`](packages/2-sql/9-family/src/core/control-instance.ts) | CodeRabbit (already fixed at `5da812ac0` via new `insertMarker`) |

### Root causes

These are not three independent misses. They share an orchestrator-level theme: **the dispatch briefs framed wins in terms of mechanics (add a field, dedupe into one home, collapse to one primitive) rather than in terms of the architectural property the dispatch should preserve.** Implementer + reviewer satisfied the brief; the brief asked for the wrong thing.

**Finding 1 — root cause:** At D1 the implementer halted because the proposed shape ("build query-AST DML nodes via the slice-1 contract-free constructors") needed schema-qualified DML and `TableSource` couldn't express it. The orchestrator (me) authorised **Option A: add `TableSource.schema?` to the generic core**, framing it as in-scope because Slice 1 had `PostgresCreateTable.schema`. **That parallel was wrong.** Slice 1's `PostgresCreateTable` is a *target-contributed subclass*, not a field on a generic core class — the layering it preserves is the opposite of what D1 broke. The brief should have anchored on Slice 1's pattern explicitly ("PostgresTableSource extends TableSource, in the postgres target package") instead of waving the problem through. The implementer then added a comment acknowledging the violation — that comment is itself a **must-fix signal** that the dispatch should HALT and re-confer, but neither the implementer nor the reviewer treated it as one.

**Finding 2 — root cause:** The D3 brief I wrote framed the win as *"one read home + one parser"*. That framing produced the inverted abstraction directly: if the goal is "one home," the easy way to get there is a shared orchestrator that takes adapter fragments via an interface — and that's what shipped. The correct framing — *"symmetry with the write SPI: the adapter owns each operation end-to-end; family-sql calls `adapter.readMarker(driver, space)` and doesn't know the implementation details; the only shared piece is the pure-function parser"* — would have made the template-method shape obviously wrong on read. Reviewer SATISFIED the wrong-framed brief.

**Finding 3 — root cause:** At D1 I committed to "upsert collapses to `INSERT … ON CONFLICT DO UPDATE`" as a decision driven by the migration-runner's idempotent-re-apply contract. I did not re-check that decision against `sign()`'s contract (init-once, fail-loudly on duplicate). When D4 then performed the cut-over, the brief asked the reviewer to verify specific items (column-set reduction, CAS semantics, gates) — none of those items prompted "trace each API change through every caller's contract." The reviewer verified the listed items thoroughly and missed the unlisted caller. CodeRabbit caught it because its review surface is "trace every public-API change through callers" generically.

The common pattern across all three: **brief discipline. The orchestrator's brief is what the implementer and reviewer optimise for; if the brief frames the wrong win-state, both will satisfy the wrong win-state with high confidence.**

### Landing surfaces (where the lessons go)

| Lesson | Surface | Entry |
|---|---|---|
| Self-acknowledged layering-violation comment is itself a must-fix finding; HALT and re-confer rather than ship. | [`drive/code/README.md`](../../drive/code/README.md) § Repo-specific smells | "Self-acknowledged layering violation" |
| Template-method orchestrator in a shared layer that takes adapter implementation-detail fragments via an interface is an inverted abstraction — should be replaced with an adapter-owned end-to-end method, with only pure helpers shared. | [`drive/code/README.md`](../../drive/code/README.md) § Repo-specific smells | "Inverted abstraction: shared template-method orchestrator over adapter fragments" |
| AST class fields that name a target (e.g. `TableSource.schema?` where only Postgres has schemas) are the AST-class form of the same violation `no-target-branches.mdc` already covers for constants/helpers. | [`.agents/rules/no-target-branches.mdc`](../../.agents/rules/no-target-branches.mdc) — new section "AST class fields are the same violation" | (rule tightening) |
| Brief discipline: framing a dispatch's win in terms of mechanics ("one home," "add a field") instead of the architectural property to preserve produces wrong-shape work that satisfies review. | [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md) | **F17** — Brief frames win as mechanics; implementer ships wrong-shape work that satisfies review |
| Template-method-via-adapter-fragments is its own catchable pattern. | [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md) | **F18** — Inverted abstraction: shared orchestrator over adapter fragments |
| API decision made for one caller's contract bleeds to other callers without contract re-check. | [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md) | **F19** — Single-primitive collapse changes semantics for some callers but not others |
| Dispatch-DoR: when a dispatch collapses two distinct caller use-cases into a single primitive, brief must enumerate each caller's contract and verify each survives. | [`drive/calibration/dor.md`](../../drive/calibration/dor.md) § Dispatch-DoR overlay | (DoR item appended) |
| Dispatch-DoR: review prompts must include a generic "trace each public-API change through all callers" item alongside the specific verification list. | [`drive/calibration/dor.md`](../../drive/calibration/dor.md) § Dispatch-DoR overlay | (DoR item appended) |

### Corrective course (Slice 2, on the same branch)

1. Revert `TableSource.schema?` from generic core; introduce `PostgresTableSource extends TableSource` in the postgres target package (mirror Slice 1 DDL pattern). Reshape contract-free DML so `schema` is only reachable via the postgres-target's contract-free surface.
2. Delete `MarkerStatement` / `MarkerReadShape` / `MarkerReadQueryable` / `readMarkerResult` from `family-sql/verify.ts`. Move each adapter's marker read into its own end-to-end `readMarker(driver, space)` method. Keep `parseContractMarkerRow` as the only shared piece.
3. `sign()` race fix (`insertMarker`) already landed at `5da812ac0`. No further action; retro lesson F19 is the durable output.

Spec + plan updates are appended in the same commit chain as the retro landings (see `slices/sql-marker-ops-through-adapter/spec.md` and `plan.md` revisions).

## 2026-06-03 (round 2) — Slice 2 corrective work shipped, operator caught a deeper architectural miss

**Trigger:** operator-flagged surprise on PR #712 after corrective dispatches D5 / D6 / D7 closed SATISFIED. Five new findings on a single review pass; one is structural and conditions the others.

### What happened

The corrective dispatches landed the three mechanical fixes the round-1 retro identified (PostgresTableSource layering split, adapter-owned readMarker, MarkerStatement deletion). Operator reviewed the resulting code and flagged that the **contract-free authoring surface** (`packages/2-sql/4-lanes/relational-core/src/contract-free/dml.ts`) is not actually a query builder — it's option-bag factory wrappers around a chainable AST class API that already exists, with codec IDs / table names / column names threaded at every call site. Marker writes that *use* this "builder" are 50-line literal-record assemblies; the D6 read path uses raw SQL strings via `driver.query(sql, [params])` and doesn't attempt the AST at all.

Five operator findings on the review pass:

| # | Finding | Surface |
|---|---|---|
| 1 | `dml.ts` is a fake builder — `insert(table, row)`, `update({...})`, `upsert({...})` are option-bag wrappers around `InsertAst.into(...).withRows(...).withOnConflict(...)` chain that already chains. | [`packages/2-sql/4-lanes/relational-core/src/contract-free/dml.ts:49,59,81`](../../packages/2-sql/4-lanes/relational-core/src/contract-free/dml.ts) |
| 2 | Marker write code constructs AST atoms by hand at every leaf (`BinaryExpr.eq(ColumnRef.of(...), param(..., {codecId: ...}))` repeated). Unreadable. | [`packages/3-targets/6-adapters/postgres/src/core/marker-ledger-writes.ts:175-182`](../../packages/3-targets/6-adapters/postgres/src/core/marker-ledger-writes.ts) |
| 3 | Marker read code is raw SQL strings, not AST. The slice exists to migrate this exact pattern off raw SQL; D6 put it back in. | [`packages/3-targets/6-adapters/postgres/src/core/marker-read.ts:15-26`](../../packages/3-targets/6-adapters/postgres/src/core/marker-read.ts) |
| 4 | `marker-read.ts` + `marker-ledger-writes.ts` are split across two files; should be one (`marker-ledger.ts`). | adapter cores |
| 5 | `control-codec-registry` is misnamed — there's nothing control-plane-specific about it, it just happens to be the current consumer. | [`packages/2-sql/5-runtime/src/codecs/control-codec-registry.ts`](../../packages/2-sql/5-runtime/src/codecs/control-codec-registry.ts) |

Plus a meta-finding on this project's own calibration docs: the F19 Dispatch-DoR overlay item I wrote in the round-1 retro enumerates "every caller of either pre-collapse operation" in the brief, which violates Drive's "briefs assert properties, not file lists" principle. The right framing is property-based: *"no reference to the pre-collapse operations survives after this dispatch."*

### Root cause

Finding 1 (and through it, findings 2–4) traces to a single orchestrator-level miss: **the D1 brief framed the win as "use the typed AST" instead of "deliver a fluent authoring surface analogous in spirit to `sql-builder`'s contract-bound `sql()` interface"**. The implementer (composer-2.5-fast) optimised for the literal interpretation — assemble AST nodes — and pattern-cloned Slice 1's atom-constructor shape (`col` / `lit` / `fn` for DDL — correct because DDL is one-shot, non-chainable) into a domain (DML) that genuinely needs a fluent builder. The wrong precedent transferred the wrong ergonomics.

Two layered orchestrator-side mistakes:

1. **Implementer tier was wrong for the work.** composer-2.5-fast is calibrated for mechanical execution against a clear spec; assigning it a *design-heavy* dispatch (where the success criterion is architectural taste over correctness) defaults to the lowest-cost-to-satisfy interpretation. On an ergonomics slice, the lowest-cost-to-satisfy interpretation is the wrong-shape interpretation. **Implementer slot for D8 onwards is now `claude-4.6-sonnet-high-thinking`.**
2. **F17 property-statement discipline didn't catch this.** F17 already exists ("brief frames the win as mechanics; implementer + reviewer ship wrong-shape work that satisfies it"); the round-1 retro added it. F17 *would* have caught this if my D1 property statement had named the ergonomic property — but I framed it as "use the typed AST," which the implementer literally did. The F17 mitigation needs to extend to ergonomic-slice briefs specifically: when a slice exists to improve authoring ergonomics, the property statement names the *ergonomic property* (typed proxies, chain depth, no per-call-site context threading), not the *transport property* (uses the AST).

Finding 5 (control-codec-registry naming) is independent — a name was chosen for the first consumer rather than for the abstraction's scope. Small standalone fix.

### Landing surfaces

| Lesson | Surface | Entry |
|---|---|---|
| Implementer ships AST construction by hand wrapped in option-bag factories instead of building the fluent surface the slice exists to deliver. | [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md) | **F21** |
| F19 DoR overlay item rewritten to be property-based (no file enumeration). | [`drive/calibration/dor.md`](../../drive/calibration/dor.md) line 45 | (overlay revised in place) |
| Implementer-tier choice has architectural consequences: cheap-tier implementers default to the lowest-cost-to-satisfy interpretation; on ergonomics slices, that's the wrong shape. | [`drive/calibration/failure-modes.md`](../../drive/calibration/failure-modes.md) F21 mitigation | (mitigation bullet on tier check) |

### Corrective course (Slice 2-bis, on the same branch)

Three more dispatches, all to `claude-4.6-sonnet-high-thinking`:

- **D8** — replace `dml.ts` wholesale with a real contract-free fluent authoring surface analogous in spirit to `sql-builder` (typed table declarations via `table(...)`; typed column proxies that carry codecs; fluent chain `.update().set(...).where(...).returning(...)`; produces existing AST classes). Per-target codec helpers (`text`, `int4`, `jsonb`, `textArray`, `timestamptz`) live in `@prisma-next/target-postgres/contract-free` + `@prisma-next/target-sqlite/contract-free`. Vocabulary: "contract-free" throughout, no "control."
- **D9** — rewrite `marker-ledger-writes.ts` + `marker-read.ts` to use the new builder, including the read path; collapse the two files into one `marker-ledger.ts` per adapter (PG + SQLite).
- **D10** — rename `control-codec-registry` to a plane-neutral name (suggested: `contractFreeCodecRegistry` / `createContractFreeCodecRegistry`). Rides on D9's branch state.

Plus orchestrator-side fixes (this commit): F19 DoR overlay rewritten property-based; F21 added to failure-modes; spec + plan revised with round-2 corrective scope.

