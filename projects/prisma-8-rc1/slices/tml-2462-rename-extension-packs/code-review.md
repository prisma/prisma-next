# TML-2462 — dispatch evidence and review record

Branch: `worktree/config-key-rename-6a45a5`, base `origin/main` (180a06d0f). Commits under review:

1. `a8eea7ca3` feat(config)!: rename extensionPacks to extensions; sourceFormat to format; outputPath to output — substrate rename in `packages/` (343 files). Guard inversion test-first; hash-pin tests updated.
2. `df8439312` feat(config)!: apply extension/format/output key renames across examples, apps, and test trees (189 files).
3. `f00a2aadf` fix(scripts): re-anchor snapshot-import migrations in regen-extension-migrations — latent bug, only triggers on hash churn; snapshot write + import rewrite now precede re-emit, with a to-hash assertion.
4. `94af3d469` chore(fixtures): regenerate contracts, migrations, and snapshots for the extensions key rename (348 files; 16 old-hash snapshot dirs verified unreferenced then removed).
5. `98dc423a5` docs: converge docs and skills on the extensions key; record upgrade instructions (33 files; ADR 004/112 corrections; 0.16-to-0.17 upgrade entries for consumers and extension authors).

## Gate evidence (implementer-reported, logs in wip/, 20260723-*)

| Gate | Result |
| --- | --- |
| fixtures:check | green (idempotent re-emit) |
| build | green 68/68 |
| typecheck | green 143/143 |
| lint (15 steps incl. casts, throws, framework-vocabulary, deps, skills, rules, footprint) | green |
| check:release-notes --mode pr | green |
| check:upgrade-coverage --mode pr | green (after 98dc423a5) |
| test:packages | green, 13346 passed (1 timeout flake, passes standalone) |
| test:integration | green, 1170 passed (3 timeout flakes, each passes standalone) |
| test:e2e | green 20/20 (109 tests) |
| test:examples | 72/73 (cloudflare-worker needs local Hyperdrive env — environment precondition) |

## Known accepted residue

- Old key survives only in: the inverted guard + its test, historical records (CHANGELOG, docs/releases/v0.12.0.md, past upgrade instruction dirs, postgis gotchas.md, projects/ archives), the new 0.16-to-0.17 upgrade entries (before-state + detection predicates), and replay fixture chains (TML-3082) / telemetry-backend snapshots (TML-3083) — both filed as follow-ups, both proven non-deserialized by green suites.
- Upgrade-entry "validation by execution" replay was not mechanically re-run; the recorded transformation is the branch itself (flagged by implementer; reviewer to weigh).

## Review rounds

### Round 1 — principal-engineer pass (Opus), 2026-07-23

Verdict: **approve-with-fixes**; no correctness defects.

- Silent-drop hazard traced end-to-end and confirmed safe: config guard rejects loudly; both family validators carry top-level `'+': 'reject'` so old-key contract.json is rejected, not stripped; snapshot reads are hash-keyed so old snapshots are only reachable via old hashes (miss → loud `MIGRATION.CONTRACT_SNAPSHOT_MISSING`).
- Pinned-hash tests re-run by the reviewer directly (81 + 1 + 39 passed); provenance of two hand-copied off-glob fixtures byte-verified; ADR 004's corrected claim verified exactly true of `hashing.ts`; upgrade-instruction guard quote verbatim-accurate; no `sha256:` scope creep; no new bare casts.
- Finding 1 (DoD deviation): old-key literals persist in replay fixture chains + telemetry-backend snapshots. Ratified by the orchestrator as a conscious deferral (TML-3082/3083); spec residue list amended accordingly.
- Finding 3/5 (nits): regen-script guard message could misfire in an inconsistent state (unreachable today); pre-existing `(AC5)` transient ID in a touched test description. Both routed to a final fix round.
- Mild scope stretch noted, accepted: generic type param `ExtensionPacks` → `Extensions` in builder signatures (concept types like `ExtensionPackRef` correctly preserved).
- Intent validation: Scope-In fully delivered; DoD met modulo the ratified deviation above.
