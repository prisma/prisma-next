# Slice plan: Documentation + ADR for refs-with-paired-snapshots pattern

**Spec:** [`./spec.md`](./spec.md)
**Parent project:** [`projects/dev-to-ship-migration-handoff/`](../../)
**Parent plan position:** Stack 5 (see [project plan](../../plan.md))

## Validation gate

```bash
pnpm typecheck                                                # should be unaffected by doc edits
pnpm lint:deps                                                # should be unaffected
pnpm fixtures:check                                           # should be unaffected
pnpm install                                                  # if skill text edits include frontmatter changes (refreshes symlinks)
```

### Grep gates

```bash
rg 'projects/dev-to-ship-migration-handoff' docs/ skills-contrib/ 2>/dev/null      # zero matches — no transient project references in durable docs
rg 'cleavage' docs/ skills-contrib/ 2>/dev/null                                     # zero matches — avoid-cleavage-in-prose rule
rg -i '\b(Project [12]|\bD[1-9]\b|\bAC-[A-Z]|\bR[0-9]+B?\b)' docs/ skills-contrib/ 2>/dev/null   # zero matches per doc-maintenance rule
```

## Dispatch plan

### Dispatch 1: ADR 218 + subsystem doc augmentation

**Intent.** Land the architectural decision record + the subsystem doc updates. These two artefacts cross-reference each other and ship together.

**Files in play.**

- New: `docs/architecture docs/adrs/ADR 218 - <descriptive name>.md` (final name per spec § Edge cases > ADR filename).
- Modified: `docs/architecture docs/subsystems/7. Migration System.md`:
  - New § Refs (paired contract snapshots).
  - Augmented § `db init` / § `db update` / § `migration plan` / § `migrate`.
  - New § Recovery affordances (or augmentation of existing recovery section).
  - New § Helpful commands listings for `--advance-ref`.

**"Done when":**

- [ ] ADR 218 follows the established template (read 215, 197, 198 first; mirror the section structure + tone).
- [ ] Subsystem doc edits are additive (preserve existing content where still accurate).
- [ ] Both artefacts cross-link to each other + to the related ADRs (197, 198, 199).
- [ ] Code examples in the subsystem doc abbreviated; cross-links to source.
- [ ] `pnpm fixtures:check` + `pnpm lint:deps` + `pnpm typecheck` clean (should be unaffected by doc edits).
- [ ] Grep gates from § Grep gates: zero matches.
- [ ] **Intent-validation:** No source code edits; no skill edits (D2 territory).

**Failure modes to avoid:**

- **F3 (reconnaissance):**
  - `ls 'docs/architecture docs/adrs/'` — confirm the ADR numbering scheme and pick the next available number.
  - Read ADR 197 + 198 + 215 in full before authoring ADR 218 — match the section structure, tone, and depth.
  - Read the existing `docs/architecture docs/subsystems/7. Migration System.md` in full before editing — cite the current section structure and find the right augmentation points.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- Skill edits (D2).
- Cross-link sweep across non-canonical doc files (D2).
- `docs/onboarding/` edits (out of slice scope).

**Size.** M. The ADR is the load-bearing artefact; the subsystem doc edits are additive but spread across multiple sections.

**Tier.** `claude-opus-4-7-thinking-high` for the ADR (architectural writing benefits from the thinking tier); `composer-2.5-fast` could handle the subsystem doc augmentation but the cross-reference work + reading-then-augmenting calls for the higher tier. Recommend `claude-opus-4-7-thinking-high` for the whole dispatch given the cross-artefact coherence requirement.

**DoR confirmed:** [✓]

---

### Dispatch 2: Skill updates + cross-link sweep

**Intent.** Author the new sections in both user-facing skills + run the cross-link sweep across `docs/` and `skills-contrib/` to ensure the new behaviour is discoverable from canonical mention sites.

**Files in play.**

- Modified: `skills-contrib/prisma-next-migrations/SKILL.md` — new "Dev → ship transition" section + cross-links to Dispatch 1's artefacts.
- Modified: `skills-contrib/prisma-next-migration-review/SKILL.md` — new diagnostic catalog rows.
- Modified: any non-canonical doc files surfaced by the cross-link sweep (one-line cross-links added).
- Possibly modified: `pnpm-lock.yaml` and node_modules — if skill frontmatter changes trigger the `prepare` script's symlink regeneration via `pnpm install`. Verify symlinks resolve.

**"Done when":**

- [ ] Both skill files have the new sections per spec § Scope.
- [ ] Cross-link sweep complete: `rg '(?i)(\b(db init|db update|migration plan|migrate|ref set|advance-ref)\b)' docs/ skills-contrib/ -l` enumerated; each file verified to cross-link to either the subsystem doc or ADR 218 where appropriate.
- [ ] After skill edits, `pnpm install` (or equivalent) ran and the `.claude/skills/` + `.agents/skills/` symlinks resolve correctly.
- [ ] `pnpm fixtures:check` + `pnpm lint:deps` + `pnpm typecheck` clean.
- [ ] Grep gates from § Grep gates: zero matches.
- [ ] Skill frontmatter (if modified) passes the `lint:skills` check that landed in `97d48ca72`.
- [ ] **Intent-validation:** No source code edits; no ADR or subsystem doc edits (D1 territory).

**Failure modes to avoid:**

- **F3:**
  - Read both existing skill files in full before editing — match the existing structure, examples-first pattern.
  - Run `rg -l '(?i)(db init|db update|migration plan|migrate.*ref|ref set)' docs/ skills-contrib/` to enumerate the cross-link sweep targets.
- **F4** — WIP inspection if dispatch sprawls past ~30 min.

**Out of scope (this dispatch):**

- ADR or subsystem doc edits (D1 territory).
- `docs/onboarding/` updates (out of slice scope).

**Size.** S–M. The skill updates are focused; the cross-link sweep is mechanical.

**Tier.** `composer-2.5-fast`. The skill edits are pattern-following (read existing structure, add new sections in the same style); the sweep is grep-driven.

**DoR confirmed:** [✓]

---

## Dispatch sequence

```
Dispatch 1 (M, ADR 218 + subsystem doc — claude-opus-4-7-thinking-high)
       ↓ (D2 reads D1's landed artefacts to cross-link)
Dispatch 2 (S-M, skill updates + cross-link sweep — composer-2.5-fast)
```

Sequential. D2 needs D1's landed artefacts to cross-link to.

## Slice-DoD coverage map

| Slice-DoD | Delivered by |
|---|---|
| **SDoD1.** Validation gates pass | Each dispatch |
| **SDoD2.** All artefacts landed | D1 (ADR + subsystem) + D2 (skills + sweep) |
| **SDoD3.** Reviewer SATISFIED | Per drive-build-workflow |
| **SDoD4.** No manual-QA (docs-only) | Definitional |
| **SDoD5.** No source code edits | Each dispatch's intent-validation |
| **SDoD6.** No existing-doc breakage | Cross-link sweep + reviewer pass |
| **SDoD7.** Skill symlinks refreshed | D2 closes with `pnpm install` |

## Risks (slice-level)

1. **ADR scope creep.** The architectural pattern is rich. The ADR must stay tightly focused on the three coupled decisions (paired snapshots, universal invariant, asymmetric advancement) without diving into per-command minutiae. Mitigation: the per-command detail lives in the subsystem doc; the ADR explains *why* the pattern exists.
2. **Subsystem doc augmentation vs rewrite.** Hard to know without reading the file's current shape whether augmentation is clean or a small rewrite is warranted. Working position: augment; revisit at D1 reconnaissance.
3. **Skill text length.** Both skills are user-facing; verbosity in the migration skill is acceptable, but the review skill should stay focused on the diagnostic catalog. Mitigation: keep new sections under ~80 lines each.
4. **Cross-link sweep false positives.** Some mentions of "migrate" or "db init" in the codebase are unrelated (e.g., test fixtures, deprecated docs). Sweep is a sanity check, not an audit — only add cross-links where they're genuinely useful for the reader.
