# Read-command consistency — follow-up tickets (TML-2801)

Draft tickets remediating the findings in [`read-command-consistency-audit.md`](./read-command-consistency-audit.md). Each is sized as one PR, consistent with this project's "independent PRs off a merged foundation" cadence. Copy into Linear under the **Migration read-command redesign** project (Terminal team) as needed; granularity is yours — they can be filed 1:1 or grouped (a sensible grouping is noted at the end).

All paths are under `packages/1-framework/3-tooling/cli/`.

---

## 1. Unify `--json` envelopes and export per-command output schemas

**Findings:** F3 · **Effort:** S · **User-facing:** yes (JSON consumers)

**Why.** Style Guide §JSON Semantics requires each command's `--json` success shape to be a co-located, exported schema, and success/error docs to share an `ok` discriminator. `migration log` emits a **bare array** (`src/commands/migration-log.ts:134`) — no `ok`, no room for an error in the same shape. `migration graph` builds `{ ok, nodes, edges, summary }` **inline** in its action with no exported schema.

**Scope.**
- Wrap `log` output as `{ ok: true, entries: [...] }` (name TBD); update `serializeLedgerEntriesForJson` callers and any snapshot tests.
- Give `graph` a co-located exported output type/schema like its peers (`status`, `list`, `show`, `check` already export theirs).
- Sweep the primary-payload field names for a shared convention (`spaces` / `entries` / `migration` / `failures` / `nodes`+`edges`) and document the rule.

**Acceptance.** Every read verb's `--json` is `{ ok, … }` with an exported schema; `log` JSON validates against it; a test asserts the envelope shape across all six.

---

## 2. Align `show` / `check` migration-ref grammar and positional help

**Findings:** F2 · **Effort:** S · **User-facing:** yes

**Why.** `show` (`src/commands/migration-show.ts:276`) accepts a filesystem path; `check` (`src/commands/migration-check.ts:295`) does not, though both resolve a migration package via `parseMigrationRef`. The accepted forms differ arbitrarily and the help text describes different grammars.

**Scope.**
- Decide one grammar for per-migration verbs (path in or out) and apply to both.
- Make both commands' positional help describe the identical accepted forms.
- Keep the deliberate required-(`show`)-vs-optional-(`check`, no-arg = whole-graph) distinction.

**Open design Q (resolve in ticket, not assumed a defect):** should `show`/`check` accept the *contract* reference grammar (ref names, `<dir>^`) the way `status --to` does? They resolve a package, not a contract — likely no, but state the decision.

**Acceptance.** `show` and `check` accept the same migration-ref forms; help text matches; tests cover the path decision both ways.

---

## 3. Route `check` errors through the shared factory; unify the missing-DB precondition

**Findings:** F5 · **Effort:** S · **User-facing:** yes (error wording)

**Why.** `check` constructs ref-resolution errors inline with hand-written strings instead of `mapRefResolutionError` (used by `status` at `src/commands/migration-status.ts:330,342` and `show` at `src/commands/migration-show.ts:235`), so its envelope and `meta` drift. Separately, `log` raises `errorDatabaseConnectionRequired` then a distinct `errorDriverRequired` (`src/commands/migration-log.ts:51,59`) while `status` folds both into one `errorDatabaseConnectionRequired` condition (`src/commands/migration-status.ts:274`) — same precondition, two decompositions, two messages.

**Scope.**
- Route `check`'s ref errors through `mapRefResolutionError`.
- Extract one shared "needs a live DB (connection + driver)" precondition check and use it in both `log` and `status`; settle on a single message and PN-code treatment.
- Confirm missing-input failures set `meta.missingFlags` per Style Guide §Errors.

**Acceptance.** Identical why/fix/PN-code envelope for the same precondition across `log`/`status`; `check` ref errors match `show`/`status`; a test asserts the shared shape.

---

## 4. Help-text polish across the read-verb family

**Findings:** F6 · **Effort:** XS · **User-facing:** yes (help/discoverability)

**Why.** `check`'s see-also omits `migration show` (`src/commands/migration-check.ts:288-292`) — the one sibling that also takes a positional migration ref. `show` has no `--json` example despite emitting JSON. Long descriptions state "Offline — does not consult the database" on list/graph/check but not on `show` (also offline).

**Scope.**
- Add `migration show` to `check`'s see-also.
- Add a `--json` example to every command that emits JSON (notably `show`).
- State offline/live consistently in every long description.
- Adopt a soft norm of 3–4 examples covering each command's distinguishing flags.

**Acceptance.** See-also graph is symmetric across the family; every JSON-emitting verb has a `--json` example; offline/live phrasing is uniform.

---

## 5. Decide and signal the space policy for per-migration verbs; document `log` as unscoped

**Findings:** F1 · **Effort:** S · **User-facing:** yes

**Why.** `status`/`list`/`graph` take `--space` (all-by-default, narrow-to-one). `show`/`check` are silently app-only — no flag, no diagnostic, only the word "app-space" in the long description. `log` is intentionally unscoped but doesn't say so.

**Scope.**
- For `show`/`check`: either accept `--space <id>` (default app) or reject a passed `--space` with a structured error stating app-only and why.
- Document `log`'s unscoped (all-spaces-merged) semantics in its long description.

**Acceptance.** Passing `--space` to a per-migration verb produces a deliberate, documented result (handled or cleanly rejected); `log`'s scope is stated in `--help`.

---

## 6. Add `--ascii` to `status`; decide decoration flags for `show` / `check`

**Findings:** F4 · **Effort:** XS · **User-facing:** yes

**Why.** `status` draws the same shared laned tree as `list`/`graph` (the parity test locks them byte-for-byte) but lacks `--ascii` (`src/commands/migration-status.ts:649-661`), so glyph control is asymmetric across verbs that share a renderer.

**Scope.**
- Add `--ascii` to `status` (wire to the same `resolveGlyphMode` path).
- Decide deliberately whether `show`/`check` warrant `--legend`/`--ascii` (their output isn't the laned tree) and note the decision in the audit doc.

**Acceptance.** `status --ascii` forces ASCII glyphs identically to `list`/`graph`; `show`/`check` decoration decision recorded.

---

## 7. Extend the read-command parity test to lock the conventions

**Findings:** cross-cutting · **Effort:** M · **User-facing:** no

**Why.** [`test/commands/migration-read-commands-parity.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/migration-read-commands-parity.test.ts) currently locks only *pretty-rendering* parity. Flags, help shape, JSON envelopes, and error shapes can re-drift with no test catching it.

**Scope.** Add assertions (in the parity test or a sibling) covering, across all six read verbs: `{ ok, … }` JSON envelope + exported schema presence; symmetric see-also graph; uniform offline/live phrasing; shared missing-DB error shape. Land **after** tickets 1–6 so it encodes the agreed end state.

**Acceptance.** A regression that reintroduces any F1–F6 defect fails this test.

---

## Notes

- **F7 (custom exit codes on `check`)** needs no fix — it's Style-Guide-correct. One-line task: confirm the codes are documented in `check --help`/README.
- **Suggested grouping** if you prefer fewer tickets: **(A)** = #1 (JSON); **(B)** = #2 + #3 + #4 (ref grammar, errors, help — all touch the per-migration verbs and shared factories); **(C)** = #5 + #6 (space + decoration policy); **(D)** = #7 (parity lock, last).
- **Sequencing:** #7 lands last; the rest are independent and parallelisable.
