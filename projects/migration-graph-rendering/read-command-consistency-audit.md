# Read-command consistency audit (TML-2801)

Audits the migration **read** verbs — `status`, `list`, `graph`, `log`, `show`, `check` — for consistency now that the read-command redesign has shipped (`list`/`graph`/`status`/`log` split, dagre retired, ledger foundation). Where the earlier [`cli-audit.md`](../migration-domain-model/cli-audit.md) asked *which verbs should exist and where they live* (the F1–F8 surface-shape gaps, now largely implemented), this audit asks whether the implemented read verbs are **consistent with each other and with the [CLI Style Guide](../../docs/CLI%20Style%20Guide.md)** along the six axes named in the ticket:

1. consistent params (`--to`, `--space`, …)
2. consistent formatting
3. consistent behaviours (e.g. how they handle multiple spaces)
4. consistent naming
5. clear, user-oriented help text
6. clear, user-oriented, structured errors with explicit "why" and "fix"

This document is a state comparison + defect classification. It is not an implementation plan or a sequencing proposal; remediation is tracked as follow-up tickets (see [Remediation](#remediation)).

Out of scope: the control-api ↔ CLI surface reconciliation ([TML-2780](https://linear.app/prisma-company/issue/TML-2780)) — that's the internal API naming, not the user-facing read surface. `migrate` and the authoring verbs (`plan`, `new`) are write verbs and out of scope. `ref list` is read-shaped but lives under a different subject; noted where relevant, not audited here.

## Outcome (re-validation, 2026-06-09)

**Verdict: the redesign largely accomplished its goals.** Of the 7 findings, 4 are fully resolved, 1 is partially addressed, and 2 remain open. The clear Style Guide violations (F3: non-uniform JSON envelopes; F5: inline error construction) are both fixed. The remaining open items are low-effort polish, not correctness problems.

| Finding | Status | Summary |
|---|---|---|
| F1 — Space vocabulary | **Partial** | `check` now has `--space`; `show` still does not; `log`'s unscoped semantics still undocumented in its description |
| F2 — Ref grammar | **Resolved** | Both `show` and `check` now accept paths via `looksLikePath`; grammar is aligned |
| F3 — JSON envelope | **Resolved** | `log` emits `{ ok, records, summary }`; `graph` has a co-located exported schema |
| F4 — Decoration flags | **Partial** | `status` and `log` now have `--ascii`; `show`/`check` still lack both decoration flags |
| F5 — Structured errors | **Resolved** | `check` routes ref errors through `mapRefResolutionError`; `log` uses single `requireLiveDatabase` |
| F6 — Help text | **Open** | `check` see-also still omits `migration show`; `log` missing `--json` example is fixed; remaining gaps listed below |
| F7 — Exit codes | **Resolved** | Exit codes documented in `check`'s long description; no change needed |

**Still-open items** (worth follow-up tickets, not filed here):

- `show` has no `--space` flag and no structured rejection explaining it's app-space-only. Surface signal is still absent.
- `log`'s long description does not explain that it merges across all spaces by design ("unscoped" semantics).
- `check`'s see-also list still omits `migration show` — the one sibling that also takes a positional migration reference.
- `show` and `check` have no `--ascii` or `--legend` flags. Whether these apply to their output format is a design decision that should be documented if the answer is "no".

## Method

1. Enumerated the read verbs from `packages/1-framework/3-tooling/cli/src/commands/migration-*.ts`.
2. For each, read the command builder verbatim: `setCommandDescriptions`, `setCommandExamples`, `setCommandSeeAlso`, the `addGlobalOptions(command).option(...)` chain, the `--json` envelope, the error factories invoked, and DB/driver requirements.
3. Compared the resulting matrix across commands and against the Style Guide.
4. Classified each divergence as a **defect** (fix) or an **intended divergence** (document the rationale). Not every difference is a defect — `log` being unscoped and `check` carrying custom exit codes are deliberate.

All file:line references below were read directly from source at audit time.

## Surface matrix

| Axis | `status` | `list` | `graph` | `log` | `show` | `check` |
|---|---|---|---|---|---|---|
| Live/offline | live (offline w/ `--from`) | offline | offline | live | offline\* | offline |
| `--space` | ✅ | ✅ | ✅ | ❌ (unscoped) | ❌ (app-only) | ✅ |
| `--to` / `--from` | ✅ both | — | — | — | — | — |
| Positional ref | — | — | — | — | `<target>` required | `[target]` optional |
| `--ascii` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `--legend` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `--db` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Ref parser | `parseContractRef` | — | — | — | `parseMigrationRef` (+ path) | `parseMigrationRef` (+ path) |
| `--json` envelope | `{ ok, spaces, summary, diagnostics }` | `{ ok, spaces, summary }` | `{ ok, spaces, summary }` | `{ ok, records, summary }` | `{ ok, migration, summary }` | `{ ok, failures, summary }` |
| Exported JSON schema | ✅ (`migrationStatusJsonResultSchema`) | ✅ (`migrationListResultSchema`) | ✅ (`migrationGraphJsonResultSchema`) | ✅ (`migrationLogResultSchema`) | ✅ (`migrationShowResultSchema`) | ✅ (`migrationCheckResultSchema`) |
| Custom exit codes | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`exit-codes.ts`) |

\* `show` is nominally offline but instantiates a control client (`migration-show.ts:117`) it never connects.

## Findings

### F1. Spatial vocabulary is three different stories (behaviour)

**Original finding.** Three commands accept `--space <id>` (`status`, `list`, `graph`). `log` is deliberately unscoped. `show` and `check` were silently app-space-only — no `--space`, no diagnostic.

**Current state: Partial.** `check` now accepts `--space <id>` (introduced as part of the multi-space check capability: `migration-check.ts:61-64`). `show` still has no `--space` option (`migration-show.ts:47-49`). `log`'s long description still does not explain that it merges across all spaces by design (`migration-log.ts:112-115`).

**Remaining.** `show` is still silently app-only with no surface signal. `log` unscoped semantics are undocumented at the help level. Both warrant follow-up polish.

---

### F2. Two ref grammars, three positional behaviours (params)

**Original finding.** `show` accepted paths; `check` did not. Two adjacent verbs, different accepted grammars.

**Current state: Resolved.** Both `show` and `check` now accept filesystem paths via the shared `looksLikePath` helper. `show` resolves via `resolveAppTargetPath` (`migration-show.ts:172-183`). `check` resolves via `resolveTargetPathAcrossSpaces` / `resolveAppTargetPath` (`migration-check.ts:463-485`). Both use `parseMigrationRef` for non-path refs. Required-vs-optional positional remains intentional (`show` requires a target; `check` without an arg runs the whole-graph check).

---

### F3. `--json` envelope is not uniform (naming)

**Original finding.** `log` emitted a bare array. `graph` had no exported schema. Both violated the Style Guide.

**Current state: Resolved.** `log` now emits `{ ok: true, records: [...], summary: '...' }` and has a co-located exported schema `migrationLogResultSchema` (`schemas.ts:135-141`, used at `migration-log.ts:139-141`). `graph` now has a co-located exported schema `migrationGraphJsonResultSchema` (`schemas.ts:62-68`) and the action uses the typed result directly (`migration-graph.ts:259-263`). All six commands now emit `{ ok, …, summary }` envelopes with exported arktype schemas in `commands/json/schemas.ts`.

---

### F4. Decoration flags (`--ascii`, `--legend`) absent from offline verbs (formatting)

**Original finding.** `--ascii` was absent from `status` and `log`. `show`/`check` had neither decoration flag.

**Current state: Partial.** `status` now has `--ascii` (`migration-status.ts:96`, registered at line 687). `log` now has `--ascii` (`migration-log.ts:42-43`, registered at line 131). `show` and `check` still have no `--ascii` or `--legend`. Whether these flags are applicable to their output is a design decision; if the answer is "no", it should be stated in the long description.

---

### F5. Structured errors are assembled ad hoc, not through one path (errors)

**Original finding.** `check` built ref-resolution errors inline with hand-written strings. `log` used two separate error factories for the missing-DB and missing-driver preconditions while `status` bundled them into one.

**Current state: Resolved.** `check` now routes ref-resolution failures through `mapRefResolutionError` (`migration-check.ts:528`). `log` uses a single `requireLiveDatabase` call bundling both connection and driver checks (`migration-log.ts:54-60`), matching the pattern `status` uses (`migration-status.ts:290-299`). Error envelopes for ref failures are uniform across the command family.

---

### F6. Help-text shape drifts (help text)

**Original finding.** `check` see-also omits `migration show`. Example counts uneven. `show` long description doesn't say "Offline".

**Current state: Open.** `check`'s see-also list still omits `migration show` (`migration-check.ts:601-607`). `show` now says "Offline — does not consult the database" in its long description (`migration-show.ts:225`). `log` now includes a `--json` example (`migration-log.ts:119`). The remaining gap is the missing `check → show` see-also link.

---

### F7. `check` carries custom exit codes and `exitOverride` (exit codes)

**Original finding.** Intended; flagged only to confirm the codes were documented.

**Current state: Resolved.** `check`'s long description now documents the exit codes explicitly: "Exit codes: 0 = all checks passed, 2 = precondition failed … 4 = integrity failure(s) found." (`migration-check.ts:592-593`). No change needed.

---

## Cross-cutting observations

- **The shared infrastructure is good and now better-used.** `runMigrationList` (space validation), `parseContractRef`/`parseMigrationRef` + `looksLikePath` (ref grammar), `mapRefResolutionError` (error envelopes), `validateLegendOptions`, the shared tree renderer — these primitives are now reached consistently. The main remaining gap is `show`'s lack of `--space`.
- **JSON envelopes are now fully uniform.** All six commands have a co-located exported schema in `commands/json/schemas.ts` and emit `{ ok, …, summary }` envelopes.
- **Consistency isn't test-enforced beyond rendering.** [`migration-read-commands-parity.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/migration-read-commands-parity.test.ts) locks *pretty-rendering* parity but nothing about flags, help shape, JSON envelopes, or error shapes. These can re-drift freely. Extending this test to assert the agreed conventions would prevent regression.

## Remediation

Original defects now resolved: F2, F3, F5, F7 (fully); F4 (partial). Remaining open items:

| Ticket | Covers | Effort |
|---|---|---|
| Signal space policy for `show`; document `log` unscoped semantics | F1 remaining | XS |
| Add `migration show` to `check`'s see-also | F6 remaining | XS |
| Decide `show`/`check` decoration flags; document rationale if they don't apply | F4 remaining | XS |
| Extend parity test to lock flags / help / JSON-envelope / error-shape conventions | cross-cutting | M |
