# Principle: Decomposition Is Cost Optimization, Not Just Quality Optimization

## Thesis

Well-decomposed M-sized tasks with clear Definition of Done are safe to dispatch to cheaper / faster models. The verification gates catch drift; the small scope limits blast radius; the explicit brief reduces interpretation latitude. Decomposition therefore unlocks cost optimization in addition to its primary quality benefits.

This is the agent-team analogue of the Agile insight that pulling small stories enables junior developers to pick them up confidently — the cost shift is the same shape (cheaper labour on safer work), just with model tiers instead of seniority levels.

## Why feature-sized dispatches force expensive models

Feature-sized dispatches (the L/XL the protocol refuses to dispatch) demand more from the executing agent because:

- **Interpretation latitude is wider.** A bigger scope leaves more decisions to the implementer. More decisions means more opportunities for drift, which means the orchestrator needs a more capable model that's less likely to drift.
- **Recovery cost is higher.** A drift in a 5-commit dispatch is N times more expensive to unwind than a drift in a 1-commit dispatch. The capability premium is paid to reduce drift probability because the consequence is severe.
- **Verification is fuzzier.** A bigger scope makes "did you do the right thing?" harder to answer with a small set of gates. The orchestrator pays the capability premium because the alternative is reading every diff line-by-line.
- **The implementer must hold more context.** Smaller models with smaller working memories struggle when the dispatch context exceeds what they can hold. Bigger dispatches push toward bigger models.

The result: feature-sized dispatches are effectively locked to the orchestrator's tier throughout, because dropping to a cheaper tier risks drift that the verification gates won't catch.

## Why small, well-decomposed dispatches free up the tier

When a dispatch is M-sized with a clear DoD, the situation inverts:

- **Interpretation latitude is narrower.** A focused brief with pre-named edge cases gives the implementer few real decisions to make. The work is closer to "execute this specification" than "design and execute."
- **Recovery cost is bounded.** A drift in a 1-commit dispatch is trivially revertable. The protection against drift is verification + revert, not capability.
- **Verification is sharp.** A small scope is amenable to grep gates, test gates, fixture gates. The orchestrator can verify cheaply.
- **The implementer's context budget is fine.** Smaller models can absorb a focused brief and its referenced files without overflow.

The cheaper model is now safe because the protocol around the dispatch (DoR, DoD, brief discipline, gates) carries the risk that the model would otherwise carry alone.

## Worked example from today's reversal

The reversal dispatch was effectively L/XL: "drop optionality across the IR substrate + update every caller + retire the conditional envelope + tighten the introspector + delete the helper + regenerate fixtures." That required Opus-tier throughout — the prior dispatch attempts at cheaper tiers had drifted on simpler scopes, so we leaned on capability to avoid drift.

Properly decomposed, the same work would have been:

| Dispatch | Size | Model tier | Why |
|---|---|---|---|
| Substrate change (drop `?:` from `StorageTable` + `ForeignKeyReference`) | M | Opus | Design judgment (typology decision) |
| TS-builder caller normalisation | M | Sonnet / composer | Mechanical, well-bounded |
| PSL-interpreter caller normalisation | M | Sonnet / composer | Mechanical, well-bounded |
| Verifier inlining + delete `foreignKeyNamespacesMatch` | S | Sonnet / composer | Mechanical |
| Envelope shape simplification (retire conditional, delete probe) | M | Opus | Design judgment (canonical shape contract) |
| Postgres introspector tightening | S | Sonnet / composer | Mechanical |
| F01 regression test | XS | composer | Mechanical |
| Fixture regeneration | XS | composer | Pure command execution |
| Final integration verify | S | Opus | Judgment on whether the pieces compose |

Two Opus dispatches for the genuine design judgment work; five cheaper dispatches for the mechanical execution. The total Opus-hours required would have been ~25-40% of what we actually spent.

The cost optimization fell out of the decomposition. We did not set out to optimize cost — we set out to make the work safer. Cost reduction was a derived benefit.

## The Agile analogue

Human teams discovered this pattern long ago. The Agile insight:

> "Stories small enough to fit in a junior developer's working memory, with acceptance criteria small enough to fit in a code review, are safe to pull regardless of the developer's seniority."

The mechanism is the same:

| Agile concept | Agent-team analogue |
|---|---|
| Story sized for sprint | Dispatch sized for M time-box |
| Acceptance criteria | Definition of Done (gates + verifications) |
| Junior developer | Cheaper / faster model tier |
| Senior developer review | Orchestrator inspection at 5-min standup |
| Team retro | Protocol / calibration update |
| Apprenticeship | (Does not transfer — see [`protocol-as-memory.md`](protocol-as-memory.md)) |

The juniors-pulling-small-stories pattern is regarded as one of Agile's most important leverage points: it changes who can do what work. The agent-team version changes which model tier can safely execute which dispatch, with the same leverage on cost.

## Dispatch routing under this principle

Concrete routing decisions the orchestrator should make per dispatch:

- **High conceptual difficulty (design judgment, spec interpretation, novel patterns)** → orchestrator's tier (Opus or equivalent). The model needs the capability to navigate ambiguity safely.
- **High surface volume, low conceptual difficulty (codemods, mechanical migrations, batch fixes)** → cheaper tier. The work is well-bounded and verifiable; capability premium is wasted.
- **High blast radius regardless of conceptual difficulty** → orchestrator's tier OR smaller dispatch. Risk dominates; either pay for capability or shrink the dispatch until the risk drops.
- **Spikes** → cheaper tier with shorter time-box. Spike output is an artefact (a plan, an estimate, a list); the agent doesn't need to make design judgment, just gather information.

A dispatch that's high on all three dimensions (today's reversal) should never have happened at any tier. Decompose first.

## Anti-patterns this principle calls out

1. **"Use the most capable model so I don't have to think about decomposition."** Treats capability as a substitute for decomposition. The capability premium gets paid; the decomposition work doesn't happen; the failure modes recur because the orchestrator never built the muscles to decompose.

2. **"Use the cheapest model for everything because the verification gates will catch problems."** Treats decomposition as a substitute for capability without ensuring the gates are actually adequate. Fails on tasks where the verification gates can't capture the discipline (judgment-heavy work).

3. **"Use the orchestrator's tier for the implementer because that's what I'm running."** Defaults to the parent agent's model regardless of dispatch shape. Pays the capability premium on every dispatch, including the ones that don't need it. (This is the Cursor SDK's default if you don't pass an explicit `model` to a Task dispatch — worth knowing.)

4. **"I'll decompose later if it gets complicated."** Defers the decomposition cost to a moment when the project is already in trouble. The decomposition is harder once the work is in flight; the cheap-model dispatches are unavailable; the protocol has already failed.

## Practical implications

1. **Decomposition is part of the orchestrator's primary job.** Not an optimization, not an afterthought — the act of decomposing IS the orchestrator's contribution to throughput and cost.
2. **Every dispatch carries an explicit model-tier decision.** The default-to-parent behaviour is treated as a bug, not a feature.
3. **The brief specifies the expected model tier.** Part of DoR is "this brief is sized for tier X." If the tier and the size disagree, refine.
4. **Cost is measured.** Over time, the orchestrator-implementer pair builds an empirical understanding of which dispatch shapes are safe at which tier. This is a project-specific calibration that lives in the project's calibration doc.

## Failure mode this principle directly prevents

The recurring failure where an orchestrator pays Opus-tier costs on every dispatch because dispatches are too big to safely route elsewhere. The fix is structural: smaller dispatches with sharper gates → wider tier choice → lower total cost without quality loss.

## Related principles

- **[`protocol-as-memory.md`](protocol-as-memory.md)** — why the gates and catalogues that make cheap-tier dispatch safe are themselves part of the team's memory.
- **[`spikes.md`](spikes.md)** — spikes are the cheapest dispatches in the catalogue; pre-using them clears the way for cheaper implementation dispatches.
