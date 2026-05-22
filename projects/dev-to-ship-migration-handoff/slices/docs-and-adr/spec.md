# Slice: Documentation + ADR for refs-with-paired-snapshots pattern

_Parent project: [`projects/dev-to-ship-migration-handoff/`](../../). This slice satisfies **FR18**, **FR19**, **FR20**, **PDoD10**, **PDoD11**, and **PDoD12** from [the project spec](../../spec.md). It is **Stack 5** from [`../../plan.md`](../../plan.md). It is the project's documentation slice — describes the implemented behaviour from Stacks 1–4 and Parallel A._

## At a glance

Three durable documentation artefacts land:

1. **ADR 218** — `Refs with paired contract snapshots, universal "from must be a graph node" invariant, and asymmetric ref-advancement rules`. Captures the architectural pattern, the invariant, the asymmetry between `db init`/`db update` (implicit `db` default) vs `migrate`/`ref set` (opt-in only), and the auto-baseline emission convention.
2. **Subsystem doc** `docs/architecture docs/subsystems/7. Migration System.md` — new sections covering paired snapshots, the universal invariant, and the `--advance-ref` flag family. Replaces or augments existing `§ Refs` and `§ Helpful commands` content.
3. **Skill updates** — `skills-contrib/prisma-next-migrations/SKILL.md` gets a new "dev → ship transition" section; `skills-contrib/prisma-next-migration-review/SKILL.md` gets a row for the pre-DDL drift error and updated guidance for `MIGRATION.MARKER_NOT_IN_HISTORY` / `MIGRATION.HASH_NOT_IN_GRAPH` / `MIGRATION.MARKER_MISMATCH` / `MIGRATION.PATH_UNREACHABLE` / `MIGRATION.SNAPSHOT_MISSING`.

This is the **discoverability + recoverability layer** for the implemented behaviour. After this slice ships, a developer hitting any of the new refuse paths or running any of the new commands finds clear guidance in the canonical doc locations.

## Scope

### In scope

- **New ADR 218 at `docs/architecture docs/adrs/ADR 218 - Refs with paired contract snapshots and universal from-must-be-a-graph-node invariant.md`** (final filename per ADR conventions; settle at dispatch time).
  - **Context.** The dev → ship transition trap (TML-2629): `db update` followed by `migration plan` produced an unapplyable migration when the graph was empty. Drift between local DB state, on-disk migration graph, and live DB marker had no precise diagnostics.
  - **Decision.** Adopt three coupled architectural choices:
    1. **Refs with paired contract snapshots.** Each on-disk ref `<name>` is stored as a pointer (`<name>.json`) plus its contract snapshot (`<name>.contract.json` + `<name>.contract.d.ts`). All ref writes/deletes go through atomic paired primitives.
    2. **Universal "from must be a graph node" invariant.** Any hash provided as a `from` (explicitly via `--from`, implicitly via the `db` ref default, or any other resolution) must be a node in the migration graph (a hash appearing as `from` or `to` of an on-disk bundle, or the `null` sentinel) — or the operation refuses with a structured diagnostic. The auto-baseline emission is the one well-defined exception, scoped to the empty-graph case.
    3. **Asymmetric ref-advancement.** `db init`/`db update` carry an implicit `--advance-ref db` default when run against the default `--db` URL; `migrate` and `ref set` advance refs only on explicit opt-in. The asymmetry reflects each command's purpose: dev-mode reconciliation (`db update`) is the only command whose meaning is "advance the local marker"; production-shaped commands (`migrate`, `ref set`) are explicit.
  - **Consequences.** Auto-baseline emission, plan-time + apply-time refuse diagnostics, paired snapshot writes from `db init`/`db update`/`migrate --advance-ref`/`ref set`. Discoverable recovery paths (`migration plan --from <reachable>`, `ref set db <marker-hash>`). One-call atomic write semantics throughout.
  - **Alternatives considered.** (a) Implicit `db`-ref advancement on `migrate` — rejected because production commands must be explicit. (b) `migration plan` connecting to the DB to read the marker directly — rejected because the planner must remain offline (NFR3). (c) First-time-only baseline (refuse all subsequent uses of `--from` past graph tip) — rejected because the dev-shaped workflow needs `--from <ref>` to be a common case.
  - **Relation to existing ADRs.** Builds on ADR 197 (migration packages snapshot their own contract) — paired ref snapshots are the same pattern applied to refs. Builds on ADR 199 (storage-only migration identity) — graph-node identity is by `storageHash`. Builds on ADR 198 (runner decoupled from driver via visitor SPIs) — apply-time drift check is at the CLI layer, not the runner.
- **Subsystem doc edits** at `docs/architecture docs/subsystems/7. Migration System.md`:
  - **New § Refs (paired contract snapshots).** On-disk layout, atomic write/delete semantics, the universal invariant. Cross-link to ADR 218.
  - **Augmented § `db init` and § `db update`.** Document the implicit `db` ref + snapshot writes + the `--advance-ref` opt-out (when `--db <non-default-url>` is used). Cross-link to scenario walkthroughs.
  - **Augmented § `migration plan`.** Document the default `from = db ref` resolution, auto-baseline emission, plan-time refuse paths.
  - **Augmented § `migrate`.** Document the `--advance-ref` flag (opt-in only), the pre-DDL drift check, the new `markerMismatch` diagnostic, and the improved `pathUnreachable` payload.
  - **Augmented § Helpful commands.** Add `--advance-ref` listings; document the universal invariant as a cross-cutting constraint.
  - **Augmented § Recovery affordances.** Enumerate the recovery paths the new diagnostics suggest.
- **Skill text updates**:
  - `skills-contrib/prisma-next-migrations/SKILL.md`:
    - New top-level section "Dev → ship transition (the `db` ref pattern)". Explains the `db` ref's role, what `db init` / `db update` write, the auto-baseline two-bundle output when running `migration plan` for the first time after `db update`, the forgot-the-flag pitfall ("if you've been running `db update` for a while and want to publish a real migration, plan from a graph node, not the `db` ref past the graph tip").
    - Cross-link to the new subsystem doc sections + ADR 218.
  - `skills-contrib/prisma-next-migration-review/SKILL.md`:
    - New row(s) in the diagnostic catalog for `MIGRATION.MARKER_MISMATCH` (apply-time drift), `MIGRATION.PATH_UNREACHABLE` (improved payload), `MIGRATION.HASH_NOT_IN_GRAPH` (plan-time + ref-set refuse), `MIGRATION.SNAPSHOT_MISSING` (plan-time refuse).
    - Updated guidance for the existing `MIGRATION.MARKER_NOT_IN_HISTORY` row — note its distinction from `MIGRATION.MARKER_MISMATCH` (the latter fires BEFORE the runner; the former during the runner's graph walk).
- **Cross-link sweep**: any existing skill or doc that mentions `db init`/`db update`/`migration plan`/`migrate`/`ref set` and isn't already cross-linked to the new sections gets a one-line link. Final list compiled at dispatch time via grep.

### Out of scope (this slice)

- **Behavioural changes** of any kind. This slice is documentation-only.
- **Updates to `docs/onboarding/*`.** The onboarding docs describe high-level concepts and don't need changes for this project (the new ref behaviour is in the migration subsystem doc).
- **CHANGELOG updates.** Handled by the release skill at version-bump time.
- **Marketing or external-facing docs.**
- **Documentation translations.**
- **`docs/Architecture Overview.md` updates.** This file describes high-level system organization; the new ref pattern is a subsystem detail. If a reviewer disagrees at dispatch time and the change is one or two sentences, fine; if it's a larger restructure, defer to a follow-up doc-touch.

## Approach

### ADR 218 (Dispatch 1)

Follow the canonical ADR template established by neighboring ADRs (read 215, 197, 198 for shape and tone). Sections:
- **Status** (Accepted).
- **Context** — TML-2629 trap, the three coupled architectural choices, why one ADR rather than three.
- **Decision** — the three choices, each with a "what this means in practice" subsection.
- **Consequences** — positive + negative + neutral.
- **Alternatives** — three rejected alternatives.
- **Relation** — links to ADRs 197, 198, 199.

### Subsystem doc (Dispatch 1)

`docs/architecture docs/subsystems/7. Migration System.md` is the canonical migration subsystem doc. The edits are additive (new sections + augmentation of existing sections); no rewrites of unrelated content. Cross-link to ADR 218 + scenario walkthroughs.

Working position: ADR + subsystem doc ship together (Dispatch 1) because they cross-reference each other. The skill updates (Dispatch 2) can lag if the subsystem doc isn't finalized.

### Skill updates (Dispatch 2)

Both skills are user-facing — the operator reads them when authoring or reviewing migrations. The dev-flow narrative ("how do I move my local schema to production?") is the load-bearing piece in `prisma-next-migrations`; the diagnostic catalog is the load-bearing piece in `prisma-next-migration-review`.

After editing the canonical files at `skills-contrib/`, run `pnpm install` (or `pnpm prepare`) to refresh the symlink trees per the AGENTS.md rule.

### Cross-link sweep (Dispatch 2)

`rg '(?i)(\b(db init|db update|migration plan|migrate|ref set|advance-ref)\b)' docs/ skills-contrib/ -l` enumerates files that mention the affected commands. For each, verify a cross-link to either the new subsystem doc section or ADR 218. The sweep is non-exhaustive (it's a sanity-check, not an audit).

## Edge cases / authoring concerns

| Concern | Disposition | Notes |
|---|---|---|
| ADR filename collision (some ADR numbers have duplicates in the existing tree) | **Verify highest number at dispatch start, use next** | Existing tree shows ADR 217 as the latest unique. Dispatch 1's first action: `ls 'docs/architecture docs/adrs/' | sort -t' ' -k2 -n | tail -5` to confirm. |
| ADR 218 — single ADR vs. three smaller ADRs | **Single ADR (working position)** | Per project plan OQ4 (one ADR). The three architectural choices are tightly coupled; splitting forces cross-ADR references and obscures the project's overall logic. |
| Subsystem doc section ordering — replace existing `§ Refs` or augment | **Augment, preserve existing content where still accurate** | Read the file's current shape at dispatch start; cite the existing `§ Refs` line ranges before editing. |
| Skill text — example flows vs. abstract description | **Both, with examples first** | Each new section opens with a 5-line example flow, then describes the pattern abstractly. Mirrors the existing skill text shape. |
| `markdown-no-artificial-line-wraps` rule | **Honour** | Prose lines wrap naturally; tables and code blocks unchanged. |
| `avoid-cleavage-in-prose` rule | **Honour** | Audit final prose; use "split" / "boundary" / "distinction" instead. |
| `doc-maintenance` rule — no transient project artefacts in docs | **Honour** | The grep gate at slice close (`rg 'projects/dev-to-ship-migration-handoff' docs/ skills-contrib/`) returns zero matches. Reference ADR 218 + Linear ticket TML-2629 (stable references), not the project directory. |
| `namespace-diagnostic-wording` rule | **Honour** | N/A for this slice (no PSL namespace work). |
| Code examples in docs — full vs. abbreviated | **Abbreviated, with cross-link to source** | Avoid copy-pasting more than ~8 lines of code; cross-link to the source file with `code-references` syntax instead. |
| Manual-QA roll-up (project PDoD2) | **Slice close-out, not this slice** | This slice doesn't add manual-QA scripts. The project close-out aggregates per-slice scripts. |
| `pnpm install` after skill edits — required? | **Required for symlink refresh** | Per AGENTS.md "Where skills and rules live" — the `prepare` script materializes the symlink trees. Verify by running `pnpm install` after skill edits + checking that the `.claude/skills/` and `.agents/skills/` symlinks resolve to the canonical paths. |

## Slice Definition of Done

- [ ] **SDoD1.** Validation gates pass: `pnpm typecheck` (should be unaffected by doc edits), `pnpm lint:deps` (should be unaffected), `pnpm fixtures:check` (should be unaffected). Doc-specific gates: markdown linter clean if one runs in CI.
- [ ] **SDoD2.** Every artefact landed: ADR 218 + subsystem doc sections + both skill updates + cross-link sweep complete.
- [ ] **SDoD3.** Reviewer SATISFIED on `projects/dev-to-ship-migration-handoff/reviews/code-review.md`. **Doc-review focus**: clarity, accuracy vs. implemented behaviour, no transient project references, prose quality.
- [ ] **SDoD4.** No manual-QA — documentation-only slice; the test of the docs is "does a fresh reader understand the new pattern from the canonical artefacts alone?"
- [ ] **SDoD5.** No edits to source code (`packages/`), test fixtures, or other non-documentation surfaces.
- [ ] **SDoD6.** No breakage of existing docs — cross-link sweep doesn't break existing links.
- [ ] **SDoD7.** Skill symlinks refreshed via `pnpm install` if the skill text edits include any frontmatter changes.

## Open Questions

1. **ADR number.** Working position: 218. Verify at dispatch start.
2. **ADR filename style.** Long descriptive name vs. short slug. Existing tree shows long names (e.g., `ADR 217 - CLI telemetry runs in a detached subprocess spawned at command start.md`). Match that style.
3. **One ADR vs three.** Project plan OQ4 settled on one. Reaffirm at dispatch start; if reviewer raises a "this should be three ADRs" concern, hold per the project decision.
4. **Augment subsystem doc vs. write a new one.** The existing `7. Migration System.md` is the canonical home; augment it.
5. **Onboarding doc updates.** Working position: skip (the new ref pattern is a subsystem detail, not an onboarding concept). Re-evaluate at slice close.
6. **Sizing: 2, 3, or 4 dispatches.** Working position: 2 (ADR + subsystem doc together; skill updates + cross-link sweep separately). If a dispatch sizes to L, re-split.

## References

- Parent project: [`projects/dev-to-ship-migration-handoff/spec.md`](../../spec.md) §§ FR18, FR19, FR20, PDoD10, PDoD11, PDoD12
- Project plan: [`projects/dev-to-ship-migration-handoff/plan.md`](../../plan.md) § Stack 5
- Design notes: [`projects/dev-to-ship-migration-handoff/design-notes.md`](../../design-notes.md) — synthesis of the design discussion
- Scenarios: [`projects/dev-to-ship-migration-handoff/scenarios.md`](../../scenarios.md) — six worked walkthroughs
- CLI surface delta: [`projects/dev-to-ship-migration-handoff/cli-surface.md`](../../cli-surface.md)
- Existing subsystem doc: [`docs/architecture docs/subsystems/7. Migration System.md`](../../../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- Related ADRs:
  - ADR 197 — Migration packages snapshot their own contract
  - ADR 198 — Runner decoupled from driver via visitor SPIs
  - ADR 199 — Storage-only migration identity
- Skills:
  - `skills-contrib/prisma-next-migrations/SKILL.md`
  - `skills-contrib/prisma-next-migration-review/SKILL.md`
- Linear issue: _not created (operator declined Linear sync)_
