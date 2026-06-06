# Dispatch plan — read-command consistency

Seven sequential dispatches. They touch overlapping sibling files (`check` appears in 2, 3, 6; `status` in 2, 4; `log` in 1, 2, 4), so order matters to avoid re-touching the same command twice for different reasons: settle each command's wiring before the spine lands on it. Each dispatch writes its targeted tests **before** implementation (repo rule). Dispatch 7 is the DoD lock and builds on the cumulative end state of 1–6, not just 6.

**Escape hatch (spine, dispatch 6):** if `check` multi-space proves gnarlier than `aggregate.spaces()` makes it look (cross-space ref semantics needing design), cut **only** dispatch 6 to a sibling slice and drop its assertions from dispatch 7; dispatches 1–5 + the rest of 7 still ship as a complete consistency PR.

### Dispatch 1: Unify `--json` envelopes + export schemas (F3)

- **Outcome:** All six read verbs emit a `{ ok, … }` object with a co-located **exported** output type. `log` returns `{ ok: true, entries: [...] }` (no longer a bare array); `graph`'s inline `{ ok, nodes, edges, summary }` is lifted to an exported type like its peers. In-repo JSON snapshots/golden tests updated to the new shapes.
- **Builds on:** The spec's chosen design.
- **Hands to:** A uniform, exported JSON envelope across all six verbs — the shape dispatch 7 asserts.
- **Focus:** `migration-log.ts`, `migration-graph.ts`, their output-type modules, affected JSON golden tests. Not the human-output paths.

### Dispatch 2: Unify the error path (F5)

- **Outcome:** `check` resolves ref errors through the shared `mapRefResolutionError` (no inline string construction at `migration-check.ts:173–184`). A single shared "needs a live DB (connection + driver)" precondition helper is extracted and called by both `log` and `status`, producing one identical envelope (with `meta.missingFlags`) for that precondition.
- **Builds on:** Dispatch 1's settled JSON envelope (error docs share the `ok` discriminator).
- **Hands to:** One error-construction path for ref-resolution and missing-DB across the family — `check` no longer special-cased.
- **Focus:** `migration-check.ts`, `migration-log.ts`, `migration-status.ts`, the shared cli-errors/precondition helpers. Not the multi-space loops (dispatch 6).

### Dispatch 3: Align `show`/`check` path grammar (F2)

- **Outcome:** `check` accepts a filesystem path to a migration directory via the **same** helper `show` already uses (`looksLikePath` + path resolution); both verbs' positional help text describes the identical accepted forms (dir name / hash / ref / path). `check`'s no-arg whole-graph mode is unchanged.
- **Builds on:** Dispatch 2's `check` state (error path already routed through the shared factory).
- **Hands to:** `show` and `check` share one ref-resolution grammar and one path helper.
- **Focus:** `migration-check.ts`, the shared path helper currently private to `migration-show.ts` (promote/share it). Not `show`'s behaviour (already correct).

### Dispatch 4: `--ascii` where a laned tree / table is drawn (F4)

- **Outcome:** `status` exposes `--ascii` and threads `options.ascii === true` (the hardcoded `ui.resolveGlyphMode(false)` at `migration-status.ts:377,452` is gone); `log`'s table (`migration-log-table.ts`) honours `--ascii`. `show` and `check` are unchanged (no laned-tree glyphs).
- **Builds on:** The spec's chosen design (independent of 1–3).
- **Hands to:** Every verb that draws box-drawing glyphs can be forced to ASCII, matching `list`/`graph`.
- **Focus:** `migration-status.ts`, `migration-log.ts`, `migration-log-table.ts`, `resolveGlyphMode` wiring. Not `show`/`check`.

### Dispatch 5: Help-text polish (F6)

- **Outcome:** `check`'s see-also includes `migration show`; every JSON-emitting verb has a `--json` example (notably `show`); long descriptions state offline/live consistently across all six.
- **Builds on:** The spec's chosen design (independent; pure metadata edits).
- **Hands to:** A symmetric see-also graph + uniform help phrasing — the help conventions dispatch 7 asserts.
- **Focus:** The `setCommandDescriptions` / `setCommandExamples` / `setCommandSeeAlso` calls in the six command files. No behaviour change.

### Dispatch 6 (SPINE): `check` multi-space (F1)

- **Outcome:** `check`'s file-existence, reachability, and dangling-ref checks run **per contract space** (all spaces by default), and `check` accepts `--space <id>` to narrow — same policy as `list`/`graph`/`status`, reusing `aggregate.spaces()` and the `isValidSpaceId` / space-filter validation from `@prisma-next/migration-tools/spaces` (same `errorInvalidSpaceId` / `errorSpaceNotFound` factories `list` uses). Fixtures include a multi-space case so newly-surfaced non-app failures are intentional.
- **Builds on:** Dispatch 2 (`check` error path) + dispatch 3 (`check` path grammar) — lands on a `check` whose wiring is already settled.
- **Hands to:** `check` validates every space; `--space` narrows. `show` stays single-migration; `log` stays unscoped (documented in dispatch 5's phrasing pass).
- **Focus:** `migration-check.ts` check loops + `--space` option, multi-space fixtures. The custom exit codes (F7) are unchanged — confirm they're documented in `--help`.

### Dispatch 7: Extend the parity test (DoD lock)

- **Outcome:** `test/commands/migration-read-commands-parity.test.ts` (today: rendering parity only) asserts across all six verbs: `{ ok, … }` JSON envelope shape; symmetric see-also graph; the shared missing-DB error shape; `check`'s multi-space behaviour. A regression reintroducing any F1–F6 defect fails this test.
- **Builds on:** The cumulative end state of dispatches 1–6 (non-linear: asserts all of them, not just dispatch 6).
- **Hands to:** Slice-DoD met — consistency is test-locked.
- **Focus:** The parity test file (+ any shared test helpers). No production-code change; if an assertion fails, the defect is in the corresponding earlier dispatch's surface.
