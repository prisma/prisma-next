# Drive trial — findings

> **Trial window:** 2026-05-19 → 2026-06-02. See [`drive/trial.md`](../trial.md) for the quality bar, tags, and format. Record only what meets the bar — `friction`, `gap`, `win`, `surprise`, `boundary`. One stanza per finding.

## 2026-05-20 · drive-run-retro · surprise

Read-only reconnaissance (file `Read`, `Grep`, `Glob` on source) by the Orchestrator counts as drift even though intuition says reads are free. Symptom: orchestrator's broad-routing context fills with implementation detail; subsequent dispatch decisions degrade because the orchestrator reasons over fragments instead of structure. The DO-NOT enumeration in `drive/roles/README.md` lists read operations explicitly for this reason — counter-intuitive but correct.

**Suggested action:** landed in canonical `drive/roles/README.md § DO-NOT enumeration`. Watch for re-emergence in projects where the orchestrator's "I'll just check…" voice surfaces.

**Upstream candidate?** Yes — applies to any agent operating as an orchestrator regardless of harness.

## 2026-05-20 · drive-run-retro · win

AGENTS.md update mid-project (adding the canonical "Where skills and rules live" section + post-install wiring bullet) closed a foot-gun: a sub-agent halted because it assumed `.claude/skills/` was a canonical home rather than a symlink to `skills-contrib/`. The update prevents the same halt for future agents, especially for harnesses where the symlink presentation differs.

**Suggested action:** none. The update propagates via repo onboarding; future agents read AGENTS.md on entry.

**Upstream candidate?** Yes for the *pattern* (document the canonical-vs-presentation distinction in AGENTS.md / agent-onboarding docs) — the *content* is repo-specific.

## 2026-05-20 · drive-run-retro · boundary

Cross-document tier vocabulary divergence surfaced during reviewer iteration: `docs/drive/principles/decomposition-and-cost.md` declares canonical tier labels as `fast / mid / thorough`; `docs/drive/principles/brief-discipline.md` declares them as `cheap / mid / orchestrator`. Each document is internally consistent post-fix; the framework uses two parallel taxonomies for the same concept. Linear follow-up ticket filed (TML-NNNN — orchestrator will supply the ID before merge) to harmonise.

**Suggested action:** follow-up Linear ticket exists. Until harmonised, new drive-* docs should adopt one taxonomy and cross-reference (not redefine) — pick whichever the team prefers and align everything else.

**Upstream candidate?** Yes — harmonization choice and the convention "one taxonomy across `docs/drive/principles/*`" propagates upstream.
