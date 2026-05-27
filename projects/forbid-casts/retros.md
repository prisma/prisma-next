# Forbid-casts — retros

## 2026-05-27 — mandatory-final retro at project close

**Trigger:** mandatory final retro per invariant I10 (project close).

### What went well

- **Discussion mode settled a maximalist design without thrashing.** The discussion converged in one session on: forbid all `as` except `as const`, two helpers (`blindCast` + `castAs`), compare-to-merge-base ratchet (no baseline file), test-code exempt, agent rules + skill for "convert when you touch." Each load-bearing decision was forced by a concrete operator pushback ("why does `satisfies` appear in your carve-out list?", "is there a reason we can't just compare to the count on main?", "this should not apply to test code"). The discussion's job was to surface those pushbacks; it did.
- **The A1–A5 assumption block earned its cost.** Two assumptions falsified during D2 verification (A2 sub-clause: per-line `// biome-ignore` doesn't apply to plugin diagnostics; A3: `--only=<rule-id>` doesn't exist for plugin rules). Each falsification halted the dispatch, surfaced to the operator, and routed to a small pivot — A2 resolved by reshaping `blindCast`'s body to use `any` instead of `as`; A3 resolved by filtering biome's `--reporter=json` output by category + message-prefix. The assumption block converted "this *might* be a problem" into "this *is* falsified — pivot now," which prevented sunk-cost-driven workarounds.
- **Severity-info + ratchet-enforces was the right shape for a repo-wide rule with pre-existing violations.** The plugin runs everywhere (no per-file allowlist), produces no CI noise (no error/warn severity on the 3,400 pre-existing sites), and the ratchet does the actual gating against added casts. Each piece's job is sharp: the plugin recognises, the ratchet enforces, the agent surfaces educate. Removing any one would weaken the others.
- **The orchestrator/executor split kept the project on rails.** All file-touching execution outside `projects/forbid-casts/` happened in subagents. The orchestrator authored the spec / plan / design-notes / code-review directly and routed everything else. When the implementer's connection dropped mid-dispatch, the resume worked cleanly because the brief + the in-progress diff + the heartbeat made the state legible.

### What surprised us

- **The number of biome 2.4.x plugin-DSL gaps.** Three independent limitations surfaced during D2: per-line `// biome-ignore` doesn't suppress plugin diagnostics ([biome#2582](https://github.com/biomejs/biome/issues/2582)); `--only=<rule-id>` doesn't apply to plugin rules; `overrides` block (with `"plugins": []` / `"plugins": null` / `"linter": { "enabled": false }`) can't clear plugins inherited from the top-level config. Each one was a 30-minute verification halt + design pivot. We expected one A2 verification halt; we got three.
- **GritQL `contains` only fires once per file.** The plugin's first form (`file($name, $body) where { $body <: contains <pattern> }`) silently undercounted — the ratchet's smoke test on a fixture with three casts reported 1. Switched to top-level pattern iteration (no `contains` wrapper); count corrected. Failure mode: invisible (no error message; just a wrong number).
- **GritQL string-message escape sequences mis-parse.** The plugin's initial message used `\"` to embed quotes in the diagnostic text; biome's GritQL engine mis-interpreted `\r` / `\t` / `\n` within the surrounding string. Rewrote the message to avoid escape sequences entirely.

### Lessons → landing surfaces

| Lesson | Landing surface | Note |
|---|---|---|
| The "halt on assumption-falsification + route back to discussion" mechanism worked as designed during D2. | `drive/retro/findings.md` (trial finding) | The mechanism is already documented in `drive-discussion`; this run validates it. |
| Biome 2.4.x GritQL plugin gotchas (per-line `// biome-ignore`, `--only`, `overrides`, `contains` once-per-file, message-escape parsing). | Inline comments in `biome-plugins/no-bare-cast.grit` + `scripts/lint-casts.mjs`. | Future plugin authors look at the existing plugin as the template; the gotchas land at the template. |
| "Info severity + ratchet enforces" pattern for repo-wide rules with pre-existing violations. | Inline comment in `biome-plugins/no-bare-cast.grit` ("Severity is 'info' so the plugin can run repo-wide without breaking existing builds…"). | Captured at the artefact level rather than a separate doc because the pattern + its rationale are most useful right next to the code that exercises it. |
| `drive-create-project` should auto-pick the project slug (no confirmation prompt). | Already landed: `skills-contrib/drive-create-project/SKILL.md` (mid-project amendment). | Operator-flagged friction; closed mid-project. |

### Deferred work

None. The reference utilities in `projects/forbid-casts/reference/` (`assertExhausted.ts`, `assertPresent.ts`, `dontAwait.tsx`) remain candidates for a future helper package; the spec explicitly excluded them as out of scope. No Linear ticket filed; the existing TML-2685 thread carries the context if a future operator wants to pick them up.

### ADR-worthy decisions

None. The substantive decisions (maximalist recognition; compare-to-merge-base ratchet; severity-info + ratchet-enforces; test-files exempt via plugin `file()` predicate) are scoped to this lint rule's mechanics and live in the artefacts that implement them. None rises to a durable architectural decision the framework or contract layer needs to record.

### One-sentence summary

A maximalist `as`-cast lint plugin, a merge-base ratchet, and an agent surface trio landed on the back of three sequential assumption-falsifier halts that turned biome 2.4.x's GritQL plugin gaps into focused design pivots instead of sunk-cost workarounds.
