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
| `--space` | ✅ | ✅ | ✅ | ❌ (unscoped) | ❌ (app-only) | ❌ (app-only) |
| `--to` / `--from` | ✅ both | — | — | — | — | — |
| Positional ref | — | — | — | — | `<target>` required | `[migration]` optional |
| `--ascii` | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `--legend` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `--db` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Ref parser | `parseContractRef` | — | — | — | `parseMigrationRef` | `parseMigrationRef` |
| `--json` envelope | `{ ok, … }` | `{ ok, … }` | inline `{ ok, … }`, no schema | **bare array** | `{ ok, … }` | `{ ok, … }` |
| Exported JSON schema | type only | type only | ❌ | ❌ | type only | type only |
| Custom exit codes | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`exit-codes.ts`) |

\* `show` is nominally offline but instantiates a control client (`migration-show.ts:156`) it never connects.

## Findings

### F1. Spatial vocabulary is three different stories (behaviour)

**Current.** Three commands accept `--space <id>` with all-spaces-by-default + narrow-to-one (`migration-status.ts:652`, `migration-list.ts:303`, `migration-graph.ts:211`, validated centrally in `runMigrationList`). `log` is deliberately unscoped (merges every space's ledger in apply order). `show` and `check` are silently app-space-only — no `--space`, no diagnostic, the word "app-space" buried in the long description (`migration-show.ts:262`, `migration-check.ts:278`).

**Why it matters.** The ticket calls out "how they handle multiple spaces" as a first-class consistency axis. A user who learns `--space app` from `list` reasonably expects it on `show`/`check`; today it's silently absent. The all-spaces-vs-app-only split is real (per-migration `show`/`check` operate on one package), but it's undocumented at the surface.

**Classification.** `log` unscoped = **intended** (document it). `show`/`check` app-only = **defect of signalling**, not of behaviour: either accept `--space <id>` (defaulting to app) or reject a passed `--space` with a structured error that says app-only and why.

**Fix.** Decide the policy for per-migration verbs and make it explicit at the surface (flag or structured rejection). Document `log`'s unscoped semantics in its long description.

### F2. Two ref grammars, three positional behaviours (params)

**Current.** `status` resolves `--to`/`--from` via `parseContractRef` — the full reference grammar (hash, prefix, ref name, migration dir name, `<dir>^`, `./path`), as advertised in its option help (`migration-status.ts:653-660`). `show` and `check` take a positional and resolve via `parseMigrationRef` — narrower. `show` accepts a filesystem path (`migration-show.ts:276`); `check` does **not** (`migration-check.ts:295`, help text "directory name or hash"). `show`'s target is required; `check`'s is optional (no-arg = whole-graph check).

**Why it matters.** "Consistent params" and "consistent naming." The same conceptual input — *name a migration* — has three different accepted grammars across two adjacent verbs, and only `status` honours the rich contract-reference grammar the [`cli-audit.md`](../migration-domain-model/cli-audit.md) F5 resolution settled on.

**Classification.** Required-vs-optional positional = **intended** (`check` with no arg is a distinct, useful mode). Path-accepted-by-`show`-but-not-`check` = **defect** (arbitrary). Whether `show`/`check` should accept the *contract* grammar (ref names) is a **design question**, not an obvious defect — they resolve a migration package, not a contract.

**Fix.** Align `show` and `check` on one `parseMigrationRef` grammar (decide path in/out, apply to both). Make the help text for both describe the *same* accepted forms.

### F3. `--json` envelope is not uniform (naming)

**Current.** `status`, `list`, `show`, `check` emit a `{ ok, … }` object. **`log` emits a bare array** (`migration-log.ts:134`). **`graph` builds its envelope inline** in the action with no co-located, exported schema (`migration-graph.ts` action constructs `{ ok, nodes, edges, summary }` by hand). The primary-payload field name varies with no rule: `spaces` (status/list), `migration` (show), `failures` (check), top-level `nodes`/`edges` (graph).

**Why it matters.** Style Guide §JSON Semantics: "Each command's `--json` success shape MUST be defined as a schema (arktype or equivalent) co-located with the command … and exported on the package's public surface." Success/error docs "SHOULD share a discriminator field (typically `ok: boolean`)." `log`'s bare array has no `ok` discriminator and can't carry an error in the same shape; `graph` has no exported schema at all. Both violate the guide.

**Classification.** **Defect** — direct Style-Guide non-conformance, and the most mechanically fixable.

**Fix.** Wrap `log` in `{ ok: true, entries: [...] }`. Give `graph` a co-located exported output schema like its peers. Audit field-naming for a shared convention.

### F4. Decoration flags (`--ascii`, `--legend`) absent from offline verbs that could use them (formatting)

**Current.** `--ascii` and `--legend` appear on `list` and `graph`; `--legend` also on `status`; `--ascii` is **not** on `status` (`migration-status.ts:649-661`) even though status renders the same shared tree. `show` and `check` (both offline, both human-rendered) have neither.

**Why it matters.** `status` draws the shared tree (the parity test locks list/graph/status rendering byte-for-byte) yet can't force ASCII glyphs the way list/graph can — a pipe-to-file user gets inconsistent control depending on which read verb they reach for.

**Classification.** `status` missing `--ascii` = **likely defect** (same renderer, asymmetric control). `show`/`check` missing `--legend`/`--ascii` = **judgement call** — their output isn't the laned tree, so a legend may not apply; confirm and document.

**Fix.** Add `--ascii` to `status`. Decide `show`/`check` deliberately and note the decision.

### F5. Structured errors are assembled ad hoc, not through one path (errors)

**Current.** Ref-resolution errors go through the shared `mapRefResolutionError` in `status` (`migration-status.ts:330,342`) and `show` (`migration-show.ts:235`) — but `check` builds them **inline** with hand-written strings (`migration-check.ts`, around the `parseMigrationRef` call), so its envelope and `meta` diverge from its peers. DB-requirement signalling differs too: `log` raises `errorDatabaseConnectionRequired` then a separate `errorDriverRequired` (`migration-log.ts:51,59`), while `status` bundles connection+driver into a single `errorDatabaseConnectionRequired` condition (`migration-status.ts:274`).

**Why it matters.** Style Guide §Errors mandates a uniform why/fix/where layout, a PN code, and (for missing-input failures) `meta.missingFlags`. Inline error construction in `check` bypasses the shared factory and risks drift in exactly the why/fix wording the ticket asks to standardise.

**Classification.** `check` inline ref errors = **defect** (route through `mapRefResolutionError`). `log` vs `status` driver-vs-connection split = **defect of consistency** — same precondition, two different decompositions and two different messages; pick one.

**Fix.** Route `check`'s ref errors through `mapRefResolutionError`. Unify the missing-DB/missing-driver precondition into one shared check used by both `log` and `status`.

### F6. Help-text shape drifts (help text)

**Current.** See-also lists are near-uniform (each links its four siblings) **except `check`, which omits `migration show`** (`migration-check.ts:288-292`) — the one sibling that, like check, takes a positional migration reference. Example counts swing with no rule: `graph` 6, `list` 5, `status` 4, `log`/`check` 3, `show` 2 (`show` has no `--json` example despite emitting JSON). Long-description phrasing is inconsistent: list/graph/check explicitly say "Offline — does not consult the database"; `show` (also offline) doesn't.

**Why it matters.** "Clear, user-oriented help text" and discoverability. The see-also graph should be symmetric for a coherent verb family; the missing `check → show` edge is a real navigation hole.

**Classification.** **Defect** (low effort, high polish).

**Fix.** Add `migration show` to `check`'s see-also. Give every command a `--json` example where it emits JSON. State offline/live consistently in every long description. Consider a soft norm of 3–4 examples covering the command's distinguishing flags.

### F7. `check` carries custom exit codes and `exitOverride` (exit codes)

**Current.** `check` calls `command.exitOverride()` (`migration-check.ts:293`) and returns `OK`/`PRECONDITION`/`INTEGRITY_FAILED` from a co-located `migration-check/exit-codes.ts`; every other read verb uses the framework's default `handleResult` 0/1/2 semantics.

**Why it matters / classification.** **Intended, and correct** per Style Guide §Exit Codes (a verify verb legitimately defines command-specific outcome codes in a co-located, exported module). Flagged only so the audit's "find the odd one out" doesn't misread it as drift. No fix — but confirm the codes are documented in `--help`/README per the guide's requirement.

## Cross-cutting observations

- **The shared infrastructure is good and underused.** `runMigrationList` (space validation), `parseContractRef`/`parseMigrationRef` (ref grammar), `mapRefResolutionError` (error envelopes), `validateLegendOptions`, the shared tree renderer — the consistency primitives exist. Most defects are commands *not* reaching for the shared path (`check`'s inline errors, `graph`'s inline JSON, `status` missing `--ascii`), not missing infrastructure.
- **Consistency isn't test-enforced beyond rendering.** [`migration-read-commands-parity.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/migration-read-commands-parity.test.ts) locks *pretty-rendering* parity (byte-identical per-space sections) but nothing about flags, help shape, JSON envelopes, or error shapes. These can re-drift freely. Extending this test (or a sibling) to assert the agreed conventions would prevent regression.
- **The Style Guide is the right yardstick and is mostly honoured.** The clear violations are F3 (JSON schema/envelope) and parts of F5 (error uniformity); the rest are intra-family asymmetries the guide doesn't speak to directly.

## Remediation

Audit-only deliverable; fixes ship as follow-up tickets under the **Migration read-command redesign** project. Proposed clusters:

| Ticket | Covers | Effort |
|---|---|---|
| Unify `--json` envelopes + export schemas | F3 (`log` bare array → `{ ok, … }`; `graph` co-located exported schema; field-name convention) | S |
| Align `show`/`check` ref grammar + positional help | F2 (one `parseMigrationRef` grammar; decide path in/out; matching help text) | S |
| Route `check` errors through `mapRefResolutionError`; unify missing-DB/driver precondition | F5 | S |
| Help-text polish across the family | F6 (`check`→`show` see-also; `--json` examples; offline/live phrasing) | XS |
| Decide + signal space policy for per-migration verbs; document `log` unscoped | F1 | S |
| Add `--ascii` to `status`; decide `show`/`check` decoration flags | F4 | XS |
| Extend parity test to lock flags / help / JSON-envelope / error-shape conventions | cross-cutting | M |

`check`'s exit codes (F7) need no change beyond confirming they're documented.
