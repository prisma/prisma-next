# Code review — read-command-json-redesign (TML-2836)

> Reviewer maintains scoreboard/findings/round-notes/summary; orchestrator owns § Subagent IDs + § Orchestrator notes.

## Summary

- **Current verdict:** SATISFIED
- **AC scoreboard totals:** 8 PASS / 0 FAIL / 0 NOT VERIFIED

The six final shapes match the spec and use `name`/`space`/`hash`/`fromContract`/`toContract`/`currentContract`/`targetContract` identically. No retired name leaks anywhere (production or renderer reads). The arktype schemas are the genuine source of truth — every result type is `typeof Schema.infer`. The two-bodies `ok`/error model is honored and a consumer can distinguish check's integrity outcome (`failures`, no top-level `code`) from the error envelope (top-level `code`, unchanged). Empty-start `fromContract` is `null` everywhere including graph (F-1 closed). No bare `as`/`any` added in production. One low-process observation (F-2) about the parity file's log/show sections being redundant tautologies, but the real runtime locks exist in the dedicated command tests, so coverage is sound.

## Acceptance criteria scoreboard

| AC ID | Description (short) | Dispatch | Status | Evidence |
| ----- | ------------------- | -------- | ------ | -------- |
| AC-1 | Shared migration vocabulary renamed (name/space/fromContract/toContract/current+targetContract) across types + renderers; compiles | D1 | PASS | `migration-list.ts:112-120` (name/hash/fromContract/toContract); `migration-list-render.ts:75-118`, `migration-list-graph-topology.ts:322-325`, `migrations.ts:338-361` all read renamed fields; `migration-status.ts:560-565` currentContract/targetContract. Build+typecheck clean per gates. |
| AC-2 | Shared arktype sub-schemas exist; shared result types derived from them; `list --json` emits + validates against its schema | D2 | PASS | `json/schemas.ts:3-43` (`migrationEntrySchema`/`contractRefSchema`/`successEnvelopeBaseSchema` + list schemas); `migration-list-types.ts:1-5` re-exports the schema-derived types; `migration-read-commands-parity.test.ts:899-919` validates real `list --json` output against `migrationListResultSchema`. |
| AC-3 | `graph --json` nested per space (`spaces[].contracts/migrations`), schema-locked | D3 | PASS | `migration-graph.ts:183-195` builds `spaces[].contracts/migrations`; `read-commands-json-golden.test.ts:205-262` pins real output + validates against `migrationGraphJsonResultSchema`; empty-start `fromContract: null` at `migration-graph.ts:192`. |
| AC-4 | `status --json` currentContract/targetContract + structured diagnostics, schema-locked | D4 | PASS | `json/schemas.ts:78-121` discriminated diagnostic union (3 variants matching the 3 producers at `migration-status.ts:313/522/580`); `migration-status.test.ts:133-185` validates real output + status field; `format-status-summary.test.ts` exercises the folded-in MISSING_INVARIANTS in the human renderer. |
| AC-5 | `log --json` ledger `records` + renamed fields, schema-locked | D5 | PASS | `migration-log.ts:138-143` emits `records`; `migration-log-table.ts:191-203` `serializeLedgerEntriesForJson` maps migrationName→name etc.; `migration-log.test.ts:190-201` validates the REAL command stdout against `migrationLogResultSchema` and asserts `records[0].name`. |
| AC-6 | `show --json` drops dirPath + inner summary, schema-locked | D6 | PASS | `migration-show.ts:51-87` no `dirPath`, no inner summary, top-level summary at `:215`; `migration-show.test.ts:316-329` validates real `show --json` against `migrationShowResultSchema` and asserts `migration.name`/`migration.space`. |
| AC-7 | `check` failures on error-envelope vocab (`code`/`where`/`why`/`fix` + `space`), schema-locked (two ok:false bodies) | D7 | PASS | `json/schemas.ts:179-195` distinguishes `checkFailureSchema` (`space/code/where/why/fix`) from the error envelope; `migration-check.ts:628-660` routes the error envelope (`formatErrorJson`, top-level `code`) separately from the integrity outcome (`{ok,failures,summary}`); `ok===exit0` via OK/INTEGRITY_FAILED/PRECONDITION. `integrity-violation-to-check-failure.ts` maps all kinds with `space`+`code`. |
| AC-8 | Parity test validates all six against schemas + cross-command consistency + ok-mirrors-exit + topology rule | D8 | PASS | `migration-read-commands-parity.test.ts:891-1179`: real-output schema validation for list/graph/status/check; `assertNoRetiredNames` (`:878-889`) scans serialized JSON for all retired names + nodes/edges; empty-start null assertion (`:948-955`); ok-mirrors-exit (`:1059-1099`); topology (`:1101-1178`). log/show entries are type-shape locks (real locks live in their command tests — see F-2). |

Status: `PASS` / `FAIL` / `NOT VERIFIED — <reason>`.

## Subagent IDs

- **Implementer:** per-dispatch (harness has no resume — fresh per dispatch, full-context briefs). IDs recorded below.
  - D1 = `ab0aa065bfa6cda50`
  - D2 = `a8e46fd764266b05b`
  - D3 = `a5c51a675a4a2cd9d` (commit `9aa493fb4`; opus, structural)
  - D4 = `a20d88b8ab6c52496` (status; commit `bd9033e9c`)
  - D5 = `aa3a27cdb9b218395` (log records; commit `2b624914c`)
  - D6 = `a821e5c3eb8e8c4b4` (show trim; commit `a514bafd8`)
  - D7 = `aa41e4e038678514a` (check error-envelope vocab; commit `ef57aed15`)
  - D8 = `a1a41c2e1e5d793d5` (parity lock + graph empty-start fix; commit `b0934c8fd`)
- **Reviewer:** `a33bf9f86d24c7a34` (consolidated opus pass — SATISFIED, 8/8 PASS, F-1 resolved, F-2 low-process/no-action). Orchestrator intent-validation: pass-through. F-2 accepted as non-blocking — the parity file's log/show sections are redundant type-shape checks, but real runtime shape is pinned in `migration-log.test.ts`/`migration-show.test.ts` (they validate real command output against the schema), so no coverage gap. **Slice DoD met → push + PR.**
- **Trace:** emitting to `projects/migration-graph-rendering/trace.jsonl` via the `drive-record-traces` emitter (started at D4 after the operator flagged the gap; D1–D3 + spec/plan backfilled — D1–D3 dispatch-spine with real durations, no fabricated round/brief events; forward emission full spine from D4).

## Findings log

### F-1 — empty-start `fromContract` must be `null`, not the `sha256:empty` sentinel (cross-command, should-fix)

D3's `graph --json` emits `fromContract: "sha256:empty"` for baseline edges (the graph layer keys the empty origin as `EMPTY_CONTRACT_HASH`). `list`/`show` already coerce the empty start to `fromContract: null` at the read boundary. The settled design is **null everywhere at the empty start** ("same values everywhere"). Fix: coerce `EMPTY_CONTRACT_HASH → null` at each command's JSON boundary, and make the graph-migration schema's `fromContract` nullable.

**Plan to close:** D4 (status) and D5 (log) are instructed to coerce empty→null so the inconsistency doesn't spread; D8's parity test asserts `fromContract` is `null` (never the sentinel) at the empty start across all six; graph's coercion (D3 surface) is fixed in the review round when D8's assertion flags it. Tracked here so it isn't lost.

**Resolved (Round 1):** closed. Graph coerces `EMPTY_CONTRACT_HASH → null` at `migration-graph.ts:192`; the parity test asserts it (`migration-read-commands-parity.test.ts:948-955`); status has a dedicated empty-start-null test (`migration-status.test.ts:188-232`). `currentContract` legitimately stays `sha256:empty` at the empty start — that is the real DB-marker hash, not a migration endpoint, so the null rule does not apply to it (and the schema allows `string | null`). No other emit of `sha256:empty` in a `fromContract` position.

### F-2 — parity file's log/show "schema validation" sections validate hand-built objects, not real command output (low-process)

In `migration-read-commands-parity.test.ts`, the log and show entries (`:657-676`, `:609-632`, `:984-1008`, `:1010-1034`) build a sample object literal by hand and validate it against the schema. That cannot catch drift between the real command's `--json` and the schema — it only proves the schema accepts an object the author wrote to match it (close to tautological for drift detection). The test comments acknowledge this and point to the real locks. Those real locks are genuine and sufficient: `migration-log.test.ts:190-201` runs the actual command, captures stdout, asserts `records[0].name`, and validates against `migrationLogResultSchema`; `migration-show.test.ts:316-329` does the same for show. So overall coverage is sound; the parity-file log/show sections are redundant. No in-PR action required to ship — flagging as a process note: if these stay, a future reader may over-trust the parity file. Optional in-PR tightening: replace the two hand-built parity sections with the same real-command-capture pattern the list/graph/status/check sections already use (the log/show commands can be driven through `executeCommand` with mocked ledger/contract the same way their dedicated tests do).

## Round notes

**Round 1 (Opus reviewer).** Walked all six final shapes against the spec and read every touched command, schema, renderer, and test. Findings: F-1 confirmed closed (graph empty-start null landed; parity + status tests assert it). F-2 filed as low-process (parity file's log/show sections are tautological, but real runtime locks exist in the dedicated command tests, so the slice's claim holds). Verified: no retired name leaks (production or renderer reads, scanned via `assertNoRetiredNames` over serialized JSON and by reading the renderer diffs); result types genuinely `typeof Schema.infer`; the diagnostic union's 3 variants match the 3 status producers exactly; check's two-bodies model is honored and the error envelope is untouched (routed through `formatErrorJson`); `ok===exit0` holds across OK/INTEGRITY_FAILED/PRECONDITION; no bare `as`/`any` added in production (only an import alias); human-renderer layout preserved (field-access renames only). One uncovered-but-intentional human-output change: the show human renderer label `migrationHash:` → `hash:` (`migrations.ts:361`) is not asserted by `formatMigrationShowOutput`'s test, but it is a deliberate vocabulary alignment, not a defect. Verdict: SATISFIED.

## Orchestrator notes

**Build run via the drive-build-workflow protocol directly** (skill body already loaded earlier this session). Model tiers per `drive/calibration/model-tier.md`: D1 rename codemod → sonnet; D2 schema foundation → sonnet (precise pattern); D3 graph structural change → **opus** (substrate/design judgment); D4–D7 per-command → sonnet (compose D2's pattern); D8 parity test → sonnet; consolidated reviewer → opus. Each implementer commits before reporting (truncation guard seen earlier this session) and keeps reports short.

**D1 intent-validation (PASS):** the four renames (`dirName→name`, `spaceId→space`, migration-entry `from/to→fromContract/toContract`, status `markerHash/targetHash→currentContract/targetContract`) applied across shared types + all renderers; graph's JSON edge left for D3 (correct per scope). 17 files. **Environment gotcha fixed:** cli typecheck initially showed 4 `StorageNamespace` `entries`-vs-`tables` errors in test fixtures — these were STALE built `dist/*.d.mts` (source has `entries`, the stale dist had `tables`; one erroring file wasn't even touched by D1, and origin/main carries the same fixtures). `pnpm build` refreshed the dist and typecheck went clean. **Lesson for the rest of this slice: a red cli typecheck citing sibling-package types is probably stale dist — `pnpm build` before trusting it.** Implementers should build-then-typecheck, or treat sibling-type errors skeptically.

**D2 intent-validation (PASS):** shared arktype module `src/commands/json/schemas.ts` (`migrationEntrySchema`/`contractRefSchema`/`successEnvelopeBaseSchema` + the list-space + list-result schemas); shared result types derived from arktype; `list --json` validated against the exported schema in its golden test (`schema(value) instanceof type.errors`). Also did the spec's `migrationHash → hash` (migration's own id), updating construction + renderer reads. Pattern for D3–D7: compose with `.and(type({...}))`, spread `readonly` arrays at construction (arktype infers mutable `string[]`), validate golden output via `instanceof type.errors`. Gate: `pnpm build` then typecheck clean, 212 tests, lint:deps clean.
