# postgres-rls — handoff

Orientation for an agent picking this project up cold. The authoritative status is [`plan.md`](./plan.md)'s slice table; this doc is the fast path in.

## Read first

1. [`plan.md`](./plan.md) — slice roadmap + status (source of truth for done/next), [`spec.md`](./spec.md) — project intent, [`../README.md`](../README.md) — project-artifact layout.
2. The last-merged structural slice: [`slices/one-differ-two-ir-planner/`](./slices/one-differ-two-ir-planner/) — its `spec.md`, `plan.md`, and `design-codec-render-via-registry.md`. This is the **substrate the RLS slices build on** — understand it before extending it.
3. [`specs/`](./specs/) — the ADRs (start with `adr-schema-diff-over-structured-ir.md`).
4. Repo conventions: root `CLAUDE.md`/`AGENTS.md`, and [`docs/onboarding/fixtures-emit-and-check.md`](../../docs/onboarding/fixtures-emit-and-check.md).

## The substrate the last slice established (don't relapse)

- One generic differ over two derived **schema IRs**; one node-typed issue `SchemaDiffIssue<TNode>` with `reason: not-expected | not-found | not-equal`. Every schema element is a node; `isEqualTo` compares a node's **own attributes only** — the differ recurses.
- The migration planner is `plan(start, end)` — two schema IRs in, ops out.
- **The schema-IR node carries only state + its `nodeKind` identity.** Nothing verdict-, formatting-, or contract-shaped lives on it. Family-owned classification (subject granularity) is stamped by the family onto the *issue*, never the node. Sibling-space scoping is an aggregate capability (`SchemaOwnership.declaresEntity`, keyed on a **coordinate**, not a bare name) the planner consults — the planner holds no sibling names. Column DDL is rendered by resolving a `CodecRef` against the framework codec registry (`codecLookup.forCodecRef`), never pre-baked onto a node.
- `db verify` output is issue-based (verdict + issues + unclaimed); the old pass/warn/fail tree is gone (a native view returns under TML-2974).

## Next work

**Slice 3, `explicit-rls-control` (TML-2869):** `@@rls` model-level enablement (drives ENABLE/DISABLE; removing the last policy on an `@@rls` model leaves RLS on, fail-closed; a policy on an unmarked model is an authoring error), policy rename via `ALTER POLICY … RENAME TO` (planner post-pass pairing missing+extra by content-hash), and `managed`/`external` per-table grading. Shape it through the Drive process (`drive-start-workflow`): write spec + plan yourself, then run the build loop. Then slices 4 (`migration-support-for-roles`), 5 (TML-2870), 6 (TML-2883).

**Follow-ons this substrate spawned (not the RLS critical path — don't start unless directed):** "codec-contributed ops ride the one differ" (extensions/types as first-class diff nodes + fold the field-event planner onto the differ, which lets `plan()` finally shed the contract); TML-2974 (native per-space verify render); TML-2958 (PSL-inference tree-walk).

## How to operate (standing conventions)

- Route substantive change-work through the Drive process; write specs/plans/ADRs yourself, delegate code to implementer subagents (never hand-edit source). Sonnet for implementers, Opus for reviewers.
- Execute autonomously; surface only when genuinely blocked or a design fork is unsettled, in plain text (no question-picker UI). When the operator flags a real problem, concede fast and fix the class, not the instance.
- **Byte-identity of planner ops is proven by the target/adapter suites (exact op→SQL assertions), the `migration plan` e2e journeys, and a golden diff of real `plan()` output — NOT `fixtures:check`**, which only gates contract emission (it re-serializes hand-frozen example ops and never calls the planner). Recurring trap; see the onboarding doc above.
- Before green, run the full CI gate set (build, forced typecheck, the whole Lint job incl. `lint:framework-vocabulary`, `fixtures:check`, all three test suites, the multi-space guards). Implementer subagents run slow commands foreground/blocking — never backgrounded-and-parked.
- Commit/push identity, sign-off, and the bot remote follow the repo's agent conventions. Linear tickets for slices lacking one (2, 2.5, 4, and the codec-ops follow-on) are the operator's to create — don't create them unprompted.
