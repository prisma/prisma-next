# Project 2 — Planner-driven DDL + expanded type/operator surface

> **Status: stub.** Project 2 is a forward-reference held by the [umbrella spec](../spec.md) and the [Project 1 spec](../project-1/spec.md). It will be shaped properly (full description, requirements, acceptance criteria) after Project 1 ships and the framework prerequisites it consumes (per-column `planTypeOperations` input + prior-state contract for destructive DDL) are merged. This file exists so the umbrella plan has something to point at.
>
> **Linear:** [TML-2375](https://linear.app/prisma-company/issue/TML-2375). Component-level tracking only — no per-task or per-milestone Linear sub-issues.

# Summary

Promote cipherstash from "ships with hand-authored migration files" (Project 1) to "the planner generates the per-column DDL automatically from the contract." Expand the column-type and operator surface to match the full first-attempt scope: `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`, plus `orderAndRange` (`gt`/`gte`/`lt`/`lte`) and `searchableJson`. End-to-end-tested against live Postgres + EQL on the same shape Project 1 establishes.

# Description

Project 1's deliberate compromise is that users must hand-author `migration.ts` calling `cipherstash.addSearchConfig({...})` for every encrypted column. Project 2 closes that loop: the migration planner inspects the contract, sees the cipherstash-codec'd columns and their `typeParams` (search-mode flags), and emits the equivalent `DataTransformOperation`s automatically — including the *changes* between contract revisions (a column flipping from `equality: false` to `equality: true` should plan an additive search-config install; the reverse should plan a destructive search-config drop, gated by prior-state diffing).

The work splits along two axes:

- **Planner integration.** Cipherstash's control descriptor implements `planTypeOperations`, the codec-control hook the framework provides for extensions to emit per-column DDL during `dbInit` / `dbUpdate`. This is the surface Project 1 explicitly defers.
- **Surface expansion.** Each new column type (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`) ships with its own codec, PSL constructor, search-operator lowering, and end-to-end test. Per the umbrella's "ship only what's tested end-to-end" principle, no constructor lands in the public surface without a corresponding round-trip test.

# Dependencies

| Source | Subject | Project 2 dependency |
|---|---|---|
| Framework prerequisite | `(table, column)` input to `planTypeOperations` (was TML-2338, cancelled in Linear redesign — work is real, not separately tracked) | **Hard** — cipherstash's `planTypeOperations` arm needs the column identity to emit `eql_v2.add_search_config(...)` ops |
| Framework prerequisite | Prior-state contract supplied to `planTypeOperations` for destructive DDL (was TML-2339, cancelled in Linear redesign — work is real, not separately tracked) | **Hard** — needed to plan search-config *drops* when a column's mode flag flips false |
| [TML-2292](https://linear.app/prisma-company/issue/TML-2292) | Unify `DataTransformOperation` and `SqlMigrationPlanOperation` | **Soft** — Project 2 can ship before TML-2292 lands; if both land together the planner-emitted ops use the unified shape |
| Project 1 | EQL bundle install, `EncryptedString` codec, search operators, `RawSqlExpr` AST node, `addSearchConfig` factory shape | **Hard** — Project 2 lifts Project 1's per-column factory output into planner-emitted ops |

# Open questions (deferred to shaping)

- **Mode-flag downgrade semantics.** When a contract revision flips `equality: true` → `equality: false`, the natural plan is to drop the search config. But existing `cs_configuration_v2` rows are silently dropping a search index that may have downstream consumers. Plan-time warning vs hard error vs unconditional silent drop — needs design discussion.
- **Re-encryption migration story.** Adopting cipherstash for an existing populated column requires re-encrypting data — out of scope for Project 1, plausibly in scope for Project 2 if the planner can detect the codec-on-existing-column case. Could also remain a user-handled data migration via a hand-authored `dataTransform`.
- **Column-key-id surface.** Project 1's open question 4 (routing key derivation): if `encryptedString({...})` ends up needing an explicit per-column key id slot, Project 2 inherits the same shape across the expanded type surface.
- **`searchableJson` semantics.** EQL's JSON-search-token (`ste_vec`) configuration has more shape than the boolean flags Project 1 uses. The PSL constructor for `EncryptedJson` may need richer arguments (path filters, token policy) than the strings constructor's two booleans — needs concrete design.

# References

- [Umbrella spec](../spec.md)
- [Project 1 spec](../project-1/spec.md) — establishes the patterns Project 2 expands
- [Framework gaps assessment](../../../reference/framework-gaps.md)
