# Slice 3 — dispatch plan

Spec: [`spec.md`](./spec.md). Branch: `slice/explicit-rls-control` (off merged main `bbde1e464`). Six dispatches, sequential, one persistent implementer (Sonnet) + one persistent reviewer (Opus). The slice follows 2.5's land-in-parallel-then-flip pattern: new state and new ops land unconsumed (W3, W4), then one dispatch flips the planner/verify onto them (W5).

Per-dispatch gate (from [`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)): build where typed exports changed, forced typecheck (incl. test tsconfig), per-package `pnpm lint`, scoped `--filter` suites for touched packages, `fixtures:check` when emission-adjacent. Slice gate in W6. Tests are written before implementation within every dispatch (repo golden rule).

## W1 — `modelAttributes` contribution slot (framework, generic)

**Outcome:** `AuthoringContributions` gains a `modelAttributes` slot (parallel to `pslBlockDescriptors`, `framework-authoring.ts:361-377`): a declarative descriptor (ADR 231 attribute-spec kit) carrying the attribute name and a lowering that receives the parsed arguments + model context and returns an entity for the namespace's `entries` (or diagnostics). The SQL interpreter's model-attribute loop consults contributed descriptors after the built-in names and before the `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` fallthrough (`interpreter.ts:819-824`); unknown attributes behave exactly as today. **No RLS vocabulary anywhere in this dispatch** — proven with a test-only fake contribution.
**Completed when:** framework + contract-psl tests pin: descriptor consulted, entity lands in `entries`, duplicate-attribute and bad-argument diagnostics, unknown-attribute fallthrough unchanged; `pnpm build` on framework-components + downstream typecheck; `lint:deps` clean; upgrade-coverage entry recorded for the new SPI surface.
**Hands to W2:** the slot exists and is documented; a target can register a model attribute that emits an entity.

## W2 — `@@rls` end-to-end in the Postgres target (authoring + entity + validation)

**Outcome:** the Postgres pack contributes the `rls` model attribute (no arguments) through W1's slot; it lowers to the marker entity (working name `entries['rls'][tableName]`), registered via `postgresAuthoringEntityTypes` so serialize/deserialize round-trips and `contract infer` omits it (the TML-2962 extension-pack omission path). Authoring rule enforced both places per spec D1: `policy_*` block targeting an unmarked model → load-time diagnostic naming model + policy prefix; the same contradiction in a constructed contract → fail-loud throw at derivation (beside the absent-table throw, `contract-to-postgres-database-schema-node.ts:123-130`). Existing package fixtures/tests that author policies gain markers here.
**Completed when:** AC-1 and AC-2 pinned in psl-policy-authoring / rls-ir-kinds / serializer round-trip tests; postgres-target suite green; `fixtures:check` clean.
**Hands to W3:** every policy-bearing contract in the tree is marker-consistent; the marker is readable from the contract.

## W3 — `rlsEnabled` state on both schema-IR sides (parallel, unconsumed)

**Outcome:** `PostgresTableSchemaNode` carries `rlsEnabled: boolean`. Expected side: `contractToPostgresDatabaseSchemaNode` stamps it from marker presence (never from the policy set). Actual side: adapter introspection reads `pg_class.relrowsecurity` per table (today only op pre/postchecks read it, `checks.ts:382-415`). **`isEqualTo` is untouched** — the differ does not yet see the attribute, so behavior is nil.
**Completed when:** node/derivation unit tests + an adapter-postgres integration test pin the stamp on both sides; every `PostgresTableSchemaNode` construction site (derivation, introspection, tests) supplies the field; all suites green untouched.
**Hands to W5:** both trees carry trustworthy `rlsEnabled` values.

## W4 — Disable + rename op machinery (additive, unconsumed)

**Outcome:** two new op families exist end-to-end but nothing plans them: `disableRowLevelSecurity` (op-factory-call `DisableRowLevelSecurityCall`, operation class **destructive**, DDL node, contract-free constructor, adapter render hook, `relrowsecurity` pre/postchecks — mirror of `enableRowLevelSecurity` at `rls.ts:80-106` / `op-factory-call.ts:1435-1462`) and `renameRlsPolicy` (`ALTER POLICY <old> ON <schema>.<table> RENAME TO <new>`, **non-destructive**, pre/postchecks on old/new policy name presence). The wire-name parse (`/^(.+)_([0-9a-f]{8})$/`, inlined at `control-adapter.ts:1159`) is promoted to a shared helper in the target's rls module and the introspection call site consumes it.
**Completed when:** rls-ops-pattern tests assert exact op shapes, exact SQL, `toOp()`/`renderTypeScript()` round-trips for both ops; helper unit-tested; postgres-target + adapter-postgres suites green; no planner file touched.
**Hands to W5:** the ops the flip needs are proven in isolation.

## W5 — The flip: marker-driven enablement + rename post-pass in the planner

**Outcome:** RLS control derives entirely from the marker + content hash. `PostgresTableSchemaNode.isEqualTo` compares `rlsEnabled`; the planner routes the resulting table `not-equal` issue to `EnableRowLevelSecurityCall` / `DisableRowLevelSecurityCall` (note the routing joint: table issues land on the **relational** side of `buildPostgresPlanDiff`'s split at `planner.ts:182-188`, and `mapNodeIssueToCall` has no table `not-equal` case today — where the enablement issue is intercepted is the implementer's call, but it must be partitioned by control policy like every RLS call). The imperative enable-on-first-new-policy (`seenEnableTables`, `planner.ts:336-387`) is **deleted**. The rename post-pass pairs `not-found`+`not-expected` policy issues per table by hash suffix (deterministic sorted-name pairing on multi-candidate hashes; leftovers create/drop) into `RenameRlsPolicyCall`, which plans without the destructive allowance. Verify falls out generically (table `not-equal` → `declaredIncompatible`, graded per table control policy — no verify plumbing changes).
**Completed when:** AC-3 planner semantics, AC-4 rename, and the AC-5 managed/external matrix (create/drop/rename/enable/disable × plan + verify) are pinned in rls-planner/verdict tests, including the spec's pre-investigated edges (in-sync-policies-but-RLS-off plans ENABLE; external table with RLS on and no marker plans nothing and verify suppresses; marker with zero policies plans ENABLE; last-policy removal plans no enablement op); non-RLS planner suites byte-identical; multi-space guards green.
**Hands to W6:** planner + verify behavior is final; only user-facing surfaces and the slice gate remain.

## W6 — Examples, e2e, upgrade instructions, slice gate

**Outcome:** the Supabase walking-skeleton example's policy-bearing models carry `@@rls`; fixtures regenerated (`fixtures:emit` — expect current `contract.json` diffs, no historical migration snapshot churn, no new migration since live state already has RLS on); the skeleton e2e gains the AC-3 fail-closed behavioral probe (drop last policy → verify clean → rows still denied under `SET ROLE`) and the AC-4 rename round-trip (prefix change → exactly one `ALTER POLICY … RENAME TO` → apply → verify clean). Upgrade instructions recorded (`record-upgrade-instructions`) for the new SPI slot + the policy-requires-`@@rls` authoring rule. A golden diff of real `plan()` output over the committed examples proves non-RLS op parity.
**Completed when:** full slice gate green — build, forced typecheck, whole Lint job (incl. framework-vocabulary ratchet), `fixtures:check`, `test:packages` + `test:integration` + `test:e2e`, multi-space guards, `check:upgrade-coverage --mode pr --prev $(git merge-base origin/main HEAD)`; slice-DoD checklist walked verbatim (incl. QA-side items); `origin/main` synced before final validation + push.

## Sequencing & handoffs

`W1 → W2 → W3 → W4 → W5 → W6`, strictly. Non-linear edges: W4 builds on the substrate only (independent of W2/W3 — sequenced for the single persistent implementer, not by dependency); W5 builds on **W3 + W4** jointly; W6 consumes W2 (markers in examples) + W5 (behavior).

## Known blast radius (from grounding)

- Framework SPI surface change (W1) → upgrade-coverage will demand entries; downstream typecheck after `pnpm build` on framework-components.
- Every `PostgresTableSchemaNode` construction site gains a field (W3) — derivation, introspection, ~10+ test files (`postgres-table-schema-node.test.ts`, `contract-to-postgres-database-schema-node.test.ts`, rls-planner, node-issue-planner, sibling-scoping, verdict tests).
- Marker adoption (W2/W6) touches every fixture that authors a `policy_*` block: postgres-target tests, `examples/supabase`, and any `packages/3-extensions/*` contract with policies — `fixtures:check` is the guard.
- `rls-planner.test.ts` (362 lines) partially rewrites in W5 (the enable-on-first-policy expectations die with the imperative path).
- Slice 2.6 (`unify-unique-and-index-nodes`) may land concurrently on adjacent files (`diff-tree-normalization.ts`, index/unique nodes) — this slice touches neither; rebase noise only.
