# Drive domain model + Agile dispatch discipline

## At a glance

We are pinning Drive's domain model (three sized units of work + one delegation unit + eight workflows + twelve invariants) and threading Agile-style dispatch discipline (DoR / DoD per dispatch, ≤ 5-minute WIP inspection, M-cap, design-discussion stop-condition) into the canonical drive-* skill family. The work ships as a series of small canonical PRs stacked on top of [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93).

Two predecessor projects (`drive-domain-model` + `agile-agent-orchestration`) consolidated here when we realised they were addressing one cluster of failure modes — fuzzy units + unbounded agent dispatches — and fit one operational shape.

## Status

Active. Substantive consolidation in progress. The model and workflow are drafted; the per-skill canonical PRs are pending. See [`spec.md`](spec.md) § Acceptance criteria for the full delivery list.

## Where to start

| If you are… | Read | Why |
|---|---|---|
| A canonical-side maintainer (Ignite contributor) considering whether to engage | [`problem-statement.md`](problem-statement.md) | Self-contained problem framing + the proposed direction + what we're asking for. ~150 lines; nothing else required. |
| Validating the proposed design | [`spec.md`](spec.md) | At-a-glance summary, the design in three layers, three concrete walkthroughs, the deliverables, alternatives considered, open questions. |
| Looking up vocabulary, an invariant, or a Linear-sync detail | [`model.md`](model.md) | The pinned domain model, expanded small-scope-first. The source of truth. |
| Working on the per-skill restructure | [`skill-restructure.md`](skill-restructure.md) | Workflow → skill map, per-skill verdicts, implementation sequencing on top of PR #93. |
| Adopting the protocol in a new repo | [`calibration/prisma-next.md`](calibration/prisma-next.md) + [`principles/`](principles/) | The worked-example calibration and the principle deep-dives. |
| Curious why a decision was made | [`design-decisions.md`](design-decisions.md) | 23 decisions, each with options + choice + rationale. The alternatives ledger. |

## Base assumption

All canonical-side work proposed here stacks on top of [`prisma/ignite#93`](https://github.com/prisma/ignite/pull/93), which ships:

- The **project-context convention** — `drive/<category>/README.md` files read by drive-* skills as workflow step 1; the on-disk home for team-specific overlays.
- The **manual-QA pair** — `drive-qa-plan` (author the script) + `drive-qa-run` (execute + report), the judgement layer on top of CI.
- Three **meta-skills** — `drive-bootstrap-context` (scaffold the project-context directory), `drive-reconcile-skills` (move drift out of in-repo skill copies into the right category README), `drive-update-skills` (sync canonical skill bodies).

Several docs in this project reference that surface as already-existing. See [`skill-restructure.md`](skill-restructure.md) § "Base assumption" for the integration details.

## Repository layout

```
projects/drive-domain-model/
├── README.md                  ← you are here
├── problem-statement.md       ← self-contained framing for Ignite maintainers
├── spec.md                    ← the project's spec (design, deliverables, ACs)
├── model.md                   ← the pinned domain model
├── workflow.md                ← the operational lifecycle map
├── design-decisions.md        ← chronological decisions log (alternatives ledger)
├── skill-restructure.md       ← workflow → skill map + per-skill plan
├── plan.md                    ← execution plan (upcoming)
├── principles/                ← per-principle deep-dives
│   ├── protocol-as-memory.md
│   ├── decomposition-and-cost.md
│   ├── spikes.md
│   ├── roles-and-personas.md
│   ├── brief-discipline.md
│   ├── definition-of-ready.md
│   ├── definition-of-done.md
│   └── retro.md
├── calibration/
│   └── prisma-next.md         ← worked-example calibration for this repo
└── reference/                 ← gitignored local clones (e.g. ignite for cross-ref)
```

## Out of scope

- **Consumer migration.** Each consumer adopts on its own schedule via `drive-reconcile-skills`. The deliverables are canonical-side only. `prisma-next` is the first adopter and contributes its calibration document back as the worked example.
- **Multi-agent parallel execution semantics.** Addressed when we use it in anger.
- **Full Linear-sync mechanics beyond unit mapping.** This project pins the units and the promotion / demotion patterns; the full MCP-tool-call shape may be a follow-up.

See [`spec.md`](spec.md) § "What this is not" for the full non-goals list.
